import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type BrowserContext, type Worker } from "playwright-core";
import { afterEach, describe, expect, it } from "vitest";
import { relayTestKey } from "./relay-key.test-support.js";

declare const chrome: {
  storage: { local: { set(values: Record<string, unknown>): Promise<void> } };
  tabGroups: {
    query(
      query: Record<string, unknown>,
    ): Promise<Array<{ id: number; title?: string; windowId: number }>>;
    update(groupId: number, changes: Record<string, unknown>): Promise<void>;
  };
  tabs: {
    group(options: { tabIds: number[] }): Promise<number>;
    query(query: Record<string, unknown>): Promise<ChromeTab[]>;
    ungroup(tabIds: number[]): Promise<void>;
  };
};

type ChromeTab = {
  groupId: number;
  id?: number;
  url?: string;
  windowId: number;
};

const runE2E = process.env.OPENCLAW_BROWSER_EXTENSION_E2E === "1";
const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).toReversed()) {
    await cleanup().catch(() => undefined);
  }
});

async function extensionWorker(context: BrowserContext): Promise<Worker> {
  return (
    context.serviceWorkers()[0] ??
    (await context.waitForEvent("serviceworker", { timeout: 15_000 }))
  );
}

async function launch(profileDir: string, extensionPath: string): Promise<BrowserContext> {
  const executablePath = process.env.OPENCLAW_BROWSER_EXTENSION_E2E_EXECUTABLE_PATH;
  return await chromium.launchPersistentContext(profileDir, {
    ...(executablePath ? { executablePath } : {}),
    channel: "chromium",
    headless: true,
    ignoreDefaultArgs: ["--disable-extensions"],
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      "--window-size=1280,900",
    ],
  });
}

describe.runIf(runE2E)("descendant tab containment Chromium E2E", () => {
  it("moves normal and popup-window children into the exact opener group", async () => {
    const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-popup-e2e-")));
    cleanups.push(async () => await fs.rm(root, { recursive: true, force: true }));
    const extensionPath = path.dirname(fileURLToPath(import.meta.url));
    const profileDir = path.join(root, "profile");
    const server = http.createServer((request, response) => {
      response.setHeader("content-type", "text/html; charset=utf-8");
      if (request.url === "/root") {
        response.end(
          `<a id="child" href="/child" target="_blank" rel="opener">child</a><button id="popup" onclick="window.open('/popup', 'openclaw-popup', 'popup,width=480,height=320')">popup</button>`,
        );
        return;
      }
      response.end(request.url ?? "missing");
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    cleanups.push(
      async () =>
        await new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        }),
    );
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("fixture server did not expose a port");
    }
    const baseUrl = `http://127.0.0.1:${address.port}`;

    let context = await launch(profileDir, extensionPath);
    cleanups.push(async () => await context.close());
    const seedWorker = await extensionWorker(context);
    await seedWorker.evaluate(
      async ({ token }) => {
        await chrome.storage.local.set({
          accessMode: "selected",
          authVersion: 2,
          gatewayUrl: "",
          groupColor: "blue",
          relayUrl: "ws://127.0.0.1:9/extension",
          token,
        });
      },
      { token: relayTestKey(8) },
    );
    await context.close();

    context = await launch(profileDir, extensionPath);
    const unrelatedPage = context.pages()[0] ?? (await context.newPage());
    await unrelatedPage.goto(`${baseUrl}/unrelated`);
    const rootPage = await context.newPage();
    await rootPage.goto(`${baseUrl}/root`);
    const worker = await extensionWorker(context);
    const rootState = await worker.evaluate(async (url) => {
      const tab = (await chrome.tabs.query({})).find((candidate) => candidate.url === url);
      if (typeof tab?.id !== "number") {
        throw new Error("root fixture tab missing");
      }
      const groupId = await chrome.tabs.group({ tabIds: [tab.id] });
      await chrome.tabGroups.update(groupId, { color: "blue", title: "OpenClaw" });
      return { groupId, windowId: tab.windowId };
    }, `${baseUrl}/root`);

    const popupPage = context.waitForEvent("page", {
      predicate: (candidate) => candidate.url() === `${baseUrl}/popup`,
      timeout: 10_000,
    });
    await rootPage.locator("#popup").click();
    await popupPage;
    const childPage = context.waitForEvent("page", {
      predicate: (candidate) => candidate.url() === `${baseUrl}/child`,
      timeout: 10_000,
    });
    await rootPage.locator("#child").click();
    await childPage;

    await expect
      .poll(
        async () =>
          await worker.evaluate(
            async ({ baseUrl: fixtureBaseUrl, rootState: evaluatedRootState }) => {
              const relevant = (await chrome.tabs.query({}))
                .filter((tab) => tab.url?.startsWith(fixtureBaseUrl))
                .map((tab) => ({
                  groupId: tab.groupId,
                  url: tab.url,
                  windowId: tab.windowId,
                }));
              const group = (await chrome.tabGroups.query({})).find(
                (candidate) => candidate.id === evaluatedRootState.groupId,
              );
              return { group, relevant };
            },
            { baseUrl, rootState },
          ),
        { timeout: 10_000 },
      )
      .toEqual({
        group: expect.objectContaining({
          id: rootState.groupId,
          title: "OpenClaw",
          windowId: rootState.windowId,
        }),
        relevant: expect.arrayContaining([
          {
            groupId: -1,
            url: `${baseUrl}/unrelated`,
            windowId: rootState.windowId,
          },
          {
            groupId: rootState.groupId,
            url: `${baseUrl}/root`,
            windowId: rootState.windowId,
          },
          {
            groupId: rootState.groupId,
            url: `${baseUrl}/popup`,
            windowId: rootState.windowId,
          },
          {
            groupId: rootState.groupId,
            url: `${baseUrl}/child`,
            windowId: rootState.windowId,
          },
        ]),
      });

    const childTabId = await worker.evaluate(async (url) => {
      const tab = (await chrome.tabs.query({})).find((candidate) => candidate.url === url);
      if (typeof tab?.id !== "number") {
        throw new Error("child fixture tab missing");
      }
      await chrome.tabs.ungroup([tab.id]);
      return tab.id;
    }, `${baseUrl}/child`);
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 500);
    });
    await expect
      .poll(
        async () =>
          await worker.evaluate(async (tabId) => {
            const tab = (await chrome.tabs.query({})).find((candidate) => candidate.id === tabId);
            return tab?.groupId;
          }, childTabId),
        { timeout: 5_000 },
      )
      .toBe(-1);
  });
});
