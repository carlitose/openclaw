import type { TabAccessEpoch } from "./tab-access.js";
import type { BrowserTabSnapshot } from "./tab-eligibility.js";

type DescendantNavigationDecision = "pending" | "allowed" | "denied";

type DescendantTabContainmentPolicy = {
  beginRevocation(tabId: number): symbol;
  endRevocation(token: symbol): void;
  capture(tabId: number): TabAccessEpoch;
  epochIsCurrent(tabId: number, epoch: TabAccessEpoch): boolean;
  inspectTab(
    tabId: number,
    epoch: TabAccessEpoch,
  ): Promise<{ accessible: boolean; tab: BrowserTabSnapshot | null }>;
};

type DescendantTabContainment = {
  onCreated(tab: BrowserTabSnapshot & { openerTabId?: number }): void;
  onUpdated(tabId: number, changeInfo: { groupId?: number; url?: string }): void;
  onRemoved(tabId: number): void;
  reconcile(): void;
};

export function createDescendantTabContainment(options: {
  chromeApi?: {
    tabs: {
      get(tabId: number): Promise<BrowserTabSnapshot>;
    };
  };
  accessReady: Promise<unknown>;
  policy: DescendantTabContainmentPolicy;
  isTabInOpenClawGroup(tab: BrowserTabSnapshot): boolean | Promise<boolean>;
  classifyNavigation?(
    tab: BrowserTabSnapshot,
  ): DescendantNavigationDecision | Promise<DescendantNavigationDecision>;
  placeTabInGroup(tabId: number, groupId: number): Promise<void>;
  removeTabFromGroup(tabId: number): Promise<void>;
  scheduleTabsSync(): void;
  runAccessMutation(task: () => void | Promise<void>): Promise<void>;
  pendingTimeoutMs?: number;
}): DescendantTabContainment;
