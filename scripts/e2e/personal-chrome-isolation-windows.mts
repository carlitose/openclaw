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
  compileIsolationNativeHost,
  installPinnedChromeForTesting,
  listWindowsChromeProcesses,
  waitForCandidateExtensionPreference,
  withIsolationNativeHostRegistration,
} from "./lib/personal-chrome-windows.js";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const entrypoint = path.join(repoRoot, "openclaw.mjs");
const extensionSource = path.join(repoRoot, "extensions", "browser", "chrome-extension");

async function waitForPort(port: number): Promise<void> {
  const deadline = Date.now() + 30_000;
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
  return await execFileAsync(process.execPath, [entrypoint, ...args], {
    cwd: repoRoot,
    env,
    windowsHide: true,
    timeout: 45_000,
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
        extensionRelay: { allowLegacyAuth: false },
        ssrfPolicy: { dangerouslyAllowPrivateNetwork: true },
      },
    });

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
        [entrypoint, "gateway", "run", "--port", String(task.gatewayPort), "--bind", "loopback"],
        {
          cwd: repoRoot,
          env: {
            ...task.env,
            OPENCLAW_DISABLE_BONJOUR: "1",
            OPENCLAW_SKIP_CANVAS_HOST: "1",
            OPENCLAW_SKIP_CHANNELS: "1",
            OPENCLAW_SKIP_CRON: "1",
            OPENCLAW_SKIP_GMAIL_WATCHER: "1",
            OPENCLAW_SKIP_PROVIDERS: "1",
          },
          stdio: ["ignore", gatewayLog, gatewayLog],
          windowsHide: true,
        },
      );
      fsSync.closeSync(gatewayLog);
      task.trackProcess({ child: gateway, role: "gateway" });

      try {
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
          [fixtures.urls.child, fixtures.urls.challenge, fixtures.urls.denied].map(async (url) => {
            const response = await fetch(url);
            await response.text();
          }),
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

        process.stdout.write(
          `${JSON.stringify({
            ok: true,
            claim: "native-disposable-mv3",
            chromeForTestingVersion: chromeInstall.version,
            chromeForTestingSha256: chromeInstall.sha256,
            extensionId,
            gatewayPort: task.gatewayPort,
            fixturePort: fixtures.port,
          })}\n`,
        );
      } finally {
        // Chrome must release the temporary native host before its registry
        // manifest is removed by the enclosing registration owner.
        await task.cleanup();
      }
    });
  });
}

await main();
