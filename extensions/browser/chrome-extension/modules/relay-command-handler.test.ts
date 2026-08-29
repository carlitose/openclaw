import { afterEach, describe, expect, it, vi } from "vitest";
import { createRelayCommandHandler } from "./relay-command-handler.js";
import { createTaskTabLifecycle } from "./task-tab-lifecycle.js";

function createHarness() {
  const send = vi.fn();
  const epoch = { revision: 1, tabRevision: 2 };
  const requireAccessibleTab = vi.fn(async () => ({ id: 7, windowId: 3 }));
  const rememberUtilityWorld = vi.fn();
  const focusWindowForTab = vi.fn(async () => undefined);
  const addTabToOpenClawGroup = vi.fn(async () => undefined);
  const chromeMock = {
    debugger: { sendCommand: vi.fn(async () => ({ value: 1 })) },
    tabs: {
      create: vi.fn(),
      get: vi.fn(async (): Promise<{ id: number } | null> => {
        throw new Error("No tab with id");
      }),
      remove: vi.fn(async () => undefined),
      update: vi.fn(async () => undefined),
    },
  };
  vi.stubGlobal("chrome", chromeMock);
  const taskTabs = createTaskTabLifecycle({
    chromeApi: chromeMock,
    newGeneration: () => "task-generation-1",
  });
  const attachCreatedDebugger = vi.fn(async () => ({ targetId: "target-created" }));
  const syncTabsToRelay = vi.fn(async (): Promise<void> => undefined);
  const handler = createRelayCommandHandler({
    send,
    attachDebugger: vi.fn(),
    detachDebugger: vi.fn(async () => undefined),
    addTabToOpenClawGroup,
    focusWindowForTab,
    scheduleTabsSync: vi.fn(),
    syncTabsToRelay,
    captureAccess: vi.fn(() => epoch),
    requireAccessibleTab,
    rememberUtilityWorld,
    attachCreatedDebugger,
    taskTabs,
  });
  return {
    chromeMock,
    addTabToOpenClawGroup,
    attachCreatedDebugger,
    epoch,
    focusWindowForTab,
    handler,
    rememberUtilityWorld,
    requireAccessibleTab,
    send,
    syncTabsToRelay,
    taskTabs,
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("relay authority rechecks", () => {
  it("checks access before and after an async CDP command", async () => {
    const harness = createHarness();
    await harness.handler({ type: "cdp", seq: 1, tabId: 7, method: "Runtime.evaluate" });
    expect(harness.requireAccessibleTab.mock.calls).toEqual([
      [7, harness.epoch],
      [7, harness.epoch],
    ]);
    expect(harness.send).toHaveBeenCalledWith({ type: "result", seq: 1, result: { value: 1 } });
  });

  it("allows only the exact task generation to perform its first navigation", async () => {
    const harness = createHarness();
    const taskGeneration = harness.taskTabs.registerRoot(7);

    await harness.handler({
      type: "cdp",
      seq: 8,
      tabId: 7,
      method: "Page.navigate",
      params: { url: "https://example.com" },
      taskGeneration,
    });

    expect(harness.requireAccessibleTab).not.toHaveBeenCalled();
    expect(harness.chromeMock.debugger.sendCommand).toHaveBeenCalledWith(
      { tabId: 7 },
      "Page.navigate",
      { url: "https://example.com" },
    );

    await harness.handler({
      type: "cdp",
      seq: 9,
      tabId: 7,
      method: "Page.navigate",
      params: { url: "https://example.com/next" },
      taskGeneration: "stale-task-generation",
    });
    expect(harness.requireAccessibleTab).toHaveBeenCalledTimes(2);
  });

  it("allows the exact task generation to initialize its hidden page", async () => {
    const harness = createHarness();
    const taskGeneration = harness.taskTabs.registerRoot(7);

    await harness.handler({
      type: "cdp",
      seq: 10,
      tabId: 7,
      method: "Page.enable",
      taskGeneration,
    });

    expect(harness.requireAccessibleTab).not.toHaveBeenCalled();
    expect(harness.chromeMock.debugger.sendCommand).toHaveBeenCalledWith(
      { tabId: 7 },
      "Page.enable",
      {},
    );
  });

  it("ends bootstrap authority only after the relay publishes the exact task", async () => {
    const harness = createHarness();
    const taskGeneration = harness.taskTabs.registerRoot(7);
    let finishSync: (() => void) | undefined;
    harness.syncTabsToRelay.mockImplementationOnce(
      async () =>
        await new Promise<void>((resolve) => {
          finishSync = resolve;
        }),
    );

    const publishing = harness.handler({
      type: "publishTask",
      seq: 12,
      tabId: 7,
      taskGeneration,
    });

    expect(harness.taskTabs.isInitializing(7)).toBe(false);
    await vi.waitFor(() => expect(harness.syncTabsToRelay).toHaveBeenCalledOnce());
    expect(harness.send).not.toHaveBeenCalled();
    finishSync?.();
    await publishing;
    expect(harness.send).toHaveBeenCalledWith({ type: "result", seq: 12, result: {} });

    await harness.handler({
      type: "cdp",
      seq: 13,
      tabId: 7,
      method: "Page.enable",
      taskGeneration,
    });
    expect(harness.requireAccessibleTab).toHaveBeenCalledTimes(2);
  });

  it("does not turn task ownership into general CDP authority", async () => {
    const harness = createHarness();
    const taskGeneration = harness.taskTabs.registerRoot(7);

    await harness.handler({
      type: "cdp",
      seq: 11,
      tabId: 7,
      method: "Runtime.evaluate",
      params: { expression: "location.href='https://example.com'" },
      taskGeneration,
    });

    expect(harness.requireAccessibleTab).toHaveBeenCalledTimes(2);
  });

  it("remembers the root automation world only after the command remains authorized", async () => {
    const harness = createHarness();
    await harness.handler({
      type: "cdp",
      seq: 5,
      tabId: 7,
      method: "Page.addScriptToEvaluateOnNewDocument",
      params: { source: "", worldName: "__automation_world" },
    });

    expect(harness.rememberUtilityWorld).toHaveBeenCalledWith(7, "__automation_world");
  });

  it("checks access around tab activation and window focus", async () => {
    const harness = createHarness();
    await harness.handler({ type: "activateTab", seq: 2, tabId: 7 });
    expect(harness.requireAccessibleTab).toHaveBeenCalledTimes(3);
    expect(harness.chromeMock.tabs.update).toHaveBeenCalledWith(7, { active: true });
    expect(harness.focusWindowForTab).toHaveBeenCalled();
  });

  it("checks access immediately before close and reports the successful removal", async () => {
    const harness = createHarness();
    await harness.handler({ type: "closeTab", seq: 3, tabId: 7 });
    expect(harness.requireAccessibleTab.mock.calls).toEqual([
      [7, harness.epoch],
      [7, harness.epoch],
    ]);
    expect(harness.chromeMock.tabs.remove).toHaveBeenCalledWith(7);
    expect(harness.send).toHaveBeenCalledWith({ type: "result", seq: 3, result: {} });
  });

  it("does not report a post-operation result when access changes during CDP", async () => {
    const harness = createHarness();
    harness.requireAccessibleTab
      .mockResolvedValueOnce({ id: 7, windowId: 3 })
      .mockRejectedValueOnce(new Error("tab 7 access was revoked"));
    await harness.handler({ type: "cdp", seq: 4, tabId: 7, method: "Runtime.evaluate" });
    expect(harness.send).toHaveBeenCalledWith({
      type: "error",
      seq: 4,
      message: "tab 7 access was revoked",
    });
    expect(harness.rememberUtilityWorld).not.toHaveBeenCalled();
  });

  it("removes the exact physical tab when group authorization fails", async () => {
    const harness = createHarness();
    harness.chromeMock.tabs.create.mockResolvedValue({ id: 41, windowId: 3 });
    harness.addTabToOpenClawGroup.mockRejectedValue(new Error("group denied"));

    await harness.handler({ type: "createTab", seq: 6, url: "https://example.com" });

    expect(harness.chromeMock.tabs.remove).toHaveBeenCalledWith(41);
    expect(harness.send).toHaveBeenCalledWith({
      type: "error",
      seq: 6,
      message: "group denied",
      details: {
        kind: "tab-creation-failed",
        tabId: 41,
        cleanup: { status: "complete", remainingTabIds: [], errors: [] },
      },
    });
  });

  it("reports both attach failure and incomplete exact cleanup", async () => {
    const harness = createHarness();
    harness.chromeMock.tabs.create.mockResolvedValue({ id: 42, windowId: 3 });
    harness.attachCreatedDebugger.mockRejectedValue(new Error("debugger attach denied"));
    harness.chromeMock.tabs.remove.mockRejectedValue(new Error("tab removal denied"));
    harness.chromeMock.tabs.get.mockResolvedValue({ id: 42 });

    await harness.handler({ type: "createTab", seq: 7, url: "about:blank" });

    expect(harness.send).toHaveBeenCalledWith({
      type: "error",
      seq: 7,
      message:
        "debugger attach denied; exact tab cleanup is incomplete—close tab 42 manually before retrying",
      details: {
        kind: "tab-creation-failed",
        tabId: 42,
        cleanup: {
          status: "incomplete",
          remainingTabIds: [42],
          errors: [{ tabId: 42, message: "tab removal denied" }],
        },
      },
    });
  });
});
