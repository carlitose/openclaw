import { execFile, spawn, type ChildProcess } from "node:child_process";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { generateChromeExtensionIdForPath } from "../../extensions/browser/src/browser/extension-install-layout.js";
import {
  assertExclusiveBrowserController,
  withPersonalChromeIsolationTask,
} from "./lib/personal-chrome-isolation.js";
import {
  assertNoForeignChromeProcesses,
  buildChromeForTestingCommand,
  compileIsolationChromeLauncher,
  compileIsolationNativeHost,
  installPinnedChromeForTesting,
  listWindowsChromeProcesses,
  markCandidateExtensionAsManuallyInstalled,
  waitForCandidateExtensionPreference,
  withIsolationNativeHostRegistration,
} from "./lib/personal-chrome-windows.js";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const runtimeRoot = process.env.OPENCLAW_ISOLATION_RUNTIME_ROOT?.trim()
  ? path.resolve(process.env.OPENCLAW_ISOLATION_RUNTIME_ROOT)
  : repoRoot;
const entrypoint = path.join(runtimeRoot, "openclaw.mjs");
const extensionSource = path.join(runtimeRoot, "dist", "extensions", "browser", "chrome-extension");
// Source-checkout CLI startup on Windows includes the complete bundled plugin graph and
// virus-scanner inspection. Keep that process cap separate from browser readiness deadlines.
const WINDOWS_CLI_PROCESS_TIMEOUT_MS = 120_000;
const WINDOWS_GATEWAY_PROCESS_START_TIMEOUT_MS = 120_000;
const WINDOWS_EXTENSION_RELAY_READY_ATTEMPTS = 3;

function requireFrozenCandidateEvidence(): { candidateSha: string; packageSha256: string } {
  const candidateSha = process.env.OPENCLAW_ISOLATION_CANDIDATE_SHA?.trim() ?? "";
  const packageSha256 = process.env.OPENCLAW_ISOLATION_PACKAGE_SHA256?.trim() ?? "";
  if (!/^[0-9a-f]{40}$/u.test(candidateSha) || !/^[0-9a-f]{64}$/u.test(packageSha256)) {
    throw new Error("packaged isolation requires exact candidate and package SHA evidence");
  }
  return { candidateSha, packageSha256 };
}

async function waitForPort(port: number): Promise<void> {
  const deadline = Date.now() + WINDOWS_GATEWAY_PROCESS_START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const ready = await new Promise<boolean>((resolve) => {
      const socket = net.createConnection({ host: "127.0.0.1", port });
      socket.once("connect", () => {
        socket.destroy();
        resolve(true);
      });
      socket.once("error", () => {
        resolve(false);
      });
    });
    if (ready) {
      return;
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 100);
    });
  }
  throw new Error(`isolated Gateway did not listen on port ${port}`);
}

async function runOpenClaw(
  args: readonly string[],
  env: NodeJS.ProcessEnv,
): Promise<{ stdout: string; stderr: string }> {
  return await execFileAsync(process.execPath, ["--stack-size=8192", entrypoint, ...args], {
    cwd: runtimeRoot,
    env: { ...env, NODE_DISABLE_COMPILE_CACHE: "1" },
    windowsHide: true,
    timeout: WINDOWS_CLI_PROCESS_TIMEOUT_MS,
    maxBuffer: 4 * 1024 * 1024,
  });
}

async function runBrowserCli(params: {
  args: readonly string[];
  env: NodeJS.ProcessEnv;
  port: number;
  token: string;
}): Promise<string> {
  const result = await runOpenClaw(
    [
      "browser",
      "--url",
      `ws://127.0.0.1:${params.port}`,
      "--token",
      params.token,
      "--json",
      "--browser-profile",
      "chrome",
      ...params.args,
    ],
    params.env,
  );
  JSON.parse(result.stdout);
  return result.stdout;
}

async function waitForExtensionRelay(params: {
  env: NodeJS.ProcessEnv;
  port: number;
  token: string;
}): Promise<string> {
  let lastError: unknown;
  // Count complete attempts: a command that starts just before a wall-clock
  // deadline must not consume the retry for a transient relay identity race.
  for (let attempt = 0; attempt < WINDOWS_EXTENSION_RELAY_READY_ATTEMPTS; attempt += 1) {
    try {
      return await runBrowserCli({ ...params, args: ["tabs"] });
    } catch (error) {
      lastError = error;
      if (attempt + 1 < WINDOWS_EXTENSION_RELAY_READY_ATTEMPTS) {
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 500);
        });
      }
    }
  }
  throw new Error("candidate extension relay did not become ready", { cause: lastError });
}

type BrowserTab = { targetId?: unknown; url?: unknown };

function parseBrowserTabs(raw: string): Array<{ targetId: string; url: string }> {
  const payload = JSON.parse(raw) as { tabs?: BrowserTab[] };
  return (payload.tabs ?? []).flatMap((tab) =>
    typeof tab.targetId === "string" && typeof tab.url === "string"
      ? [{ targetId: tab.targetId, url: tab.url }]
      : [],
  );
}

function assertUrlsArePrivate(raw: string, privateUrls: readonly string[]): void {
  const visible = new Set(parseBrowserTabs(raw).map((tab) => tab.url));
  const leaked = privateUrls.filter((url) => visible.has(url));
  if (leaked.length > 0) {
    throw new Error(`private fixture URL entered controlled inventory: ${leaked.join(", ")}`);
  }
}

function parseOpenedTargetId(raw: string): string {
  const targetId = (JSON.parse(raw) as BrowserTab).targetId;
  if (typeof targetId !== "string" || targetId.length === 0) {
    throw new Error("browser open did not return a target id");
  }
  return targetId;
}

async function waitForAccessibleFixtureTabs(params: {
  env: NodeJS.ProcessEnv;
  port: number;
  token: string;
  expectedUrls: readonly string[];
}): Promise<string> {
  const deadline = Date.now() + 10_000;
  let lastTabs = "";
  while (Date.now() < deadline) {
    lastTabs = await runBrowserCli({
      env: params.env,
      port: params.port,
      token: params.token,
      args: ["tabs"],
    });
    const urls = new Set(parseBrowserTabs(lastTabs).map((tab) => tab.url));
    if (params.expectedUrls.every((url) => urls.has(url))) {
      return lastTabs;
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 100);
    });
  }
  throw new Error(`candidate extension did not publish the expected fixture tabs: ${lastTabs}`);
}

async function waitForNoAccessibleFixtureTabs(params: {
  env: NodeJS.ProcessEnv;
  port: number;
  token: string;
  fixtureUrls: readonly string[];
}): Promise<void> {
  const deadline = Date.now() + 10_000;
  let lastTabs = "";
  while (Date.now() < deadline) {
    lastTabs = await runBrowserCli({
      env: params.env,
      port: params.port,
      token: params.token,
      args: ["tabs"],
    });
    const visible = new Set(parseBrowserTabs(lastTabs).map((tab) => tab.url));
    if (params.fixtureUrls.every((url) => !visible.has(url))) {
      return;
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 100);
    });
  }
  throw new Error(`task-owned fixture tabs remained in controlled inventory: ${lastTabs}`);
}

async function closeTaskFixtureTabs(params: {
  env: NodeJS.ProcessEnv;
  port: number;
  token: string;
  tabs: string;
  descendantUrls: readonly string[];
  rootUrls: readonly string[];
}): Promise<void> {
  const entries = parseBrowserTabs(params.tabs);
  for (const urls of [params.descendantUrls, params.rootUrls]) {
    for (const url of urls) {
      const tab = entries.find((entry) => entry.url === url);
      if (tab) {
        await runBrowserCli({
          env: params.env,
          port: params.port,
          token: params.token,
          args: ["close", tab.targetId],
        });
      }
    }
  }
}

async function waitForProcessExit(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("owned Gateway did not exit")), 10_000);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

async function openConfiguredExtensionProfile(params: {
  env: NodeJS.ProcessEnv;
  port: number;
  token: string;
  argumentsPath: string;
  url: string;
}): Promise<string> {
  const result = await runBrowserCli({
    env: params.env,
    port: params.port,
    token: params.token,
    args: ["open", params.url],
  });
  await fs.access(params.argumentsPath);
  return result;
}

async function waitForFixturePaths(
  eventsPath: string,
  pathnames: readonly string[],
): Promise<void> {
  const deadline = Date.now() + 5_000;
  let events = "";
  while (Date.now() < deadline) {
    events = await fs.readFile(eventsPath, "utf8");
    if (pathnames.every((pathname) => events.includes(`"pathname":"${pathname}"`))) {
      return;
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 100);
    });
  }
  const missing = pathnames.filter((pathname) => !events.includes(`"pathname":"${pathname}"`));
  throw new Error(`loopback fixtures were not observed: ${missing.join(", ")}`);
}

async function runWithCleanup<T>(
  run: () => Promise<T>,
  cleanup: () => Promise<void>,
  mapRunError?: (error: unknown) => Promise<unknown>,
): Promise<T> {
  let runOutcome: { ok: true; value: T } | { ok: false; error: unknown };
  try {
    runOutcome = { ok: true, value: await run() };
  } catch (error) {
    runOutcome = { ok: false, error: mapRunError ? await mapRunError(error) : error };
  }

  let cleanupOutcome: { ok: true } | { ok: false; error: unknown };
  try {
    await cleanup();
    cleanupOutcome = { ok: true };
  } catch (error) {
    cleanupOutcome = { ok: false, error };
  }

  if (!runOutcome.ok) {
    if (!cleanupOutcome.ok) {
      throw new AggregateError(
        [runOutcome.error, cleanupOutcome.error],
        "personal Chrome isolation run and cleanup both failed",
        { cause: runOutcome.error },
      );
    }
    throw runOutcome.error;
  }
  if (!cleanupOutcome.ok) {
    throw cleanupOutcome.error;
  }
  return runOutcome.value;
}

async function gatewayRelayDiagnosticError(gatewayLogPath: string, cause: unknown): Promise<Error> {
  const log = await fs.readFile(gatewayLogPath, "utf8").catch(() => "");
  const diagnostics = log
    .split(/\r?\n/u)
    .filter((line) => /extension-relay|auto-attach|attach failed/iu.test(line))
    .slice(-12)
    .join("\n");
  return new Error(
    diagnostics
      ? `native extension relay failed:\n${diagnostics}`
      : "native extension relay failed without Gateway diagnostics",
    { cause },
  );
}

async function main(): Promise<void> {
  if (process.platform !== "win32") {
    throw new Error("the native disposable-Chrome lane requires Windows");
  }
  const runtimeManifest = JSON.parse(
    await fs.readFile(path.join(runtimeRoot, "package.json"), "utf8"),
  ) as { name?: unknown };
  if (runtimeManifest.name !== "openclaw") {
    throw new Error("the native disposable-Chrome lane requires an OpenClaw runtime root");
  }
  const frozenCandidate = requireFrozenCandidateEvidence();
  await withPersonalChromeIsolationTask({}, async (task) => {
    assertNoForeignChromeProcesses({
      processes: await listWindowsChromeProcesses(),
      profileDir: task.profileDir,
    });
    await fs.access(path.join(runtimeRoot, "dist", "entry.js"));

    const extensionDir = await fs.realpath(extensionSource);
    const extensionId = generateChromeExtensionIdForPath(extensionDir, "win32");
    const fixtures = await task.startFixtures();

    const pairingResult = await runOpenClaw(
      [
        "browser",
        "extension",
        "pair",
        "--gateway-url",
        `ws://127.0.0.1:${task.gatewayPort}`,
        "--json",
      ],
      task.env,
    );
    const pairingPayload: unknown = JSON.parse(pairingResult.stdout);
    const pairingString = (pairingPayload as { pairingString?: unknown }).pairingString;
    if (typeof pairingString !== "string" || !pairingString.includes("#")) {
      throw new Error("candidate CLI did not produce an extension pairing string");
    }
    const pairingPath = path.join(task.pairingDir, "pairing.txt");
    await fs.writeFile(pairingPath, `${pairingString}\n`, { mode: 0o600, flag: "wx" });

    const nativeHost = await compileIsolationNativeHost({ taskRoot: task.root, extensionId });
    const chromeInstall = await installPinnedChromeForTesting(task.chromeForTestingDir);
    const chromeLauncher = await compileIsolationChromeLauncher(task.root);
    await task.writeConfig({
      gateway: {
        mode: "local",
        port: task.gatewayPort,
        bind: "loopback",
        auth: { mode: "token", token: task.gatewayToken },
        controlUi: { enabled: false },
      },
      browser: {
        enabled: true,
        defaultProfile: "chrome",
        profiles: {
          chrome: {
            driver: "extension",
            executablePath: chromeLauncher.executablePath,
            userDataDir: task.profileDir,
            profileDirectory: "Default",
            navigationPolicy: {
              allowHostnames: ["localhost", "127.0.0.1"],
              denyHostnames: ["127.0.0.1"],
            },
          },
        },
        extensionRelay: { allowLegacyAuth: false },
        ssrfPolicy: { allowedHostnames: ["localhost"] },
      },
    });
    const chromeCommand = buildChromeForTestingCommand({
      executablePath: chromeInstall.executablePath,
      profileDir: task.profileDir,
      extensionDir,
      initialUrl: fixtures.urls.unrelated,
    });
    assertExclusiveBrowserController(chromeCommand);

    await withIsolationNativeHostRegistration(nativeHost.manifestPath, async () => {
      const gatewayLogPath = path.join(task.artifactsDir, "gateway.log");
      let gatewayStarts = 0;
      const startGateway = () => {
        const gatewayLog = fsSync.openSync(gatewayLogPath, gatewayStarts === 0 ? "ax" : "a");
        const gateway = spawn(
          process.execPath,
          [
            "--stack-size=8192",
            entrypoint,
            "gateway",
            "run",
            "--port",
            String(task.gatewayPort),
            "--bind",
            "loopback",
          ],
          {
            cwd: runtimeRoot,
            env: {
              ...task.env,
              NODE_DISABLE_COMPILE_CACHE: "1",
              OPENCLAW_DISABLE_BONJOUR: "1",
              OPENCLAW_SKIP_CANVAS_HOST: "1",
              OPENCLAW_SKIP_CHANNELS: "1",
              OPENCLAW_SKIP_CRON: "1",
              OPENCLAW_SKIP_GMAIL_WATCHER: "1",
              OPENCLAW_SKIP_PROVIDERS: "1",
              OPENCLAW_ISOLATION_ROOT: task.root,
              OPENCLAW_ISOLATION_PAIRING_FILE: pairingPath,
              OPENCLAW_ISOLATION_CHROME_EXE: chromeInstall.executablePath,
              OPENCLAW_ISOLATION_EXTENSION_DIR: extensionDir,
              OPENCLAW_ISOLATION_LAUNCH_ARGS: chromeLauncher.argumentsPath,
              OPENCLAW_ISOLATION_SECURE_PREFERENCES_RESTORE:
                chromeLauncher.securePreferencesRestorePath,
            },
            stdio: ["ignore", gatewayLog, gatewayLog],
            windowsHide: true,
          },
        );
        fsSync.closeSync(gatewayLog);
        gatewayStarts += 1;
        task.trackProcess({ child: gateway, role: "gateway" });
        return gateway;
      };
      let gateway = startGateway();

      const successPayload = await runWithCleanup(
        async () => {
          await waitForPort(task.gatewayPort);
          const chrome = spawn(chromeCommand[0]!, chromeCommand.slice(1), {
            cwd: runtimeRoot,
            env: {
              ...task.env,
              OPENCLAW_ISOLATION_ROOT: task.root,
              OPENCLAW_ISOLATION_PAIRING_FILE: pairingPath,
            },
            stdio: "ignore",
            windowsHide: true,
          });
          task.trackProcess({ child: chrome, role: "chrome", command: chromeCommand });

          const [, initialTabs] = await Promise.all([
            waitForCandidateExtensionPreference({
              profileDir: task.profileDir,
              extensionId,
              extensionDir,
            }),
            waitForExtensionRelay({
              env: task.env,
              port: task.gatewayPort,
              token: task.gatewayToken,
            }),
          ]);
          assertUrlsArePrivate(initialTabs, [fixtures.urls.unrelated, fixtures.urls.denied]);

          let deniedOpenError: unknown;
          try {
            await runBrowserCli({
              env: task.env,
              port: task.gatewayPort,
              token: task.gatewayToken,
              args: ["open", fixtures.urls.denied],
            });
          } catch (error) {
            deniedOpenError = error;
          }
          if (!deniedOpenError) {
            throw new Error("denied hostname unexpectedly opened through the OpenClaw CLI");
          }
          const commandError = deniedOpenError as Error & { stderr?: unknown; stdout?: unknown };
          const deniedOpenDiagnostic = [
            commandError.message,
            commandError.stderr,
            commandError.stdout,
          ]
            .filter((value): value is string => typeof value === "string")
            .join("\n");
          if (!/(?:blocked|denied|navigation policy|ssrf)/iu.test(deniedOpenDiagnostic)) {
            throw deniedOpenError;
          }
          const deniedOpenOutcome = "visible-policy-denial";

          const humanBoundaryResults: Array<{
            kind: string;
            outcome: "human-action-required";
          }> = [];
          for (const [kind, url] of Object.entries(fixtures.urls.humanBoundaries)) {
            const boundaryOpen = await runBrowserCli({
              env: task.env,
              port: task.gatewayPort,
              token: task.gatewayToken,
              args: ["open", url],
            });
            const boundaryTargetId = parseOpenedTargetId(boundaryOpen);
            const boundarySnapshot = await runBrowserCli({
              env: task.env,
              port: task.gatewayPort,
              token: task.gatewayToken,
              args: ["snapshot", "--target-id", boundaryTargetId],
            });
            if (
              !boundarySnapshot.includes("Human action required") ||
              !boundarySnapshot.includes(kind)
            ) {
              throw new Error(`human boundary ${kind} was not visible through the OpenClaw CLI`);
            }
            humanBoundaryResults.push({ kind, outcome: "human-action-required" });
            await runBrowserCli({
              env: task.env,
              port: task.gatewayPort,
              token: task.gatewayToken,
              args: ["close", boundaryTargetId],
            });
          }
          await waitForNoAccessibleFixtureTabs({
            env: task.env,
            port: task.gatewayPort,
            token: task.gatewayToken,
            fixtureUrls: Object.values(fixtures.urls.humanBoundaries),
          });

          const openResult = await runBrowserCli({
            env: task.env,
            port: task.gatewayPort,
            token: task.gatewayToken,
            args: ["open", fixtures.urls.root],
          });
          await fs.writeFile(path.join(task.artifactsDir, "root-open.json"), openResult, "utf8");
          const rootTargetId = parseOpenedTargetId(openResult);
          try {
            await fs.access(chromeLauncher.argumentsPath);
            throw new Error("healthy extension relay unexpectedly launched another Chrome process");
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
              throw error;
            }
          }
          // Each separate user activation may open only one child. Keep one
          // inventory read after both actions to limit source-checkout CLI starts.
          const popupResult = await runBrowserCli({
            env: task.env,
            port: task.gatewayPort,
            token: task.gatewayToken,
            args: [
              "evaluate",
              "--fn",
              "() => { document.querySelector('#popup')?.click(); return true; }",
              "--target-id",
              rootTargetId,
            ],
          });
          await fs.writeFile(path.join(task.artifactsDir, "popup-open.json"), popupResult, "utf8");
          const childResult = await runBrowserCli({
            env: task.env,
            port: task.gatewayPort,
            token: task.gatewayToken,
            args: [
              "evaluate",
              "--fn",
              "() => { document.querySelector('#child')?.click(); return true; }",
              "--target-id",
              rootTargetId,
            ],
          });
          await fs.writeFile(path.join(task.artifactsDir, "child-open.json"), childResult, "utf8");
          await runBrowserCli({
            env: task.env,
            port: task.gatewayPort,
            token: task.gatewayToken,
            args: [
              "evaluate",
              "--fn",
              "() => { document.querySelector('#denied-child')?.click(); return true; }",
              "--target-id",
              rootTargetId,
            ],
          });
          const descendantTabs = await waitForAccessibleFixtureTabs({
            env: task.env,
            port: task.gatewayPort,
            token: task.gatewayToken,
            expectedUrls: [fixtures.urls.root, fixtures.urls.child, fixtures.urls.popup],
          });
          await fs.writeFile(
            path.join(task.artifactsDir, "descendant-tabs.json"),
            descendantTabs,
            "utf8",
          );
          assertUrlsArePrivate(descendantTabs, [fixtures.urls.unrelated, fixtures.urls.denied]);

          gateway.kill("SIGTERM");
          await waitForProcessExit(gateway);
          gateway = startGateway();
          await waitForPort(task.gatewayPort);
          await waitForExtensionRelay({
            env: task.env,
            port: task.gatewayPort,
            token: task.gatewayToken,
          });
          const reconnectedTabs = await waitForAccessibleFixtureTabs({
            env: task.env,
            port: task.gatewayPort,
            token: task.gatewayToken,
            expectedUrls: [fixtures.urls.root, fixtures.urls.child, fixtures.urls.popup],
          });
          await runBrowserCli({
            env: task.env,
            port: task.gatewayPort,
            token: task.gatewayToken,
            args: ["snapshot", "--target-id", rootTargetId],
          });
          await fs.writeFile(
            path.join(task.artifactsDir, "relay-reconnect-tabs.json"),
            reconnectedTabs,
            "utf8",
          );

          const redirectResult = await runBrowserCli({
            env: task.env,
            port: task.gatewayPort,
            token: task.gatewayToken,
            args: ["navigate", fixtures.urls.redirect, "--target-id", rootTargetId],
          });
          await fs.writeFile(
            path.join(task.artifactsDir, "redirect-navigation.json"),
            redirectResult,
            "utf8",
          );
          const redirectedTabs = await waitForAccessibleFixtureTabs({
            env: task.env,
            port: task.gatewayPort,
            token: task.gatewayToken,
            expectedUrls: [fixtures.urls.redirectFinal, fixtures.urls.child, fixtures.urls.popup],
          });
          await runBrowserCli({
            env: task.env,
            port: task.gatewayPort,
            token: task.gatewayToken,
            args: ["snapshot", "--target-id", rootTargetId],
          });

          await Promise.all(
            [fixtures.urls.child, fixtures.urls.challenge, fixtures.urls.denied].map(
              async (url) => {
                const response = await fetch(url);
                await response.text();
              },
            ),
          );
          await waitForFixturePaths(fixtures.eventsPath, [
            "/root",
            "/child",
            "/popup",
            "/redirect",
            "/final",
            "/challenge",
            "/denied",
            "/unrelated",
            ...Object.values(fixtures.urls.humanBoundaries).map((url) => new URL(url).pathname),
          ]);

          const taskFixtureUrls = [
            fixtures.urls.root,
            fixtures.urls.child,
            fixtures.urls.popup,
            fixtures.urls.redirect,
            fixtures.urls.redirectFinal,
            ...Object.values(fixtures.urls.humanBoundaries),
          ];
          const cycleResults: Array<{ cycle: number; cleanup: "exact-ids-empty" }> = [];
          await closeTaskFixtureTabs({
            env: task.env,
            port: task.gatewayPort,
            token: task.gatewayToken,
            tabs: redirectedTabs,
            descendantUrls: [fixtures.urls.child, fixtures.urls.popup],
            rootUrls: [fixtures.urls.redirectFinal],
          });
          await waitForNoAccessibleFixtureTabs({
            env: task.env,
            port: task.gatewayPort,
            token: task.gatewayToken,
            fixtureUrls: taskFixtureUrls,
          });
          cycleResults.push({ cycle: 1, cleanup: "exact-ids-empty" });

          for (let cycle = 2; cycle <= 5; cycle += 1) {
            const cycleOpen = await runBrowserCli({
              env: task.env,
              port: task.gatewayPort,
              token: task.gatewayToken,
              args: ["open", fixtures.urls.root],
            });
            const cycleRootTargetId = parseOpenedTargetId(cycleOpen);
            for (const selector of ["#popup", "#child"]) {
              await runBrowserCli({
                env: task.env,
                port: task.gatewayPort,
                token: task.gatewayToken,
                args: [
                  "evaluate",
                  "--fn",
                  `() => { document.querySelector('${selector}')?.click(); return true; }`,
                  "--target-id",
                  cycleRootTargetId,
                ],
              });
            }
            const cycleTabs = await waitForAccessibleFixtureTabs({
              env: task.env,
              port: task.gatewayPort,
              token: task.gatewayToken,
              expectedUrls: [fixtures.urls.root, fixtures.urls.child, fixtures.urls.popup],
            });
            assertUrlsArePrivate(cycleTabs, [fixtures.urls.unrelated, fixtures.urls.denied]);
            await closeTaskFixtureTabs({
              env: task.env,
              port: task.gatewayPort,
              token: task.gatewayToken,
              tabs: cycleTabs,
              descendantUrls: [fixtures.urls.child, fixtures.urls.popup],
              rootUrls: [fixtures.urls.root],
            });
            await waitForNoAccessibleFixtureTabs({
              env: task.env,
              port: task.gatewayPort,
              token: task.gatewayToken,
              fixtureUrls: taskFixtureUrls,
            });
            cycleResults.push({ cycle, cleanup: "exact-ids-empty" });
          }

          await task.stopChromeProcesses();
          await markCandidateExtensionAsManuallyInstalled({
            profileDir: task.profileDir,
            extensionId,
            extensionDir,
            restorePath: chromeLauncher.securePreferencesRestorePath,
          });
          const relaunchedTabs = await openConfiguredExtensionProfile({
            env: task.env,
            port: task.gatewayPort,
            token: task.gatewayToken,
            argumentsPath: chromeLauncher.argumentsPath,
            url: fixtures.urls.root,
          });
          await fs.writeFile(
            path.join(task.artifactsDir, "extension-profile-relaunch.json"),
            relaunchedTabs,
            "utf8",
          );
          const launchArgs = (await fs.readFile(chromeLauncher.argumentsPath, "utf8"))
            .split(/\r?\n/u)
            .filter(Boolean);
          const expectedLaunchArgs = [
            `--user-data-dir=${task.profileDir}`,
            "--profile-directory=Default",
          ];
          if (
            launchArgs.length !== expectedLaunchArgs.length ||
            launchArgs.some((argument, index) => argument !== expectedLaunchArgs[index])
          ) {
            throw new Error(
              "extension-profile launch did not preserve the exact disposable profile",
            );
          }
          if (
            launchArgs.some(
              (argument) =>
                argument.includes(task.gatewayToken) || argument.includes(pairingString),
            )
          ) {
            throw new Error(
              "extension-profile launch arguments exposed a pairing or gateway secret",
            );
          }
          await task.stopChromeProcesses();
          assertNoForeignChromeProcesses({
            processes: await listWindowsChromeProcesses(),
            profileDir: task.profileDir,
          });

          return {
            ok: true,
            claim: "native-disposable-mv3",
            runtime: runtimeRoot === repoRoot ? "source-build" : "packed-install",
            chromeForTestingVersion: chromeInstall.version,
            chromeForTestingSha256: chromeInstall.sha256,
            extensionId,
            extensionProfileLaunchArgs: launchArgs,
            navigationPolicy: {
              allow: ["localhost", "127.0.0.1"],
              deny: ["127.0.0.1"],
              deniedOpenOutcome,
              privateFixtureCount: 2,
              extensionAccessMode: "all-automatic-pairing",
            },
            humanBoundaries: humanBoundaryResults,
            cycles: cycleResults,
            relayReconnects: gatewayStarts - 1,
            stableLogicalTarget: "reused-across-relay-reconnect-and-redirect",
            protectedPathMetadata: "verified-unchanged-by-cleanup",
            ...frozenCandidate,
            gatewayPort: task.gatewayPort,
            fixturePort: fixtures.port,
          };
        },
        async () => {
          // Chrome must release the temporary native host before its registry
          // manifest is removed by the enclosing registration owner.
          await task.cleanup();
        },
        async (error) => await gatewayRelayDiagnosticError(gatewayLogPath, error),
      );
      process.stdout.write(`${JSON.stringify(successPayload)}\n`);
    });
  });
}

await main();
