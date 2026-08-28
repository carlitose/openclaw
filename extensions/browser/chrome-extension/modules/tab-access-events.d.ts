import type { TabAccessEpoch, TabAccessMode, TabAccessState } from "./tab-access.js";
import type { TaskTabLifecycle } from "./task-tab-lifecycle.js";

type ChromeEvent<Listener> = {
  addListener(listener: Listener): void;
};

export type TabAccessEventsChromeApi = {
  debugger: {
    sendCommand(
      target: { tabId: number },
      method: string,
      params?: Record<string, unknown>,
    ): Promise<Record<string, unknown> | undefined>;
    onEvent: ChromeEvent<
      (source: { tabId?: number; sessionId?: string }, method: string, params: unknown) => void
    >;
    onDetach: ChromeEvent<(source: { tabId?: number }, reason: string) => void>;
  };
  tabs: {
    get(tabId: number): Promise<import("./tab-eligibility.js").BrowserTabSnapshot>;
    onCreated: ChromeEvent<
      (tab: import("./tab-eligibility.js").BrowserTabSnapshot & { openerTabId?: number }) => void
    >;
    onRemoved: ChromeEvent<(tabId: number) => void>;
    onReplaced: ChromeEvent<(addedTabId: number, removedTabId: number) => void>;
    onUpdated: ChromeEvent<(tabId: number, changeInfo: { groupId?: number; url?: string }) => void>;
  };
  tabGroups: {
    onUpdated: ChromeEvent<() => void>;
    onRemoved: ChromeEvent<() => void>;
  };
};

export type TabAccessEventPolicy = {
  readonly mode: TabAccessMode;
  beginRevocation(tabId: number): symbol;
  endRevocation(token: symbol): void;
  capture(tabId: number): TabAccessEpoch;
  epochIsCurrent(tabId: number, epoch: TabAccessEpoch): boolean;
  invalidateTab(tabId: number): void;
  invalidateAll(): void;
  inspectTab(tabId: number, epoch: TabAccessEpoch): Promise<TabAccessState>;
  listAccessibleTabs(): Promise<Array<{ id: number }>>;
  forgetTab(tabId: number): Promise<void>;
  replaceTab(addedTabId: number, removedTabId: number): Promise<boolean>;
};

export function registerTabAccessEvents(options: {
  chromeApi?: TabAccessEventsChromeApi;
  accessReady: Promise<unknown>;
  policy: TabAccessEventPolicy;
  isTabInOpenClawGroup(
    tab: import("./tab-eligibility.js").BrowserTabSnapshot,
  ): boolean | Promise<boolean>;
  attachedTabs: Set<number>;
  attachedAccessEpochs: Map<number, TabAccessEpoch>;
  attachmentTokens: Map<number, symbol>;
  attachingTabs: Map<number, Promise<unknown>>;
  send(message: Record<string, unknown>): void;
  scheduleTabsSync(): void;
  detachDebugger(tabId: number): Promise<void>;
  pauseTab(tabId: number): void | Promise<void>;
  removeTabFromOpenClawGroup(tabId: number): void | Promise<void>;
  placeTabInGroup(tabId: number, groupId: number): Promise<void>;
  runAccessMutation(task: () => void | Promise<void>): Promise<void>;
  taskTabs?: Pick<
    TaskTabLifecycle,
    "registerDescendant" | "generationFor" | "forget" | "replace" | "revoke"
  >;
  getUtilityWorldName(tabId: number): string | undefined;
  forgetUtilityWorld(tabId: number): void;
}): void;
