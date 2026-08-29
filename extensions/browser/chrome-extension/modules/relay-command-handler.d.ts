import type { TabAccessEpoch } from "./tab-access.js";
import type { AccessibleBrowserTabSnapshot, BrowserTabSnapshot } from "./tab-eligibility.js";
import type { TaskTabLifecycle } from "./task-tab-lifecycle.js";

export function createRelayCommandHandler(params: {
  send: (message: Record<string, unknown>) => void;
  attachDebugger: (tabId: number) => Promise<unknown>;
  detachDebugger: (tabId: number) => Promise<void>;
  addTabToOpenClawGroup: (tabId: number) => Promise<void>;
  focusWindowForTab: (tab: BrowserTabSnapshot) => Promise<void>;
  scheduleTabsSync: () => void;
  captureAccess: (tabId: number) => TabAccessEpoch;
  requireAccessibleTab: (
    tabId: number,
    epoch: TabAccessEpoch,
  ) => Promise<AccessibleBrowserTabSnapshot>;
  rememberUtilityWorld: (tabId: number, worldName: string) => void;
  attachCreatedDebugger: (tabId: number, taskGeneration: string) => Promise<{ targetId: string }>;
  taskTabs: TaskTabLifecycle;
}): (message: Record<string, unknown>) => Promise<void>;
