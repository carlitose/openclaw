import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertExclusiveBrowserController,
  assertIsolatedBrowserPaths,
  createPersonalChromeIsolationTask,
  withPersonalChromeIsolationTask,
} from "../../scripts/e2e/lib/personal-chrome-isolation.js";
import {
  assertNoForeignChromeProcesses,
  buildChromeForTestingCommand,
  compileIsolationNativeHost,
} from "../../scripts/e2e/lib/personal-chrome-windows.js";
import { isPortFree } from "../../src/test-utils/ports.js";

const cleanupTasks: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(cleanupTasks.splice(0).map(async (cleanup) => await cleanup()));
});

async function waitForPort(port: number): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const connected = await new Promise<boolean>((resolve) => {
      const socket = net.createConnection({ host: "127.0.0.1", port });
      socket.once("connect", () => {
        socket.destroy();
        resolve(true);
      });
      socket.once("error", () => resolve(false));
    });
    if (connected) {
      return;
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 20);
    });
  }
  throw new Error(`port ${port} did not become ready`);
}

async function waitForExit(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("child did not exit")), 5_000);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

describe("personal Chrome isolation harness", () => {
  it("allocates unique split state and a non-default free Gateway port", async () => {
    const first = await createPersonalChromeIsolationTask({ protectedPaths: [] });
    const second = await createPersonalChromeIsolationTask({ protectedPaths: [] });
    cleanupTasks.push(first.cleanup, second.cleanup);

    expect(first.root).not.toBe(second.root);
    expect(first.gatewayPort).not.toBe(18_789);
    expect(first.gatewayPort).not.toBe(second.gatewayPort);
    expect(await isPortFree(first.gatewayPort)).toBe(true);

    for (const candidate of [
      first.stateDir,
      first.configPath,
      first.workspaceDir,
      first.pairingDir,
      first.profileDir,
      first.chromeForTestingDir,
      first.artifactsDir,
    ]) {
      expect(path.relative(first.root, candidate)).not.toMatch(/^\.\.(?:[\\/]|$)/u);
    }
    await expect(fs.stat(first.stateDir)).resolves.toBeDefined();
    await expect(fs.stat(first.workspaceDir)).resolves.toBeDefined();
  });

  it.each([
    ["candidate equals a protected root", ["live"], ["live"]],
    ["candidate is inside a protected root", ["live", "nested"], ["live"]],
    ["candidate root would contain a protected root", ["."], ["live"]],
  ])("rejects when the %s", async (_label, candidateParts, protectedParts) => {
    const sandbox = await fs.mkdtemp(path.join(process.cwd(), ".tmp-isolation-paths-"));
    cleanupTasks.push(async () => await fs.rm(sandbox, { recursive: true, force: true }));
    const candidate = path.resolve(sandbox, ...candidateParts);
    const protectedPath = path.resolve(sandbox, ...protectedParts);
    await fs.mkdir(candidate, { recursive: true });
    await fs.mkdir(protectedPath, { recursive: true });

    expect(() =>
      assertIsolatedBrowserPaths({
        taskRoot: sandbox,
        candidatePaths: [candidate],
        protectedPaths: [protectedPath],
      }),
    ).toThrow(/protected path/u);
  });

  it("rejects an owned path outside the task root", async () => {
    const sandbox = await fs.mkdtemp(path.join(process.cwd(), ".tmp-isolation-escape-"));
    cleanupTasks.push(async () => await fs.rm(sandbox, { recursive: true, force: true }));

    expect(() =>
      assertIsolatedBrowserPaths({
        taskRoot: path.join(sandbox, "task"),
        candidatePaths: [path.join(sandbox, "outside")],
        protectedPaths: [],
      }),
    ).toThrow(/escapes the task root/u);
  });

  it("serves all task-owned loopback fixtures and records requests", async () => {
    const task = await createPersonalChromeIsolationTask({ protectedPaths: [] });
    cleanupTasks.push(task.cleanup);
    const fixtures = await task.startFixtures();

    const root = await fetch(fixtures.urls.root);
    expect(root.status).toBe(200);
    const rootHtml = await root.text();
    expect(rootHtml).toContain(fixtures.urls.child);
    expect(rootHtml).toContain(fixtures.urls.popup);

    const redirect = await fetch(fixtures.urls.redirect, { redirect: "manual" });
    expect(redirect.status).toBe(302);
    expect(redirect.headers.get("location")).toBe(fixtures.urls.redirectFinal);

    const challenge = await fetch(fixtures.urls.challenge);
    expect(challenge.status).toBe(401);
    expect(challenge.headers.get("www-authenticate")).toBe('Basic realm="OpenClaw fixture"');
    const denied = await fetch(fixtures.urls.denied);
    expect(denied.status).toBe(403);
    expect(await denied.text()).toContain("denied destination");
    expect(await (await fetch(fixtures.urls.unrelated)).text()).toContain("unrelated tab");

    const events = (await fs.readFile(fixtures.eventsPath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { host: string; pathname: string });
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ host: new URL(fixtures.urls.root).host, pathname: "/root" }),
        expect.objectContaining({
          host: new URL(fixtures.urls.challenge).host,
          pathname: "/challenge",
        }),
      ]),
    );
  });

  it.each([
    ["playwright", ["playwright", "test"]],
    ["puppeteer", ["node", "puppeteer-controller.js"]],
    ["Codex Browser Use", ["codex", "browser-use"]],
    ["Chrome MCP", ["node", "chrome-mcp", "--wsEndpoint=ws://127.0.0.1:1"]],
    ["raw CDP", ["chrome.exe", "--remote-debugging-port=9222"]],
  ])("rejects the competing %s controller", (_label, command) => {
    expect(() => assertExclusiveBrowserController(command)).toThrow(
      /competing browser controller/u,
    );
  });

  it("allows only the OpenClaw CLI and extension-owned Chrome launch shape", () => {
    expect(() =>
      assertExclusiveBrowserController([
        process.execPath,
        "dist/index.js",
        "browser",
        "--browser-profile",
        "chrome",
        "open",
        "http://root.localhost:3000/root",
      ]),
    ).not.toThrow();
    expect(() =>
      assertExclusiveBrowserController([
        "chrome.exe",
        "--user-data-dir=C:\\task\\profile",
        "--disable-extensions-except=C:\\task\\extension",
        "--load-extension=C:\\task\\extension",
      ]),
    ).not.toThrow();
  });

  it("builds a Chrome for Testing launch with one profile and one unpacked extension", () => {
    const command = buildChromeForTestingCommand({
      executablePath: "C:\\task\\chrome\\chrome.exe",
      profileDir: "C:\\task\\profile",
      extensionDir: "C:\\candidate\\extension",
    });

    expect(command).toContain("--user-data-dir=C:\\task\\profile");
    expect(command).toContain("--disable-extensions-except=C:\\candidate\\extension");
    expect(command).toContain("--load-extension=C:\\candidate\\extension");
    expect(command.some((argument) => argument.startsWith("--remote-debugging-"))).toBe(false);
    expect(() => assertExclusiveBrowserController(command)).not.toThrow();
  });

  it("refuses the native lane while a foreign Chrome process is running", () => {
    expect(() =>
      assertNoForeignChromeProcesses({
        profileDir: "C:\\task\\profile",
        processes: [
          {
            pid: 42,
            executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
            commandLine:
              '"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --user-data-dir=C:\\personal',
          },
        ],
      }),
    ).toThrow(/requires every existing chrome\.exe process to be closed/u);
  });

  it.runIf(process.platform === "win32")(
    "compiles and frames the task-owned Windows native bootstrap host",
    async () => {
      const task = await createPersonalChromeIsolationTask({ protectedPaths: [] });
      cleanupTasks.push(task.cleanup);
      const nativeHost = await compileIsolationNativeHost({
        taskRoot: task.root,
        extensionId: "a".repeat(32),
      });
      const pairingPath = path.join(task.pairingDir, "native-host-pairing.txt");
      const pairingString = `ws://127.0.0.1:19191/browser/extension#${"0".repeat(64)}`;
      await fs.writeFile(pairingPath, `${pairingString}\n`, "utf8");

      const request = Buffer.from(
        JSON.stringify({ v: 1, op: "bootstrap", nonce: "A".repeat(22) }),
        "utf8",
      );
      const length = Buffer.alloc(4);
      length.writeUInt32LE(request.length);
      const child = spawn(nativeHost.executablePath, [nativeHost.expectedOrigin], {
        env: {
          ...process.env,
          OPENCLAW_ISOLATION_ROOT: task.root,
          OPENCLAW_ISOLATION_PAIRING_FILE: pairingPath,
        },
        stdio: ["pipe", "pipe", "ignore"],
        windowsHide: true,
      });
      const output: Buffer[] = [];
      child.stdout?.on("data", (chunk: Buffer) => output.push(chunk));
      child.stdin?.end(Buffer.concat([length, request]));
      await waitForExit(child);

      const framed = Buffer.concat(output);
      const responseLength = framed.readUInt32LE(0);
      expect(JSON.parse(framed.subarray(4, 4 + responseLength).toString("utf8"))).toEqual({
        v: 1,
        ok: true,
        nonce: "A".repeat(22),
        pairingString,
      });
    },
  );

  it("cleans fixtures, owned processes, ports, and files after a forced failure", async () => {
    let observedRoot = "";
    let gatewayPort = 0;
    let fixturePort = 0;
    let gateway: ChildProcess | undefined;
    let chrome: ChildProcess | undefined;
    let foreignChrome: ChildProcess | undefined;

    await expect(
      withPersonalChromeIsolationTask({ protectedPaths: [] }, async (task) => {
        observedRoot = task.root;
        gatewayPort = task.gatewayPort;
        fixturePort = (await task.startFixtures()).port;
        const serverSource =
          'require("node:net").createServer(()=>{}).listen(Number(process.argv[1]),"127.0.0.1")';
        gateway = spawn(process.execPath, ["-e", serverSource, String(task.gatewayPort)], {
          stdio: "ignore",
          windowsHide: true,
        });
        task.trackProcess({ child: gateway, role: "gateway" });
        await waitForPort(task.gatewayPort);

        chrome = spawn(
          process.execPath,
          ["-e", "setInterval(()=>{},1000)", "--", `--user-data-dir=${task.profileDir}`],
          { stdio: "ignore", windowsHide: true },
        );
        task.trackProcess({
          child: chrome,
          role: "chrome",
          command: [process.execPath, `--user-data-dir=${task.profileDir}`],
        });
        foreignChrome = spawn(
          process.execPath,
          ["-e", "setInterval(()=>{},1000)", "--", `--user-data-dir=${task.profileDir}-foreign`],
          { stdio: "ignore", windowsHide: true },
        );
        cleanupTasks.push(async () => {
          if (foreignChrome?.exitCode === null && foreignChrome.signalCode === null) {
            foreignChrome.kill("SIGTERM");
            await waitForExit(foreignChrome);
          }
        });
        await fs.writeFile(task.path("forced-failure.txt"), "owned", "utf8");
        throw new Error("intentional mid-run failure");
      }),
    ).rejects.toThrow("intentional mid-run failure");

    await Promise.all(
      [gateway, chrome].filter(Boolean).map(async (child) => await waitForExit(child!)),
    );
    await expect(fs.stat(observedRoot)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(isPortFree(gatewayPort)).resolves.toBe(true);
    await expect(isPortFree(fixturePort)).resolves.toBe(true);
    expect(foreignChrome?.exitCode).toBeNull();
  });

  it("reports cleanup failure alongside an already-caused run failure", async () => {
    const runError = new Error("run failed", { cause: new Error("upstream cause") });
    const cleanupError = new Error("cleanup failed");

    await expect(
      withPersonalChromeIsolationTask({ protectedPaths: [] }, async (task) => {
        const cleanup = task.cleanup;
        task.cleanup = async () => {
          await cleanup();
          throw cleanupError;
        };
        throw runError;
      }),
    ).rejects.toMatchObject({
      cause: cleanupError,
      errors: [runError, cleanupError],
    });
  });

  it("refuses to track a Chrome PID without the exact temporary profile marker", async () => {
    const task = await createPersonalChromeIsolationTask({ protectedPaths: [] });
    cleanupTasks.push(task.cleanup);
    const child = spawn(process.execPath, ["-e", "process.exit(0)"], { stdio: "ignore" });
    await waitForExit(child);

    expect(() =>
      task.trackProcess({
        child,
        role: "chrome",
        command: [process.execPath, "--user-data-dir=C:\\not-the-task-profile"],
      }),
    ).toThrow(/temporary profile path/u);
  });
});
