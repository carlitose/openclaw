import { execFile, spawn } from "node:child_process";
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
const entrypoint = path.join(repoRoot, "openclaw.mjs");
const extensionSource = path.join(repoRoot, "dist", "extensions", "browser", "chrome-extension");
// Source-checkout CLI startup on Windows includes the complete bundled plugin graph and
// virus-scanner inspection. Keep that process cap separate from browser readiness deadlines.
const WINDOWS_CLI_PROCESS_TIMEOUT_MS = 120_000;
const WINDOWS_GATEWAY_PROCESS_START_TIMEOUT_MS = 120_000;

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
    cwd: repoRoot,
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
  const deadline = Date.now() + 45_000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      return await runBrowserCli({ ...params, args: ["tabs"] });
    } catch (error) {
      lastError = error;
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 500);
      });
    }
  }
  throw new Error("candidate extension relay did not become ready", { cause: lastError });
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

async function runWithCleanup<T>(run: () => Promise<T>, cleanup: () => Promise<void>): Promise<T> {
  let runOutcome: { ok: true; value: T } | { ok: false; error: unknown };
  try {
    runOutcome = { ok: true, value: await run() };
  } catch (error) {
    runOutcome = { ok: false, error };
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

async function main(): Promise<void> {
  if (process.platform !== "win32") {
    throw new Error("the native disposable-Chrome lane requires Windows");
  }
  await withPersonalChromeIsolationTask({}, async (task) => {
    assertNoForeignChromeProcesses({
      processes: await listWindowsChromeProcesses(),
      profileDir: task.profileDir,
    });
    await fs.access(path.join(repoRoot, "dist", "entry.js"));

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
          },
        },
        extensionRelay: { allowLegacyAuth: false },
        ssrfPolicy: { dangerouslyAllowPrivateNetwork: true },
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
      const gatewayLog = fsSync.openSync(gatewayLogPath, "ax");
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
          cwd: repoRoot,
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
      task.trackProcess({ child: gateway, role: "gateway" });

      const successPayload = await runWithCleanup(
        async () => {
          await waitForPort(task.gatewayPort);
          const chrome = spawn(chromeCommand[0]!, chromeCommand.slice(1), {
            cwd: repoRoot,
            env: {
              ...task.env,
              OPENCLAW_ISOLATION_ROOT: task.root,
              OPENCLAW_ISOLATION_PAIRING_FILE: pairingPath,
            },
            stdio: "ignore",
            windowsHide: true,
          });
          task.trackProcess({ child: chrome, role: "chrome", command: chromeCommand });

          await Promise.all([
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
          const openResult = await runBrowserCli({
            env: task.env,
            port: task.gatewayPort,
            token: task.gatewayToken,
            args: ["open", fixtures.urls.root],
          });
          await fs.writeFile(path.join(task.artifactsDir, "root-open.json"), openResult, "utf8");
          try {
            await fs.access(chromeLauncher.argumentsPath);
            throw new Error("healthy extension relay unexpectedly launched another Chrome process");
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
              throw error;
            }
          }
          const popupResult = await runBrowserCli({
            env: task.env,
            port: task.gatewayPort,
            token: task.gatewayToken,
            args: [
              "evaluate",
              "--fn",
              "() => { document.querySelector('#popup')?.click(); return true; }",
            ],
          });
          await fs.writeFile(path.join(task.artifactsDir, "popup-open.json"), popupResult, "utf8");
          const redirectResult = await runBrowserCli({
            env: task.env,
            port: task.gatewayPort,
            token: task.gatewayToken,
            args: ["navigate", fixtures.urls.redirect],
          });
          await fs.writeFile(
            path.join(task.artifactsDir, "redirect-navigation.json"),
            redirectResult,
            "utf8",
          );

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
          ]);

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
            chromeForTestingVersion: chromeInstall.version,
            chromeForTestingSha256: chromeInstall.sha256,
            extensionId,
            extensionProfileLaunchArgs: launchArgs,
            gatewayPort: task.gatewayPort,
            fixturePort: fixtures.port,
          };
        },
        async () => {
          // Chrome must release the temporary native host before its registry
          // manifest is removed by the enclosing registration owner.
          await task.cleanup();
        },
      );
      process.stdout.write(`${JSON.stringify(successPayload)}\n`);
    });
  });
}

await main();
