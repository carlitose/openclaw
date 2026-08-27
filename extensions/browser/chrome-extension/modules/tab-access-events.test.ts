import { afterEach, describe, expect, it, vi } from "vitest";
import { registerTabAccessEvents } from "./tab-access-events.js";

function deferred<T>() {
  let resolve = (_value: T) => {};
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function accessState(accessible: boolean, url = "https://two.example") {
  return {
    accessible,
    eligible: accessible,
    denied: false,
    reason: accessible ? null : ("revoked" as const),
    tab: accessible ? { id: 7, url, windowId: 3 } : null,
  };
}

function createHarness(
  mode: "all" | "selected" = "selected",
  accessReady: Promise<unknown> = Promise.resolve(),
) {
  let debuggerEventListener:
    | ((source: { tabId?: number }, method: string, params: unknown) => void)
    | undefined;
  let debuggerDetachListener: ((source: { tabId?: number }, reason: string) => void) | undefined;
  let tabsUpdatedListener:
    | ((tabId: number, changeInfo: { groupId?: number; url?: string }) => void)
    | undefined;
  let tabsReplacedListener: ((addedTabId: number, removedTabId: number) => void) | undefined;
  let groupUpdatedListener: (() => void) | undefined;
  let revision = 0;
  let accessible = true;
  const attachedTabs = new Set([7]);
  const attachedAccessEpochs = new Map([[7, { revision: 0, tabRevision: 0 }]]);
  const attachmentTokens = new Map([[7, Symbol("attachment-7")]]);
  const attachingTabs = new Map<number, Promise<unknown>>();
  const send = vi.fn();
  let bindingName: string | undefined;
  const sendCommand = vi.fn(async (_target, method, params) => {
    if (method === "Page.getFrameTree") {
      return {
        frameTree: {
          frame: { id: "frame-7", loaderId: "loader-7", url: "https://two.example" },
        },
      };
    }
    if (method === "Runtime.addBinding") {
      bindingName = params?.name;
      return {};
    }
    if (method === "Runtime.evaluate" && bindingName) {
      debuggerEventListener?.({ tabId: 7 }, "Runtime.bindingCalled", {
        name: bindingName,
        payload: "",
        executionContextId: 17,
      });
      return {};
    }
    if (method === "Page.createIsolatedWorld") {
      return { executionContextId: 18 };
    }
    return {};
  });
  const policy = {
    mode,
    beginRevocation: vi.fn(() => Symbol("revocation")),
    endRevocation: vi.fn(),
    capture: vi.fn(() => ({ revision, tabRevision: 0 })),
    epochIsCurrent: vi.fn(
      (_tabId: number, epoch: { revision: number }) => epoch.revision === revision,
    ),
    invalidateTab: vi.fn((_tabId: number) => {
      revision += 1;
    }),
    invalidateAll: vi.fn(() => {
      revision += 1;
    }),
    inspectTab: vi.fn(async (_tabId: number, epoch: { revision: number }) =>
      accessState(accessible && epoch.revision === revision),
    ),
    listAccessibleTabs: vi.fn(async () => (accessible ? [{ id: 7 }] : [])),
    forgetTab: vi.fn(async () => undefined),
    replaceTab: vi.fn(async () => false),
  };
  const detachDebugger = vi.fn(async (tabId: number) => {
    attachedTabs.delete(tabId);
    attachedAccessEpochs.delete(tabId);
  });
  const pauseTab = vi.fn(async () => undefined);
  const removeTabFromOpenClawGroup = vi.fn(async () => undefined);
  const chromeApi = {
    debugger: {
      sendCommand,
      onEvent: {
        addListener: (listener: typeof debuggerEventListener) => {
          debuggerEventListener = listener;
        },
      },
      onDetach: {
        addListener: (listener: typeof debuggerDetachListener) => {
          debuggerDetachListener = listener;
        },
      },
    },
    tabs: {
      onRemoved: { addListener: vi.fn() },
      onReplaced: {
        addListener: (listener: typeof tabsReplacedListener) => {
          tabsReplacedListener = listener;
        },
      },
      onUpdated: {
        addListener: (listener: typeof tabsUpdatedListener) => {
          tabsUpdatedListener = listener;
        },
      },
    },
    tabGroups: {
      onUpdated: {
        addListener: (listener: () => void) => {
          groupUpdatedListener = listener;
        },
      },
      onRemoved: { addListener: vi.fn() },
    },
  };

  registerTabAccessEvents({
    chromeApi,
    accessReady,
    policy,
    attachedTabs,
    attachedAccessEpochs,
    attachmentTokens,
    attachingTabs,
    send,
    scheduleTabsSync: vi.fn(),
    detachDebugger,
    pauseTab,
    removeTabFromOpenClawGroup,
    runAccessMutation: vi.fn(async (task) => await task()),
    getUtilityWorldName: () => "__playwright_utility_world_page-guid",
    forgetUtilityWorld: vi.fn(),
  });
  if (
    !debuggerEventListener ||
    !debuggerDetachListener ||
    !tabsUpdatedListener ||
    !tabsReplacedListener ||
    !groupUpdatedListener
  ) {
    throw new Error("expected tab access event listeners");
  }
  return {
    attachedAccessEpochs,
    attachmentTokens,
    attachingTabs,
    detachDebugger,
    debuggerDetachListener,
    debuggerEventListener,
    groupUpdatedListener,
    policy,
    pauseTab,
    removeTabFromOpenClawGroup,
    send,
    sendCommand,
    setAccessible: (next: boolean) => {
      accessible = next;
    },
    tabsUpdatedListener,
    tabsReplacedListener,
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("tab access event epochs", () => {
  it("waits for stored access mode before handling Chrome's cancel revocation", async () => {
    const ready = deferred<void>();
    const harness = createHarness("selected", ready.promise);

    harness.debuggerDetachListener({ tabId: 7 }, "canceled_by_user");
    expect(harness.policy.beginRevocation).toHaveBeenCalledWith(7);
    expect(harness.pauseTab).not.toHaveBeenCalled();
    expect(harness.removeTabFromOpenClawGroup).not.toHaveBeenCalled();

    harness.policy.mode = "all";
    ready.resolve();
    await vi.waitFor(() => expect(harness.pauseTab).toHaveBeenCalledWith(7));

    expect(harness.removeTabFromOpenClawGroup).not.toHaveBeenCalled();
    expect(harness.policy.endRevocation).toHaveBeenCalledOnce();
  });

  it.each([
    {
      label: "all-mode URL",
      mode: "all",
      firstChange: { url: "https://one.example" },
      secondChange: { url: "https://two.example" },
    },
    {
      label: "selected-mode URL",
      mode: "selected",
      firstChange: { url: "https://one.example" },
      secondChange: { url: "https://two.example" },
    },
    {
      label: "selected-mode group",
      mode: "selected",
      firstChange: { groupId: 7 },
      secondChange: { groupId: 7 },
    },
  ] as const)(
    "ignores a stale $label revocation after a newer eligible update",
    async ({ mode, firstChange, secondChange }) => {
      const harness = createHarness(mode);
      const firstInspection = deferred<ReturnType<typeof accessState>>();
      let firstInspectionResumed = false;
      harness.policy.inspectTab
        .mockImplementationOnce(async () => {
          const state = await firstInspection.promise;
          firstInspectionResumed = true;
          return state;
        })
        .mockResolvedValueOnce(accessState(true));

      harness.tabsUpdatedListener(7, firstChange);
      await vi.waitFor(() => expect(harness.policy.inspectTab).toHaveBeenCalledTimes(1));
      harness.tabsUpdatedListener(7, secondChange);
      await vi.waitFor(() => {
        expect(harness.attachedAccessEpochs.get(7)).toEqual({ revision: 2, tabRevision: 0 });
      });

      firstInspection.resolve(accessState(false));
      await vi.waitFor(() => expect(firstInspectionResumed).toBe(true));
      await Promise.resolve();

      expect(harness.detachDebugger).not.toHaveBeenCalled();
      harness.debuggerEventListener({ tabId: 7 }, "Runtime.consoleAPICalled", {});
      expect(harness.send).toHaveBeenCalledWith(
        expect.objectContaining({ type: "cdpEvent", tabId: 7 }),
      );
    },
  );

  it("resynchronizes current document state only after the new URL is proven accessible", async () => {
    const harness = createHarness("all");
    const inspection = deferred<ReturnType<typeof accessState>>();
    let bindingName: string | undefined;
    harness.policy.inspectTab.mockImplementationOnce(async () => await inspection.promise);
    harness.sendCommand.mockImplementation(async (_target, method, params) => {
      if (method === "Page.getFrameTree") {
        return {
          frameTree: {
            frame: { id: "frame-7", loaderId: "loader-7", url: "https://two.example" },
          },
        };
      }
      if (method === "Runtime.addBinding") {
        bindingName = params?.name;
        return {};
      }
      if (method === "Runtime.evaluate" && bindingName) {
        harness.debuggerEventListener({ tabId: 7 }, "Runtime.bindingCalled", {
          name: bindingName,
          payload: "",
          executionContextId: 17,
        });
        return {};
      }
      if (method === "Page.createIsolatedWorld") {
        harness.tabsUpdatedListener(7, {});
        await vi.waitFor(() => {
          expect(harness.attachedAccessEpochs.get(7)).toEqual({ revision: 1, tabRevision: 0 });
        });
        return { executionContextId: 18 };
      }
      if (method === "Page.setLifecycleEventsEnabled") {
        harness.debuggerEventListener({ tabId: 7 }, "Page.lifecycleEvent", {
          frameId: "frame-7",
          loaderId: "loader-7",
          name: "load",
          timestamp: 1,
        });
      }
      return {};
    });

    harness.tabsUpdatedListener(7, { url: "https://two.example" });
    harness.debuggerEventListener({ tabId: 7 }, "Page.lifecycleEvent", {
      frameId: "frame-7",
      loaderId: "loader-7",
      name: "load",
      timestamp: 1,
    });
    expect(harness.send).not.toHaveBeenCalled();

    inspection.resolve(accessState(true));
    await vi.waitFor(() => expect(harness.sendCommand).toHaveBeenCalledTimes(6));

    expect(harness.sendCommand).toHaveBeenNthCalledWith(1, { tabId: 7 }, "Page.getFrameTree");
    expect(bindingName).toMatch(/^__openclaw_context_probe_[0-9a-f-]+$/u);
    expect(harness.sendCommand).toHaveBeenNthCalledWith(2, { tabId: 7 }, "Runtime.addBinding", {
      name: bindingName,
      executionContextName: "",
    });
    const bindingReference = `globalThis[${JSON.stringify(bindingName)}]`;
    expect(harness.sendCommand).toHaveBeenNthCalledWith(3, { tabId: 7 }, "Runtime.evaluate", {
      expression: `try { ${bindingReference}(""); } finally { delete ${bindingReference}; }`,
      silent: true,
    });
    expect(harness.sendCommand).toHaveBeenNthCalledWith(4, { tabId: 7 }, "Runtime.removeBinding", {
      name: bindingName,
    });
    expect(harness.sendCommand).toHaveBeenNthCalledWith(
      5,
      { tabId: 7 },
      "Page.createIsolatedWorld",
      {
        frameId: "frame-7",
        worldName: "__playwright_utility_world_page-guid",
        grantUniveralAccess: true,
      },
    );
    expect(harness.sendCommand).toHaveBeenNthCalledWith(
      6,
      { tabId: 7 },
      "Page.setLifecycleEventsEnabled",
      { enabled: true },
    );
    expect(harness.send).toHaveBeenCalledWith({
      type: "cdpEvent",
      tabId: 7,
      method: "Runtime.executionContextCreated",
      params: {
        context: {
          id: 17,
          origin: "",
          name: "",
          auxData: { frameId: "frame-7", isDefault: true, type: "default" },
        },
      },
    });
    expect(harness.send).toHaveBeenCalledWith({
      type: "cdpEvent",
      tabId: 7,
      method: "Page.frameNavigated",
      params: {
        frame: { id: "frame-7", loaderId: "loader-7", url: "https://two.example" },
        type: "Navigation",
      },
    });
    expect(harness.send).toHaveBeenCalledWith({
      type: "cdpEvent",
      tabId: 7,
      method: "Runtime.executionContextCreated",
      params: {
        context: {
          id: 18,
          origin: "",
          name: "__playwright_utility_world_page-guid",
          auxData: { frameId: "frame-7", isDefault: false, type: "isolated" },
        },
      },
    });
    expect(harness.send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "cdpEvent",
        tabId: 7,
        method: "Page.lifecycleEvent",
      }),
    );
    expect(harness.send).not.toHaveBeenCalledWith(
      expect.objectContaining({ method: "Runtime.bindingCalled" }),
    );
  });

  it("does not resynchronize a replacement debugger attachment", async () => {
    const harness = createHarness("all");
    const frameTree = deferred<Record<string, unknown>>();
    harness.sendCommand.mockImplementation(async (_target, method) => {
      if (method === "Page.getFrameTree") {
        return await frameTree.promise;
      }
      return {};
    });

    harness.tabsUpdatedListener(7, { url: "https://two.example" });
    await vi.waitFor(() => expect(harness.sendCommand).toHaveBeenCalledTimes(1));
    harness.attachmentTokens.set(7, Symbol("replacement-attachment"));
    frameTree.resolve({
      frameTree: {
        frame: { id: "frame-7", loaderId: "loader-7", url: "https://two.example" },
      },
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(harness.sendCommand).toHaveBeenCalledTimes(1);
    expect(harness.send).not.toHaveBeenCalled();
  });

  it("removes a context probe when access changes after binding installation", async () => {
    const harness = createHarness("all");
    let bindingName: string | undefined;
    harness.sendCommand.mockImplementation(async (_target, method, params) => {
      if (method === "Page.getFrameTree") {
        return {
          frameTree: {
            frame: { id: "frame-7", loaderId: "loader-7", url: "https://two.example" },
          },
        };
      }
      if (method === "Runtime.addBinding") {
        bindingName = params?.name;
        harness.policy.invalidateTab(7);
      }
      return {};
    });

    harness.tabsUpdatedListener(7, { url: "https://two.example" });
    await vi.waitFor(() => expect(harness.sendCommand).toHaveBeenCalledTimes(3));

    expect(harness.sendCommand).toHaveBeenNthCalledWith(3, { tabId: 7 }, "Runtime.removeBinding", {
      name: bindingName,
    });
    expect(harness.sendCommand).not.toHaveBeenCalledWith(
      { tabId: 7 },
      "Runtime.evaluate",
      expect.anything(),
    );
    expect(harness.send).not.toHaveBeenCalled();
  });

  it("keeps the current context probe when a stale URL probe finishes first", async () => {
    const harness = createHarness("all");
    const firstBinding = deferred<void>();
    const secondBinding = deferred<void>();
    const bindingNames: string[] = [];
    let frameTreeCount = 0;
    harness.policy.inspectTab.mockImplementation(async (_tabId, epoch) =>
      accessState(true, epoch.revision === 1 ? "https://one.example" : "https://two.example"),
    );
    harness.sendCommand.mockImplementation(async (_target, method, params) => {
      if (method === "Page.getFrameTree") {
        frameTreeCount += 1;
        const suffix = frameTreeCount === 1 ? "one" : "two";
        return {
          frameTree: {
            frame: {
              id: `frame-${suffix}`,
              loaderId: `loader-${suffix}`,
              url: `https://${suffix}.example`,
            },
          },
        };
      }
      if (method === "Runtime.addBinding") {
        bindingNames.push(params?.name);
        await (bindingNames.length === 1 ? firstBinding.promise : secondBinding.promise);
        return {};
      }
      if (method === "Runtime.evaluate") {
        const currentBinding = bindingNames[1];
        harness.debuggerEventListener({ tabId: 7 }, "Runtime.bindingCalled", {
          name: currentBinding,
          payload: "",
          executionContextId: 27,
        });
        return {};
      }
      if (method === "Page.createIsolatedWorld") {
        return { executionContextId: 28 };
      }
      return {};
    });

    harness.tabsUpdatedListener(7, { url: "https://one.example" });
    await vi.waitFor(() => expect(bindingNames).toHaveLength(1));
    harness.tabsUpdatedListener(7, { url: "https://two.example" });
    await vi.waitFor(() => expect(bindingNames).toHaveLength(2));

    firstBinding.resolve();
    await vi.waitFor(() =>
      expect(harness.sendCommand).toHaveBeenCalledWith({ tabId: 7 }, "Runtime.removeBinding", {
        name: bindingNames[0],
      }),
    );
    secondBinding.resolve();
    await vi.waitFor(() =>
      expect(harness.send).toHaveBeenCalledWith(
        expect.objectContaining({ method: "Page.frameNavigated", tabId: 7 }),
      ),
    );

    expect(harness.send).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "Runtime.executionContextCreated",
        params: expect.objectContaining({ context: expect.objectContaining({ id: 27 }) }),
      }),
    );
  });

  it.each([
    {
      label: "all-mode URL",
      mode: "all",
      firstChange: { url: "https://one.example" },
      secondChange: { url: "chrome://settings" },
    },
    {
      label: "selected-mode URL",
      mode: "selected",
      firstChange: { url: "https://one.example" },
      secondChange: { url: "chrome://settings" },
    },
    {
      label: "selected-mode group",
      mode: "selected",
      firstChange: { groupId: 7 },
      secondChange: { groupId: -1 },
    },
  ] as const)(
    "lets the current restricted $label update revoke exactly once when an older update resumes",
    async ({ mode, firstChange, secondChange }) => {
      const harness = createHarness(mode);
      const firstInspection = deferred<ReturnType<typeof accessState>>();
      let firstInspectionResumed = false;
      harness.policy.inspectTab
        .mockImplementationOnce(async () => {
          const state = await firstInspection.promise;
          firstInspectionResumed = true;
          return state;
        })
        .mockResolvedValueOnce(accessState(false));

      harness.tabsUpdatedListener(7, firstChange);
      await vi.waitFor(() => expect(harness.policy.inspectTab).toHaveBeenCalledTimes(1));
      harness.tabsUpdatedListener(7, secondChange);
      await vi.waitFor(() => {
        expect(harness.detachDebugger).toHaveBeenCalledTimes(1);
      });

      firstInspection.resolve(accessState(false));
      await vi.waitFor(() => expect(firstInspectionResumed).toBe(true));
      await Promise.resolve();

      expect(harness.detachDebugger).toHaveBeenCalledTimes(1);
    },
  );

  it("cleans up both tab identities after Chrome replaces a paused tab", async () => {
    const harness = createHarness("all");
    harness.policy.replaceTab.mockResolvedValueOnce(true);

    harness.tabsReplacedListener(8, 7);

    await vi.waitFor(() => {
      expect(harness.policy.replaceTab).toHaveBeenCalledWith(8, 7);
      expect(harness.detachDebugger).toHaveBeenCalledWith(7);
      expect(harness.detachDebugger).toHaveBeenCalledWith(8);
    });
  });

  it("lets a newer eligible tab event own stale group-wide reconciliation", async () => {
    const harness = createHarness("selected");
    const groupInspection = deferred<ReturnType<typeof accessState>>();
    harness.policy.inspectTab
      .mockImplementationOnce(async () => await groupInspection.promise)
      .mockResolvedValueOnce(accessState(true));

    harness.groupUpdatedListener();
    harness.debuggerEventListener({ tabId: 7 }, "Page.frameNavigated", {});
    expect(harness.send).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(harness.policy.inspectTab).toHaveBeenCalledTimes(1));

    harness.tabsUpdatedListener(7, { url: "https://two.example" });
    await vi.waitFor(() => {
      expect(harness.attachedAccessEpochs.get(7)).toEqual({ revision: 2, tabRevision: 0 });
    });
    groupInspection.resolve(accessState(false));
    await Promise.resolve();

    expect(harness.detachDebugger).not.toHaveBeenCalled();
  });

  it("does not refresh epochs from a stale group-wide access snapshot", async () => {
    vi.stubGlobal("chrome", { tabGroups: { get: vi.fn() } });
    const harness = createHarness();
    const firstList = deferred<Array<{ id: number }>>();
    harness.policy.listAccessibleTabs
      .mockImplementationOnce(async () => await firstList.promise)
      .mockResolvedValueOnce([{ id: 7 }]);

    harness.groupUpdatedListener();
    await vi.waitFor(() => expect(harness.policy.listAccessibleTabs).toHaveBeenCalledTimes(1));
    harness.groupUpdatedListener();
    await vi.waitFor(() => expect(harness.policy.listAccessibleTabs).toHaveBeenCalledTimes(2));
    harness.setAccessible(false);
    harness.policy.invalidateTab(7);
    firstList.resolve([{ id: 7 }]);
    await Promise.resolve();

    harness.debuggerEventListener({ tabId: 7 }, "Network.requestWillBeSent", {});
    expect(harness.send).not.toHaveBeenCalled();
  });
});
