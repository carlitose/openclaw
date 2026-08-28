import { execFile, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import http, { type Server } from "node:http";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { createOpenClawTestState, type OpenClawTestState } from "openclaw/plugin-sdk/test-state";
import { chromeProductRoots } from "../../../extensions/browser/src/browser/extension-install-layout.js";
import { getDeterministicFreePortBlock } from "../../../src/test-utils/ports.js";

const PROCESS_EXIT_TIMEOUT_MS = 5_000;
const PORT_RELEASE_TIMEOUT_MS = 5_000;
const PROCESS_EXIT_QUIET_MS = 250;
const execFileAsync = promisify(execFile);

type FixtureUrls = {
  root: string;
  child: string;
  popup: string;
  redirect: string;
  redirectFinal: string;
  challenge: string;
  denied: string;
  unrelated: string;
};

type PersonalChromeFixtures = {
  port: number;
  urls: FixtureUrls;
  eventsPath: string;
};

type TrackedProcess = {
  child: ChildProcess;
  role: "gateway" | "chrome";
};

export type PersonalChromeIsolationTask = {
  root: string;
  home: string;
  stateDir: string;
  configPath: string;
  workspaceDir: string;
  pairingDir: string;
  profileDir: string;
  chromeForTestingDir: string;
  artifactsDir: string;
  gatewayPort: number;
  gatewayToken: string;
  env: NodeJS.ProcessEnv;
  path: (...parts: string[]) => string;
  writeConfig: (config: unknown) => Promise<string>;
  startFixtures: () => Promise<PersonalChromeFixtures>;
  trackProcess: (params: {
    child: ChildProcess;
    role: "gateway" | "chrome";
    command?: readonly string[];
  }) => void;
  stopChromeProcesses: () => Promise<void>;
  cleanup: () => Promise<void>;
};

type PersonalChromeIsolationOptions = {
  protectedPaths?: readonly string[];
};

function normalizedPath(value: string): string {
  const resolved = path.resolve(value).replace(/[\\/]+$/u, "");
  return process.platform === "win32" ? resolved.toLocaleLowerCase("en-US") : resolved;
}

function isSameOrInside(candidate: string, parent: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..");
}

export function assertIsolatedBrowserPaths(params: {
  taskRoot: string;
  candidatePaths: readonly string[];
  protectedPaths: readonly string[];
}): void {
  const taskRoot = normalizedPath(params.taskRoot);
  const protectedPaths = params.protectedPaths.map(normalizedPath);

  for (const rawCandidate of params.candidatePaths) {
    const candidate = normalizedPath(rawCandidate);
    if (!isSameOrInside(candidate, taskRoot)) {
      throw new Error(`isolated browser path escapes the task root: ${rawCandidate}`);
    }
    for (const protectedPath of protectedPaths) {
      if (isSameOrInside(candidate, protectedPath) || isSameOrInside(protectedPath, candidate)) {
        throw new Error(`isolated browser path overlaps a protected path: ${rawCandidate}`);
      }
    }
  }
}

export function assertExclusiveBrowserController(command: readonly string[]): void {
  const commandLine = command.join(" ").toLocaleLowerCase("en-US");
  const competingController =
    /(?:playwright|puppeteer|browser-use|chrome[-_ ]?mcp|remote-debugging-(?:port|pipe))/u;
  const codexBrowserController = /(?:^|\s)codex(?:\.exe)?(?:\s|$)/u.test(commandLine);
  if (competingController.test(commandLine) || codexBrowserController) {
    throw new Error(`competing browser controller is forbidden: ${command[0] ?? "unknown"}`);
  }
}

function defaultProtectedPaths(): string[] {
  const home = process.env.USERPROFILE ?? process.env.HOME ?? os.homedir();
  return [
    process.env.OPENCLAW_STATE_DIR,
    path.join(home, ".openclaw"),
    ...chromeProductRoots({ env: process.env, homeDir: home }).map((root) => root.userDataDir),
  ].filter((value): value is string => Boolean(value));
}

async function allocateGatewayPort(): Promise<number> {
  return await getDeterministicFreePortBlock({ offsets: [0, 2, 10] });
}

async function isPortFree(port: number): Promise<boolean> {
  return await new Promise((resolve) => {
    const server = http.createServer();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)));
  });
}

async function closeServer(server: Server): Promise<void> {
  server.closeIdleConnections();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function waitForProcessExit(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`owned process ${child.pid ?? "unknown"} did not exit`)),
      PROCESS_EXIT_TIMEOUT_MS,
    );
    child.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

async function stopProcess(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  child.kill("SIGTERM");
  try {
    await waitForProcessExit(child);
  } catch {
    child.kill("SIGKILL");
    await waitForProcessExit(child);
  }
}

type ProcessCommand = {
  pid: number;
  parentPid?: number;
  name?: string;
  commandLine: string;
};

function hasExactCommandLineProfileMarker(commandLine: string, profileDir: string): boolean {
  const marker = "--user-data-dir=";
  const markerIndex = commandLine.toLocaleLowerCase("en-US").indexOf(marker);
  if (markerIndex < 0) {
    return false;
  }
  const rawValue = commandLine.slice(markerIndex + marker.length);
  const closingQuote = rawValue.startsWith('"') ? rawValue.indexOf('"', 1) : -1;
  if (rawValue.startsWith('"') && closingQuote < 0) {
    return false;
  }
  const value = closingQuote > 0 ? rawValue.slice(1, closingQuote) : rawValue.split(/\s/u, 1)[0];
  return value !== undefined && normalizedPath(value) === normalizedPath(profileDir);
}

async function windowsProcessCommands(profileDir: string): Promise<ProcessCommand[]> {
  const script = [
    "$profile = [Environment]::GetEnvironmentVariable('OPENCLAW_ISOLATION_PROFILE')",
    "$items = @(Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.IndexOf($profile, [StringComparison]::OrdinalIgnoreCase) -ge 0 } | ForEach-Object { [pscustomobject]@{ pid = [int]$_.ProcessId; parentPid = [int]$_.ParentProcessId; name = [string]$_.Name; commandLine = [string]$_.CommandLine } })",
    "$items | ConvertTo-Json -Compress",
  ].join("; ");
  const { stdout } = await execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", script],
    {
      env: { ...process.env, OPENCLAW_ISOLATION_PROFILE: profileDir },
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    },
  );
  if (!stdout.trim()) {
    return [];
  }
  const parsed: unknown = JSON.parse(stdout);
  const entries = Array.isArray(parsed) ? parsed : [parsed];
  return entries.filter(
    (entry): entry is ProcessCommand =>
      typeof entry === "object" &&
      entry !== null &&
      Number.isInteger((entry as ProcessCommand).pid) &&
      typeof (entry as ProcessCommand).commandLine === "string" &&
      hasExactCommandLineProfileMarker((entry as ProcessCommand).commandLine, profileDir),
  );
}

async function unixProcessCommands(profileDir: string): Promise<ProcessCommand[]> {
  const { stdout } = await execFileAsync("ps", ["-eo", "pid=,args="], {
    maxBuffer: 4 * 1024 * 1024,
  });
  return stdout
    .split("\n")
    .map((line) => /^(\s*\d+)\s+(.*)$/u.exec(line))
    .filter((match): match is RegExpExecArray => Boolean(match))
    .map((match) => ({ pid: Number(match[1]), commandLine: match[2] ?? "" }))
    .filter((entry) => hasExactCommandLineProfileMarker(entry.commandLine, profileDir));
}

async function taskProfileProcessCommands(profileDir: string): Promise<ProcessCommand[]> {
  return process.platform === "win32"
    ? await windowsProcessCommands(profileDir)
    : await unixProcessCommands(profileDir);
}

function killProcessId(pid: number, signal: NodeJS.Signals): void {
  if (pid === process.pid) {
    throw new Error("refusing to terminate the isolation harness process");
  }
  try {
    process.kill(pid, signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") {
      throw error;
    }
  }
}

async function forceStopWindowsTaskProfileProcessesOnce(profileDir: string): Promise<void> {
  const script = [
    "$profile = [Environment]::GetEnvironmentVariable('OPENCLAW_ISOLATION_PROFILE')",
    "$escaped = [Regex]::Escape($profile)",
    "$pattern = '--user-data-dir=(?:\"' + $escaped + '\"|' + $escaped + ')(?=[\"\\s]|$)'",
    "$observed = @{}",
    "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and [Regex]::IsMatch($_.CommandLine, $pattern, [Text.RegularExpressions.RegexOptions]::IgnoreCase) } | ForEach-Object { $observed[[int]$_.ProcessId] = $true }",
    "$current = @(Get-CimInstance Win32_Process | Where-Object { $observed.ContainsKey([int]$_.ProcessId) -and $_.CommandLine -and [Regex]::IsMatch($_.CommandLine, $pattern, [Text.RegularExpressions.RegexOptions]::IgnoreCase) })",
    "foreach ($item in $current) { Stop-Process -Id ([int]$item.ProcessId) -Force -ErrorAction SilentlyContinue }",
    "exit 0",
  ].join("; ");
  await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    env: { ...process.env, OPENCLAW_ISOLATION_PROFILE: profileDir },
    windowsHide: true,
    maxBuffer: 1024 * 1024,
  });
}

async function forceStopWindowsTaskProfileProcesses(profileDir: string): Promise<void> {
  const terminationDeadline = Date.now() + PROCESS_EXIT_TIMEOUT_MS;
  let quietSince: number | undefined;
  let lastRemaining: ProcessCommand[] = [];
  while (Date.now() < terminationDeadline) {
    const remaining = await taskProfileProcessCommands(profileDir);
    lastRemaining = remaining;
    if (remaining.length === 0) {
      quietSince ??= Date.now();
      if (Date.now() - quietSince >= PROCESS_EXIT_QUIET_MS) {
        return;
      }
    } else {
      quietSince = undefined;
      // Chrome may fork after its parent appears to exit. Re-read the exact task
      // profile until the process tree stays empty, never broadening PID ownership.
      await forceStopWindowsTaskProfileProcessesOnce(profileDir);
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 25);
    });
  }

  // Windows can publish a final child after its parent has been terminated.
  // Drain those exact late PIDs, then require one uninterrupted quiet window.
  const settleDeadline = Date.now() + PROCESS_EXIT_TIMEOUT_MS;
  quietSince = undefined;
  while (Date.now() < settleDeadline) {
    const remaining = await taskProfileProcessCommands(profileDir);
    lastRemaining = remaining;
    if (remaining.length === 0) {
      quietSince ??= Date.now();
      if (Date.now() - quietSince >= PROCESS_EXIT_QUIET_MS) {
        return;
      }
    } else {
      quietSince = undefined;
      await forceStopWindowsTaskProfileProcessesOnce(profileDir);
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 25);
    });
  }
  const processSummary = lastRemaining
    .map((entry) => `${entry.name ?? "process"}:${entry.pid}<-${entry.parentPid ?? "unknown"}`)
    .join(", ");
  throw new Error(`task-owned Chrome processes remained after forced cleanup: ${processSummary}`);
}

async function stopTaskProfileProcesses(
  profileDir: string,
  trackedChrome: readonly TrackedProcess[],
): Promise<void> {
  const initial = await taskProfileProcessCommands(profileDir);
  const initialPids = new Set(initial.map((entry) => entry.pid));
  for (const tracked of trackedChrome) {
    const pid = tracked.child.pid;
    if (
      pid &&
      tracked.child.exitCode === null &&
      tracked.child.signalCode === null &&
      !initialPids.has(pid)
    ) {
      throw new Error(`refusing to terminate Chrome PID ${pid} without its task profile marker`);
    }
  }
  if (process.platform === "win32") {
    // Close harness-spawned roots through their exact child handles first.
    // The profile reaper then owns only detached or late Chrome descendants.
    await Promise.all(trackedChrome.map(async (tracked) => await stopProcess(tracked.child)));
    await forceStopWindowsTaskProfileProcesses(profileDir);
  } else {
    for (const processCommand of initial) {
      killProcessId(processCommand.pid, "SIGTERM");
    }
    const deadline = Date.now() + PROCESS_EXIT_TIMEOUT_MS;
    let remaining = await taskProfileProcessCommands(profileDir);
    while (remaining.length > 0 && Date.now() < deadline) {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 25);
      });
      remaining = await taskProfileProcessCommands(profileDir);
    }
    for (const processCommand of remaining) {
      killProcessId(processCommand.pid, "SIGKILL");
    }
    if ((await taskProfileProcessCommands(profileDir)).length > 0) {
      throw new Error("task-owned Chrome processes remained after forced cleanup");
    }
  }
  await Promise.all(trackedChrome.map(async (tracked) => await waitForProcessExit(tracked.child)));
}

async function waitForPortRelease(port: number): Promise<void> {
  const deadline = Date.now() + PORT_RELEASE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await isPortFree(port)) {
      return;
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 25);
    });
  }
  throw new Error(`owned port ${port} was not released`);
}

function fixtureUrls(port: number): FixtureUrls {
  const url = (pathname: string) => `http://127.0.0.1:${port}${pathname}`;
  return {
    root: url("/root"),
    child: url("/child"),
    popup: url("/popup"),
    redirect: url("/redirect"),
    redirectFinal: url("/final"),
    challenge: url("/challenge"),
    denied: url("/denied"),
    unrelated: url("/unrelated"),
  };
}

async function startFixtureServer(artifactsDir: string): Promise<{
  fixtures: PersonalChromeFixtures;
  server: Server;
}> {
  const eventsPath = path.join(artifactsDir, "fixture-events.jsonl");
  const server = http.createServer((request, response) => {
    void (async () => {
      const host = request.headers.host ?? "unknown";
      const requestUrl = new URL(request.url ?? "/", `http://${host}`);
      await fs.appendFile(
        eventsPath,
        `${JSON.stringify({ host, method: request.method ?? "GET", pathname: requestUrl.pathname })}\n`,
        "utf8",
      );

      const urls = fixtureUrls((server.address() as { port: number }).port);
      if (requestUrl.pathname === "/root") {
        response.setHeader("content-type", "text/html; charset=utf-8");
        response.end(
          `<a id="child" href="${urls.child}">child</a><button id="popup" onclick="window.open('${urls.popup}')">popup</button>`,
        );
        return;
      }
      if (requestUrl.pathname === "/redirect") {
        response.writeHead(302, { location: urls.redirectFinal });
        response.end();
        return;
      }
      if (requestUrl.pathname === "/challenge") {
        response.writeHead(401, { "www-authenticate": 'Basic realm="OpenClaw fixture"' });
        response.end("authentication challenge");
        return;
      }
      if (requestUrl.pathname === "/denied") {
        response.statusCode = 403;
        response.end("denied destination");
        return;
      }
      if (requestUrl.pathname === "/unrelated") {
        response.end("unrelated tab");
        return;
      }
      response.end(`fixture ${requestUrl.pathname}`);
    })().catch((error: unknown) => {
      response.statusCode = 500;
      response.end(error instanceof Error ? error.message : String(error));
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    await closeServer(server);
    throw new Error("fixture server did not expose a TCP port");
  }
  return {
    fixtures: { port: address.port, urls: fixtureUrls(address.port), eventsPath },
    server,
  };
}

function hasExactProfileMarker(command: readonly string[], profileDir: string): boolean {
  const expected = normalizedPath(profileDir);
  return command.some((argument) => {
    const prefix = "--user-data-dir=";
    return (
      argument.toLocaleLowerCase("en-US").startsWith(prefix) &&
      normalizedPath(argument.slice(prefix.length)) === expected
    );
  });
}

async function createTaskState(
  gatewayPort: number,
  gatewayToken: string,
): Promise<OpenClawTestState> {
  return await createOpenClawTestState({
    prefix: "openclaw-personal-chrome-isolation-",
    label: "personal-chrome-isolation",
    layout: "split",
    scenario: "gateway-loopback",
    gateway: { port: gatewayPort, token: gatewayToken },
    applyEnv: false,
  });
}

export async function createPersonalChromeIsolationTask(
  options: PersonalChromeIsolationOptions = {},
): Promise<PersonalChromeIsolationTask> {
  const gatewayPort = await allocateGatewayPort();
  const gatewayToken = `isolation-${randomUUID()}`;
  const state = await createTaskState(gatewayPort, gatewayToken);
  const pairingDir = state.path("pairing");
  const profileDir = state.path("chrome-profile");
  const chromeForTestingDir = state.path("chrome-for-testing");
  const artifactsDir = state.path("artifacts");
  const ownedPaths = [
    state.stateDir,
    state.configPath,
    state.workspaceDir,
    pairingDir,
    profileDir,
    chromeForTestingDir,
    artifactsDir,
  ];

  try {
    assertIsolatedBrowserPaths({
      taskRoot: state.root,
      candidatePaths: ownedPaths,
      protectedPaths: options.protectedPaths ?? defaultProtectedPaths(),
    });
    await Promise.all(
      [pairingDir, profileDir, chromeForTestingDir, artifactsDir].map(async (directory) => {
        await fs.mkdir(directory, { recursive: true });
      }),
    );
  } catch (error) {
    await state.cleanup();
    throw error;
  }

  const trackedProcesses: TrackedProcess[] = [];
  const fixtureServers: Array<{ port: number; server: Server }> = [];
  let fixtures: PersonalChromeFixtures | undefined;
  let cleaned = false;

  const cleanup = async (): Promise<void> => {
    if (cleaned) {
      return;
    }
    cleaned = true;
    const cleanupErrors: unknown[] = [];

    const tracked = trackedProcesses.splice(0).toReversed();
    const trackedChrome = tracked.filter((processEntry) => processEntry.role === "chrome");
    // Gateway owns cold relaunch. Quiesce that producer before collecting the
    // detached Chrome tree, or an in-flight request can repopulate the profile.
    for (const processEntry of tracked.filter((entry) => entry.role === "gateway")) {
      try {
        await stopProcess(processEntry.child);
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    let chromeCleanupPassed = true;
    try {
      // The extension-profile launcher deliberately releases its process handle.
      // The exact temporary --user-data-dir remains the cleanup authority.
      await stopTaskProfileProcesses(profileDir, trackedChrome);
    } catch (error) {
      chromeCleanupPassed = false;
      cleanupErrors.push(error);
    }
    // Browser pages can retain active fixture connections. Stop every task-owned
    // client before closing its servers, or failure cleanup can wait forever.
    for (const fixture of fixtureServers.splice(0).toReversed()) {
      try {
        await closeServer(fixture.server);
        await waitForPortRelease(fixture.port);
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    try {
      await waitForPortRelease(gatewayPort);
    } catch (error) {
      cleanupErrors.push(error);
    }
    if (chromeCleanupPassed) {
      try {
        await state.cleanup();
      } catch (error) {
        cleanupErrors.push(error);
      }
    } else {
      cleanupErrors.push(
        new Error("retained the temporary task root because task-owned Chrome cleanup failed"),
      );
    }
    if (cleanupErrors.length > 0) {
      throw new AggregateError(cleanupErrors, "personal Chrome isolation cleanup failed");
    }
  };

  return {
    root: state.root,
    home: state.home,
    stateDir: state.stateDir,
    configPath: state.configPath,
    workspaceDir: state.workspaceDir,
    pairingDir,
    profileDir,
    chromeForTestingDir,
    artifactsDir,
    gatewayPort,
    gatewayToken,
    env: state.env,
    path: state.path,
    writeConfig: state.writeConfig,
    startFixtures: async () => {
      if (fixtures) {
        return fixtures;
      }
      const started = await startFixtureServer(artifactsDir);
      fixtures = started.fixtures;
      fixtureServers.push({ port: started.fixtures.port, server: started.server });
      return fixtures;
    },
    trackProcess: ({ child, role, command = [] }) => {
      if (role === "chrome" && !hasExactProfileMarker(command, profileDir)) {
        throw new Error("Chrome process command does not contain the exact temporary profile path");
      }
      trackedProcesses.push({ child, role });
    },
    stopChromeProcesses: async () => {
      const trackedChrome = trackedProcesses.filter((entry) => entry.role === "chrome");
      await stopTaskProfileProcesses(profileDir, trackedChrome);
      for (let index = trackedProcesses.length - 1; index >= 0; index -= 1) {
        if (trackedProcesses[index]?.role === "chrome") {
          trackedProcesses.splice(index, 1);
        }
      }
    },
    cleanup,
  };
}

function isolationRunCleanupError(runError: unknown, cleanupError: unknown): AggregateError {
  return new AggregateError(
    [runError, cleanupError],
    "personal Chrome isolation run and cleanup both failed",
    { cause: cleanupError },
  );
}

export async function withPersonalChromeIsolationTask<T>(
  options: PersonalChromeIsolationOptions,
  run: (task: PersonalChromeIsolationTask) => Promise<T>,
): Promise<T> {
  const task = await createPersonalChromeIsolationTask(options);
  try {
    const result = await run(task);
    await task.cleanup();
    return result;
  } catch (runError) {
    try {
      await task.cleanup();
    } catch (error) {
      throw isolationRunCleanupError(runError, error);
    }
    throw runError;
  }
}
