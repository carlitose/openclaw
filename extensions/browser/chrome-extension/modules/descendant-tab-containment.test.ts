import { afterEach, describe, expect, it, vi } from "vitest";
import { createDescendantTabContainment } from "./descendant-tab-containment.js";

type Tab = {
  id?: number;
  openerTabId?: number;
  groupId?: number;
  url?: string;
  pendingUrl?: string;
  windowId?: number;
};

function deferred<T>() {
  let resolve = (_value: T) => {};
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function createHarness({
  child = { id: 8, openerTabId: 7, groupId: -1, url: "https://child.example", windowId: 1 },
  openerAccessible = true,
  classifyNavigation = vi.fn(() => "allowed" as const),
  accessReady = Promise.resolve(),
}: {
  child?: Tab;
  openerAccessible?: boolean;
  classifyNavigation?: (
    tab: Tab,
  ) => "pending" | "allowed" | "denied" | Promise<"pending" | "allowed" | "denied">;
  accessReady?: Promise<unknown>;
} = {}) {
  let openerRevision = 0;
  const tabs = new Map<number, Tab>([
    [7, { id: 7, groupId: 23, url: "https://root.example", windowId: 1 }],
    [child.id!, child],
  ]);
  const policy = {
    beginRevocation: vi.fn(() => Symbol("descendant-revocation")),
    endRevocation: vi.fn(),
    capture: vi.fn(() => ({ revision: openerRevision, tabRevision: 0 })),
    epochIsCurrent: vi.fn(
      (_tabId: number, epoch: { revision: number }) => epoch.revision === openerRevision,
    ),
    inspectTab: vi.fn(async (tabId: number, epoch: { revision: number }) => ({
      accessible:
        tabId === 7 && openerAccessible && epoch.revision === openerRevision && tabs.has(tabId),
      tab: tabs.get(tabId) ?? null,
    })),
  };
  const placeTabInGroup = vi.fn(async (tabId: number, groupId: number) => {
    const current = tabs.get(tabId);
    if (!current) {
      throw new Error("tab closed");
    }
    tabs.set(tabId, { ...current, groupId, windowId: 1 });
  });
  const removeTabFromGroup = vi.fn(async (tabId: number) => {
    const current = tabs.get(tabId);
    if (current) {
      tabs.set(tabId, { ...current, groupId: -1 });
    }
  });
  const scheduleTabsSync = vi.fn();
  const containment = createDescendantTabContainment({
    chromeApi: {
      tabs: {
        get: vi.fn(async (tabId: number) => {
          const tab = tabs.get(tabId);
          if (!tab) {
            throw new Error("tab closed");
          }
          return { ...tab };
        }),
      },
    },
    accessReady,
    policy,
    isTabInOpenClawGroup: (tab) => tab.groupId === 23 && openerAccessible,
    classifyNavigation,
    placeTabInGroup,
    removeTabFromGroup,
    scheduleTabsSync,
    runAccessMutation: async (task) => await task(),
    pendingTimeoutMs: 1_000,
  });
  return {
    classifyNavigation,
    containment,
    invalidateOpener: () => {
      openerRevision += 1;
    },
    placeTabInGroup,
    policy,
    removeTabFromGroup,
    scheduleTabsSync,
    tabs,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("descendant tab containment", () => {
  it.each([
    ["normal child", 1],
    ["popup-window child", 2],
  ] as const)(
    "keeps a %s behind a barrier until it inherits the opener's exact group",
    async (_label, windowId) => {
      const ready = deferred<void>();
      const child = {
        id: 8,
        openerTabId: 7,
        groupId: -1,
        url: "https://child.example",
        windowId,
      };
      const harness = createHarness({ child, accessReady: ready.promise });

      harness.containment.onCreated(child);

      expect(harness.policy.beginRevocation).toHaveBeenCalledWith(8);
      expect(harness.placeTabInGroup).not.toHaveBeenCalled();
      ready.resolve();
      await vi.waitFor(() => expect(harness.placeTabInGroup).toHaveBeenCalledWith(8, 23));

      expect(harness.policy.endRevocation).toHaveBeenCalledOnce();
      expect(harness.scheduleTabsSync).toHaveBeenCalledOnce();
    },
  );

  it("keeps about:blank pending and publishes only the first admitted destination", async () => {
    const child = { id: 8, openerTabId: 7, groupId: -1, url: "about:blank", windowId: 1 };
    const classifyNavigation = vi
      .fn()
      .mockResolvedValueOnce("pending")
      .mockResolvedValueOnce("allowed");
    const harness = createHarness({ child, classifyNavigation });

    harness.containment.onCreated(child);
    await vi.waitFor(() => expect(classifyNavigation).toHaveBeenCalledOnce());
    expect(harness.placeTabInGroup).not.toHaveBeenCalled();
    expect(harness.policy.endRevocation).not.toHaveBeenCalled();

    harness.tabs.set(8, {
      ...child,
      pendingUrl: "https://child.example/ready",
    });
    harness.containment.onUpdated(8, { url: "https://child.example/ready" });
    await vi.waitFor(() => expect(harness.placeTabInGroup).toHaveBeenCalledWith(8, 23));
    expect(harness.policy.endRevocation).toHaveBeenCalledOnce();
  });

  it.each([
    ["missing opener", { id: 8, url: "https://child.example" }],
    ["same child and opener", { id: 8, openerTabId: 8, url: "https://child.example" }],
    ["missing child id", { openerTabId: 7, url: "https://child.example" }],
  ])("ignores a child with %s", async (_label, child) => {
    const harness = createHarness({ child: { id: 8, ...child } });

    harness.containment.onCreated(child);
    await Promise.resolve();

    expect(harness.policy.beginRevocation).not.toHaveBeenCalled();
    expect(harness.placeTabInGroup).not.toHaveBeenCalled();
  });

  it.each([
    ["inaccessible opener", { openerAccessible: false }],
    ["denied destination", { classifyNavigation: vi.fn(async () => "denied" as const) }],
  ])("fails closed for an %s candidate", async (_label, options) => {
    const harness = createHarness(options);

    harness.containment.onCreated(harness.tabs.get(8)!);
    await vi.waitFor(() => expect(harness.policy.endRevocation).toHaveBeenCalledOnce());

    expect(harness.placeTabInGroup).not.toHaveBeenCalled();
    expect(harness.scheduleTabsSync).not.toHaveBeenCalled();
  });

  it("removes a denied child that Chrome created inside the opener group", async () => {
    const child = {
      id: 8,
      openerTabId: 7,
      groupId: 23,
      url: "https://child.example",
      windowId: 1,
    };
    const harness = createHarness({
      child,
      classifyNavigation: vi.fn(async () => "denied" as const),
    });

    harness.containment.onCreated(child);
    await vi.waitFor(() => expect(harness.removeTabFromGroup).toHaveBeenCalledWith(8));

    expect(harness.policy.endRevocation).toHaveBeenCalledOnce();
    expect(harness.placeTabInGroup).not.toHaveBeenCalled();
    expect(harness.scheduleTabsSync).not.toHaveBeenCalled();
  });

  it("abandons inheritance when opener authority changes during the decision", async () => {
    const decision = deferred<"allowed">();
    const harness = createHarness({
      classifyNavigation: vi.fn(async () => await decision.promise),
    });

    harness.containment.onCreated(harness.tabs.get(8)!);
    await vi.waitFor(() => expect(harness.classifyNavigation).toHaveBeenCalledOnce());
    harness.invalidateOpener();
    decision.resolve("allowed");
    await vi.waitFor(() => expect(harness.policy.endRevocation).toHaveBeenCalledOnce());

    expect(harness.placeTabInGroup).not.toHaveBeenCalled();
  });

  it("removes a child when opener authority changes after Chrome grouped it", async () => {
    const harness = createHarness();
    harness.placeTabInGroup.mockImplementationOnce(async (tabId, groupId) => {
      const current = harness.tabs.get(tabId)!;
      harness.tabs.set(tabId, { ...current, groupId });
      harness.invalidateOpener();
    });

    harness.containment.onCreated(harness.tabs.get(8)!);
    await vi.waitFor(() => expect(harness.removeTabFromGroup).toHaveBeenCalledWith(8));

    expect(harness.policy.endRevocation).toHaveBeenCalledOnce();
    expect(harness.scheduleTabsSync).not.toHaveBeenCalled();
  });

  it("keeps the child barrier closed when Chrome cannot roll back exact placement", async () => {
    const harness = createHarness();
    harness.placeTabInGroup.mockImplementationOnce(async (tabId, groupId) => {
      const current = harness.tabs.get(tabId)!;
      harness.tabs.set(tabId, { ...current, groupId });
      harness.invalidateOpener();
    });
    harness.removeTabFromGroup.mockImplementationOnce(async () => undefined);

    harness.containment.onCreated(harness.tabs.get(8)!);
    await vi.waitFor(() => expect(harness.removeTabFromGroup).toHaveBeenCalledWith(8));

    expect(harness.policy.endRevocation).not.toHaveBeenCalled();
    harness.containment.onRemoved(8);
    expect(harness.policy.endRevocation).toHaveBeenCalledOnce();
  });

  it("clears pending authority on close and timeout", async () => {
    vi.useFakeTimers();
    const classifyNavigation = vi.fn(async () => "pending" as const);
    const closed = createHarness({ classifyNavigation });
    closed.containment.onCreated(closed.tabs.get(8)!);
    await vi.waitFor(() => expect(classifyNavigation).toHaveBeenCalledOnce());
    closed.containment.onRemoved(8);
    expect(closed.policy.endRevocation).toHaveBeenCalledOnce();

    const timedOut = createHarness({ classifyNavigation });
    timedOut.containment.onCreated(timedOut.tabs.get(8)!);
    await vi.waitFor(() => expect(classifyNavigation).toHaveBeenCalledTimes(2));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(timedOut.policy.endRevocation).toHaveBeenCalledOnce();
    expect(timedOut.placeTabInGroup).not.toHaveBeenCalled();
  });

  it("does not re-inherit a child after the user manually ungroups it", async () => {
    const harness = createHarness();
    harness.containment.onCreated(harness.tabs.get(8)!);
    await vi.waitFor(() => expect(harness.placeTabInGroup).toHaveBeenCalledOnce());
    harness.tabs.set(8, { ...harness.tabs.get(8)!, groupId: -1 });

    harness.containment.onUpdated(8, { groupId: -1 });
    await Promise.resolve();

    expect(harness.placeTabInGroup).toHaveBeenCalledOnce();
  });
});
