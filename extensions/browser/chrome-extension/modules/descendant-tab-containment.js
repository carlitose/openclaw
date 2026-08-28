import { effectiveTabUrl } from "./tab-eligibility.js";

const DEFAULT_PENDING_TIMEOUT_MS = 10_000;

function isValidTabId(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

/** Empty and about:blank children may bootstrap, but never become accessible. */
function classifyDescendantNavigation(tab) {
  const rawUrl = effectiveTabUrl(tab);
  if (typeof rawUrl !== "string" || rawUrl.length === 0) {
    return "pending";
  }
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return "denied";
  }
  if (url.protocol === "about:" && url.pathname === "blank") {
    return "pending";
  }
  return (url.protocol === "http:" || url.protocol === "https:") && !url.username && !url.password
    ? "allowed"
    : "denied";
}

/** Owns creation-only inheritance while a descendant has no relay authority. */
export function createDescendantTabContainment({
  chromeApi = chrome,
  accessReady,
  policy,
  isTabInOpenClawGroup,
  classifyNavigation = classifyDescendantNavigation,
  placeTabInGroup,
  removeTabFromGroup,
  scheduleTabsSync,
  runAccessMutation,
  pendingTimeoutMs = DEFAULT_PENDING_TIMEOUT_MS,
}) {
  const pending = new Map();

  const currentEntry = (entry) => pending.get(entry.childId) === entry;

  const release = (entry) => {
    if (!currentEntry(entry)) {
      return false;
    }
    pending.delete(entry.childId);
    clearTimeout(entry.timeout);
    policy.endRevocation(entry.revocation);
    return true;
  };

  const openerStillOwnsGroup = async (entry) => {
    if (!currentEntry(entry) || !policy.epochIsCurrent(entry.openerId, entry.openerEpoch)) {
      return false;
    }
    const state = await policy.inspectTab(entry.openerId, entry.openerEpoch).catch(() => null);
    let groupIsCurrent = false;
    if (state?.tab) {
      try {
        groupIsCurrent = (await isTabInOpenClawGroup(state.tab)) === true;
      } catch {
        groupIsCurrent = false;
      }
    }
    return (
      currentEntry(entry) &&
      policy.epochIsCurrent(entry.openerId, entry.openerEpoch) &&
      state?.accessible === true &&
      groupIsCurrent &&
      state.tab?.groupId === entry.groupId
    );
  };

  const rollbackExactPlacement = async (entry) => {
    if (entry.groupId === null) {
      return true;
    }
    const child = await chromeApi.tabs.get(entry.childId).catch(() => null);
    if (!child || child.groupId !== entry.groupId) {
      return true;
    }
    try {
      await Promise.resolve(removeTabFromGroup(entry.childId));
    } catch {
      // Verify the resulting Chrome state below; callbacks may be synchronous.
    }
    const remaining = await chromeApi.tabs.get(entry.childId).catch(() => null);
    return !remaining || remaining.groupId !== entry.groupId;
  };

  const reject = async (entry) => {
    if (currentEntry(entry) && (await rollbackExactPlacement(entry))) {
      release(entry);
    }
  };

  const evaluate = async (entry) => {
    if (!currentEntry(entry) || entry.groupId === null) {
      return;
    }
    const child = await chromeApi.tabs.get(entry.childId).catch(() => null);
    if (!child || !currentEntry(entry)) {
      release(entry);
      return;
    }
    let decision;
    try {
      decision = await Promise.resolve(classifyNavigation(child));
    } catch {
      decision = "denied";
    }
    if (!currentEntry(entry)) {
      return;
    }
    if (decision === "pending") {
      return;
    }
    if (decision !== "allowed" || !(await openerStillOwnsGroup(entry))) {
      await reject(entry);
      return;
    }
    try {
      await placeTabInGroup(entry.childId, entry.groupId);
      const [openerIsCurrent, groupedChild] = await Promise.all([
        openerStillOwnsGroup(entry),
        chromeApi.tabs.get(entry.childId).catch(() => null),
      ]);
      if (!openerIsCurrent || groupedChild?.groupId !== entry.groupId) {
        await reject(entry);
        return;
      }
      if (release(entry)) {
        scheduleTabsSync();
      }
    } catch {
      await reject(entry);
    }
  };

  const enqueue = (entry, task) => {
    void runAccessMutation(task).catch(() => reject(entry));
  };

  const onCreated = (tab) => {
    const childId = tab?.id;
    const openerId = tab?.openerTabId;
    if (
      !isValidTabId(childId) ||
      !isValidTabId(openerId) ||
      childId === openerId ||
      pending.has(childId)
    ) {
      return;
    }

    // Start both the child barrier and opener lookup in the creation turn.
    // Chrome may clear openerTabId after moving a popup between windows.
    const revocation = policy.beginRevocation(childId);
    const openerEpoch = policy.capture(openerId);
    const openerLookup = chromeApi.tabs.get(openerId).catch(() => null);
    const entry = {
      childId,
      openerId,
      openerEpoch,
      groupId: isValidTabId(tab.groupId) ? tab.groupId : null,
      revocation,
      timeout: null,
    };
    entry.timeout = setTimeout(
      () => enqueue(entry, async () => await reject(entry)),
      pendingTimeoutMs,
    );
    pending.set(childId, entry);

    enqueue(entry, async () => {
      await accessReady;
      if (!currentEntry(entry)) {
        release(entry);
        return;
      }
      const opener = await openerLookup;
      if (!isValidTabId(opener?.groupId)) {
        await reject(entry);
        return;
      }
      entry.groupId = opener.groupId;
      if (!(await openerStillOwnsGroup(entry))) {
        await reject(entry);
        return;
      }
      await evaluate(entry);
    });
  };

  const onUpdated = (tabId, changeInfo) => {
    const entry = pending.get(tabId);
    if (
      !entry ||
      (typeof changeInfo?.url !== "string" && typeof changeInfo?.groupId !== "number")
    ) {
      return;
    }
    enqueue(entry, async () => {
      if (!(await openerStillOwnsGroup(entry))) {
        await reject(entry);
        return;
      }
      await evaluate(entry);
    });
  };

  const onRemoved = (tabId) => {
    const entry = pending.get(tabId);
    if (entry) {
      release(entry);
    }
    for (const candidate of pending.values()) {
      if (candidate.openerId === tabId) {
        enqueue(candidate, async () => await reject(candidate));
      }
    }
  };

  const reconcile = () => {
    for (const entry of pending.values()) {
      enqueue(entry, async () => {
        if (!(await openerStillOwnsGroup(entry))) {
          await reject(entry);
        }
      });
    }
  };

  return { onCreated, onUpdated, onRemoved, reconcile };
}
