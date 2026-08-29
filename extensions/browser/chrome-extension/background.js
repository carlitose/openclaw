import { classifyDescendantNavigation as classifyLocalDescendantNavigation } from "./modules/descendant-tab-containment.js";
import {
  createNativeBootstrapController,
  discardRetiredCopilotState,
  prepareRetiredCopilotState,
} from "./modules/native-bootstrap.js";
import { createNavigationPolicyController } from "./modules/navigation-policy-controller.js";
import { createPopupMessageHandler } from "./modules/popup-background.js";
import { createRelayCommandHandler } from "./modules/relay-command-handler.js";
import { openAuthenticatedRelaySocket } from "./modules/relay-connection.js";
// OpenClaw extension service worker.
//
// Thin transport between the OpenClaw extension relay (loopback WebSocket) and
// chrome.debugger. All CDP target synthesis lives server-side in the relay
// bridge; this worker owns tab eligibility/access and forwards allowed frames.
// The OpenClaw tab group is the ACL in selected mode and an ownership marker
// in all-tabs mode.
import {
  ACCESS_MODE_SELECTED,
  OPENCLAW_TAB_GROUP_TITLE,
  createPairingConfigStore,
  reconnectDelayMs,
  toRelayTabInfo,
} from "./modules/relay-core.js";
import { findOpenClawGroups, isTabSelected } from "./modules/relay-tab-groups.js";
import { registerTabAccessEvents } from "./modules/tab-access-events.js";
import { createTabAccessPolicy } from "./modules/tab-access.js";
import { createTaskTabLifecycle } from "./modules/task-tab-lifecycle.js";

const BADGE = {
  off: { text: "", color: "#000000" },
  connecting: { text: "…", color: "#F59E0B" },
  on: { text: "ON", color: "#0F9D58" },
  error: { text: "!", color: "#B91C1C" },
};
const RELAY_WATCHDOG_ALARM = "openclaw-relay-watchdog";
const RELAY_OPENING_DEADLINE_ALARM = "openclaw-relay-opening-deadline";
const RELAY_AUTH_TIMEOUT_MS = 10_000;
const EXTENSION_INSTANCE_ID = crypto.randomUUID();

/** @type {WebSocket|null} */
let relayWs = null;
let relayState = "off"; // off | connecting | on | error
let reconnectAttempt = 0;
let reconnectTimer = null;
let relayOpeningDeadlineAt = 0;
let relayOpeningDeadlineTimer = null;
let relayAuthenticatedSocket = null;
let relayStatusHint = "";
let reconciledPairingInvalidationRevision = 0;
let relayConnectionGeneration = 0;
let relayConnectionsSuspended = false;
let legacyHelloTimer = null;
const taskTabs = createTaskTabLifecycle();
let nativeBootstrap = null;
// Start blocked: no runtime path may outrun the retired-state storage read.
let retiredCopilotCustodyBlocked = true;
/** Tab ids with an active chrome.debugger attachment. */
const attachedTabs = new Set();
/** Access epoch proven for each attachment; debugger events use this synchronously. */
const attachedAccessEpochs = new Map();
/** Opaque generation for each live chrome.debugger attachment. */
const attachmentTokens = new Map();
/** In-flight attach promises per tab id (coalesces concurrent attaches). */
const attachingTabs = new Map();
/** Root automation world learned from the active debugger client's setup. */
const utilityWorldNames = new Map();
/** Debounce handle for tab-list refreshes. */
let tabsSyncTimer = null;
let accessMutationChain = Promise.resolve();
const pairingConfigStore = createPairingConfigStore(chrome.storage.local);
const navigationPolicyController = createNavigationPolicyController({
  timeoutMs: RELAY_AUTH_TIMEOUT_MS,
  isRelayAuthenticated: () =>
    relayAuthenticatedSocket === relayWs && relayWs?.readyState === WebSocket.OPEN,
  send,
  taskTabs,
  invalidateAccess: () => tabAccessPolicy.invalidateAll(),
  onPolicyInstalled: async (nonce) => {
    await detachAllDebuggerSessions();
    await sendHello({ nonce, withInventory: false });
    await syncTabsToRelay();
  },
});
const tabAccessPolicy = createTabAccessPolicy({
  isSelectedTab: isTabSelected,
  classifyNavigation: navigationPolicyController.classifyTab,
});
const tabAccessReady = (async () => {
  const retiredState = await prepareRetiredCopilotState();
  retiredCopilotCustodyBlocked = retiredState.blocked;
  const config = await pairingConfigStore.read();
  await tabAccessPolicy.initialize(
    config.accessMode,
    Boolean(config.relayUrl) && !retiredCopilotCustodyBlocked,
  );
  if (retiredCopilotCustodyBlocked) {
    tabAccessPolicy.setEnabled(false);
    await detachAllDebuggerSessions();
  }
})();

const custodyError = () =>
  new Error(
    "Automation is paused to protect a pre-upgrade copilot session. Open Settings to disconnect before reconnecting.",
  );

async function requireAutomationAllowed() {
  await tabAccessReady;
  if (retiredCopilotCustodyBlocked) {
    throw custodyError();
  }
}

function closeRelaySocket() {
  clearRelayOpeningDeadline();
  const socket = relayWs;
  if (!socket) {
    return;
  }
  relayWs = null;
  if (relayAuthenticatedSocket === socket) {
    relayAuthenticatedSocket = null;
  }
  socket.close();
}

function clearNavigationPolicy() {
  navigationPolicyController.clear();
  if (legacyHelloTimer) {
    clearTimeout(legacyHelloTimer);
    legacyHelloTimer = null;
  }
}

async function classifyContainedDescendantNavigation(tab) {
  if (!navigationPolicyController.hasInstalledPolicy()) {
    return classifyLocalDescendantNavigation(tab);
  }
  return (await navigationPolicyController.classifyTab(tab)).status;
}

function suspendRelayConnections() {
  relayConnectionsSuspended = true;
  relayConnectionGeneration += 1;
}

function resumeRelayConnections() {
  relayConnectionsSuspended = false;
  relayConnectionGeneration += 1;
}

async function reconcilePairingInvalidation() {
  if (reconciledPairingInvalidationRevision === pairingConfigStore.invalidationRevision) {
    return;
  }
  reconciledPairingInvalidationRevision = pairingConfigStore.invalidationRevision;
  taskTabs.revokeAll();
  await syncTabsToRelay();
  closeRelaySocket();
  setBadge("off");
  await detachAllDebuggerSessions();
}

function setBadge(kind) {
  relayState = kind;
  const cfg = BADGE[kind] ?? BADGE.off;
  void chrome.action.setBadgeText({ text: cfg.text });
  void chrome.action.setBadgeBackgroundColor({ color: cfg.color });
}

async function getConfig() {
  await tabAccessReady;
  const config = await pairingConfigStore.read();
  if (retiredCopilotCustodyBlocked || !config.relayUrl) {
    tabAccessPolicy.setEnabled(false);
  }
  if (config.pairingStatusHint) {
    relayStatusHint = config.pairingStatusHint;
  }
  return config;
}

function runAccessMutation(task) {
  const pending = accessMutationChain.then(task, task);
  accessMutationChain = pending.catch(() => undefined);
  return pending;
}

// ---------------------------------------------------------------------------
// Tab group management (selected-mode ACL; all-mode ownership marker)
// ---------------------------------------------------------------------------

async function addTabToOpenClawGroup(tabId, exactGroupId) {
  if (Number.isSafeInteger(exactGroupId) && exactGroupId >= 0) {
    await chrome.tabs.group({ tabIds: [tabId], groupId: exactGroupId });
    return;
  }
  const tab = await chrome.tabs.get(tabId);
  const groups = await findOpenClawGroups();
  const sameWindowGroup = groups.find((group) => group.windowId === tab.windowId);
  if (sameWindowGroup) {
    await chrome.tabs.group({ tabIds: [tabId], groupId: sameWindowGroup.id });
    return;
  }
  const { groupColor } = await getConfig();
  const groupId = await chrome.tabs.group({ tabIds: [tabId] });
  await chrome.tabGroups.update(groupId, {
    title: OPENCLAW_TAB_GROUP_TITLE,
    color: groupColor,
  });
}

async function focusWindowForTab(tab) {
  if (typeof tab.windowId === "number") {
    await chrome.windows.update(tab.windowId, { focused: true });
  }
}

async function removeTabFromOpenClawGroup(tabId) {
  try {
    await chrome.tabs.ungroup([tabId]);
  } catch {
    // tab may already be gone
  }
}

function scheduleTabsSync() {
  if (tabsSyncTimer) {
    return;
  }
  tabsSyncTimer = setTimeout(() => {
    tabsSyncTimer = null;
    void syncTabsToRelay();
  }, 150);
}

async function syncTabsToRelay() {
  if (retiredCopilotCustodyBlocked) {
    return;
  }
  if (!relayWs || relayWs.readyState !== WebSocket.OPEN || relayAuthenticatedSocket !== relayWs) {
    return;
  }
  const accessible = await tabAccessPolicy.listAccessibleTabs();
  const accessibleIds = new Set(accessible.map((tab) => tab.id));
  for (const tabId of attachedTabs) {
    // Task-owned attachments can be intentionally unpublished while about:blank
    // navigates. Their exact lifecycle owner revokes them on denial or cleanup.
    if (!accessibleIds.has(tabId) && !taskTabs.isInitializing(tabId)) {
      void detachDebugger(tabId);
    }
  }
  send({
    type: "tabs",
    tabs: accessible.map((tab) => toRelayTabInfo(tab, taskTabs.generationFor(tab.id))),
  });
}

// ---------------------------------------------------------------------------
// chrome.debugger transport
// ---------------------------------------------------------------------------

async function attachDebugger(tabId) {
  await requireAutomationAllowed();
  const accessEpoch = tabAccessPolicy.capture(tabId);
  const assertAccess = async () => {
    await tabAccessPolicy.requireTab(tabId, accessEpoch);
  };
  await assertAccess();
  // Coalesce concurrent attaches for one tab. Two relay attach commands (or an
  // auto-attach racing an explicit share) would otherwise both call
  // chrome.debugger.attach and the second throws "Another debugger is already
  // attached". The bridge and this worker can also disagree after an MV3 restart.
  const inFlight = attachingTabs.get(tabId);
  if (inFlight) {
    const result = await inFlight;
    try {
      await assertAccess();
    } catch (error) {
      await detachDebugger(tabId);
      throw error;
    }
    return result;
  }
  const attach = (async () => {
    await assertAccess();
    if (!attachedTabs.has(tabId)) {
      try {
        await chrome.debugger.attach({ tabId }, "1.3");
      } catch (err) {
        // Treat an existing attachment as success; our own debugger is already on.
        if (!String(err?.message ?? err).includes("Another debugger is already attached")) {
          throw err;
        }
      }
      try {
        await assertAccess();
      } catch (error) {
        await detachDebugger(tabId);
        throw error;
      }
      attachedTabs.add(tabId);
    }
    const targets = await chrome.debugger.getTargets();
    try {
      await assertAccess();
    } catch (error) {
      await detachDebugger(tabId);
      throw error;
    }
    const target = targets.find((candidate) => candidate.tabId === tabId && candidate.attached);
    // The attachment is authorized only by the epoch proven across the whole
    // attach. Never replace it with a fresh post-await capture: that would let
    // a revocation during async unwind authorize later debugger events.
    if (!tabAccessPolicy.epochIsCurrent(tabId, accessEpoch)) {
      await detachDebugger(tabId);
      throw new Error(`tab ${tabId} access was revoked`);
    }
    if (!attachmentTokens.has(tabId)) {
      attachmentTokens.set(tabId, Symbol("debugger attachment"));
    }
    attachedAccessEpochs.set(tabId, accessEpoch);
    return { targetId: target?.id ?? `tab-${tabId}` };
  })();
  attachingTabs.set(tabId, attach);
  try {
    return await attach;
  } finally {
    attachingTabs.delete(tabId);
  }
}

async function attachCreatedDebugger(tabId, taskGeneration) {
  if (!taskTabs.owns(tabId, taskGeneration)) {
    throw new Error(`task ownership for tab ${tabId} is no longer current`);
  }
  try {
    await chrome.debugger.attach({ tabId }, "1.3");
  } catch (error) {
    if (!String(error?.message ?? error).includes("Another debugger is already attached")) {
      throw error;
    }
  }
  if (!taskTabs.owns(tabId, taskGeneration)) {
    await chrome.debugger.detach({ tabId }).catch(() => undefined);
    throw new Error(`task ownership for tab ${tabId} was revoked during attach`);
  }
  const targets = await chrome.debugger.getTargets();
  if (!taskTabs.owns(tabId, taskGeneration)) {
    await chrome.debugger.detach({ tabId }).catch(() => undefined);
    throw new Error(`task ownership for tab ${tabId} was revoked during target discovery`);
  }
  attachedTabs.add(tabId);
  attachmentTokens.set(tabId, Symbol("task debugger attachment"));
  const target = targets.find((candidate) => candidate.tabId === tabId && candidate.attached);
  return { targetId: target?.id ?? `tab-${tabId}` };
}

async function detachDebugger(tabId) {
  // Always call Chrome: an attach can complete before attachedTabs records it.
  // The unconditional detach closes that revocation race.
  attachedTabs.delete(tabId);
  attachedAccessEpochs.delete(tabId);
  attachmentTokens.delete(tabId);
  utilityWorldNames.delete(tabId);
  try {
    await chrome.debugger.detach({ tabId });
  } catch {
    // already detached or tab gone
  }
}

async function detachAllDebuggerSessions() {
  const targets = await chrome.debugger.getTargets().catch(() => []);
  const tabIds = new Set(attachedTabs);
  for (const target of targets) {
    if (target.attached && typeof target.tabId === "number") {
      tabIds.add(target.tabId);
    }
  }
  await Promise.allSettled(attachingTabs.values());
  for (const tabId of attachedTabs) {
    tabIds.add(tabId);
  }
  await Promise.allSettled([...tabIds].map((tabId) => detachDebugger(tabId)));
}

async function reconcileAccessMode(nextMode, { transitioning = false } = {}) {
  await tabAccessReady;
  const previousMode = tabAccessPolicy.mode;
  const mode = tabAccessPolicy.setMode(nextMode);
  if (mode === previousMode) {
    if (transitioning) {
      tabAccessPolicy.endTransition();
    }
    return mode;
  }
  await Promise.allSettled(attachingTabs.values());
  if (mode === ACCESS_MODE_SELECTED) {
    const selectedIds = new Set(
      (
        await tabAccessPolicy.listAccessibleTabs({
          allowDuringTransition: transitioning,
        })
      ).map((tab) => tab.id),
    );
    await Promise.allSettled(
      [...attachedTabs]
        .filter((tabId) => !selectedIds.has(tabId))
        .map((tabId) => detachDebugger(tabId)),
    );
  }
  if (transitioning) {
    tabAccessPolicy.endTransition();
  }
  for (const tabId of attachedTabs) {
    const epoch = tabAccessPolicy.capture(tabId);
    const state = await tabAccessPolicy.inspectTab(tabId, epoch);
    if (!tabAccessPolicy.epochIsCurrent(tabId, epoch)) {
      // A post-transition tab event owns the newer revision. Keep this
      // attachment fail-closed until that handler reconciles it.
      continue;
    }
    if (!state.accessible) {
      await detachDebugger(tabId);
    } else if (attachedTabs.has(tabId)) {
      attachedAccessEpochs.set(tabId, epoch);
    }
  }
  await syncTabsToRelay();
  return mode;
}

async function pauseTab(tabId) {
  let storageError = null;
  try {
    await tabAccessPolicy.pause(tabId);
  } catch (error) {
    storageError = error;
  }
  await Promise.allSettled([attachingTabs.get(tabId)]);
  await detachDebugger(tabId);
  taskTabs.revoke(tabId);
  await syncTabsToRelay();
  if (storageError) {
    throw storageError instanceof Error
      ? storageError
      : new Error("Could not persist the tab pause.");
  }
}

// ---------------------------------------------------------------------------
// Relay connection
// ---------------------------------------------------------------------------

function send(message) {
  if (
    !retiredCopilotCustodyBlocked &&
    relayWs &&
    relayWs.readyState === WebSocket.OPEN &&
    relayAuthenticatedSocket === relayWs
  ) {
    relayWs.send(JSON.stringify(message));
  }
}

function clearRelayOpeningDeadline() {
  relayOpeningDeadlineAt = 0;
  if (relayOpeningDeadlineTimer) {
    clearTimeout(relayOpeningDeadlineTimer);
    relayOpeningDeadlineTimer = null;
  }
  void chrome.alarms.clear(RELAY_OPENING_DEADLINE_ALARM);
}

function armRelayOpeningDeadline() {
  clearRelayOpeningDeadline();
  relayOpeningDeadlineAt = Date.now() + RELAY_AUTH_TIMEOUT_MS;
  relayOpeningDeadlineTimer = setTimeout(handleRelayOpeningDeadline, RELAY_AUTH_TIMEOUT_MS);
  chrome.alarms.create(RELAY_OPENING_DEADLINE_ALARM, { when: relayOpeningDeadlineAt });
}

function failRelayAuthentication(ws, error) {
  if (relayWs !== ws) {
    return;
  }
  relayStatusHint =
    "Relay authentication v2 failed. Update OpenClaw, or re-pair after a relay key rotation.";
  try {
    ws.close(4001, error instanceof Error ? error.message.slice(0, 120) : "authentication failed");
  } catch {
    closeRelaySocket();
    setBadge("error");
    scheduleReconnect();
  }
}

const handleRelayCommand = createRelayCommandHandler({
  send,
  attachDebugger,
  detachDebugger,
  addTabToOpenClawGroup,
  focusWindowForTab,
  scheduleTabsSync,
  captureAccess: (tabId) => tabAccessPolicy.capture(tabId),
  requireAccessibleTab: (tabId, epoch) => tabAccessPolicy.requireTab(tabId, epoch),
  rememberUtilityWorld: (tabId, worldName) => {
    // A reconnected debugger client owns a new named utility world. The latest
    // proven root setup command is the session fact needed after navigation.
    utilityWorldNames.set(tabId, worldName);
  },
  attachCreatedDebugger,
  taskTabs,
});

async function sendHello({ nonce, withInventory = true } = {}) {
  const accessible = withInventory ? await tabAccessPolicy.listAccessibleTabs() : [];
  const uaMatch = /Chrom(?:e|ium)\/[\d.]+/.exec(navigator.userAgent);
  send({
    type: "hello",
    userAgent: navigator.userAgent,
    browserVersion: uaMatch ? uaMatch[0] : "Chrome/unknown",
    extensionVersion: chrome.runtime.getManifest().version,
    extensionInstanceId: EXTENSION_INSTANCE_ID,
    ...(nonce ? { navigationPolicyNonce: nonce } : {}),
    tabs: accessible.map((tab) => toRelayTabInfo(tab, taskTabs.generationFor(tab.id))),
  });
}

async function connectRelay(isConnectionAllowed = () => true) {
  await tabAccessReady;
  if (retiredCopilotCustodyBlocked) {
    tabAccessPolicy.setEnabled(false);
    closeRelaySocket();
    setBadge("off");
    return;
  }
  const connectionGeneration = relayConnectionGeneration;
  const connectionIsCurrent = () =>
    !relayConnectionsSuspended &&
    connectionGeneration === relayConnectionGeneration &&
    isConnectionAllowed();
  const { relayUrl, token } = await getConfig();
  if (!connectionIsCurrent()) {
    return;
  }
  await reconcilePairingInvalidation();
  if (!connectionIsCurrent()) {
    return;
  }
  if (!relayUrl || !token) {
    clearRelayOpeningDeadline();
    setBadge("off");
    return;
  }
  if (
    relayWs &&
    (relayWs.readyState === WebSocket.OPEN || relayWs.readyState === WebSocket.CONNECTING)
  ) {
    return;
  }
  // Pair revocation can race either awaited config step above. Keep the final
  // cancellation check adjacent to socket creation so a stale pair cannot reconnect.
  if (!connectionIsCurrent()) {
    return;
  }
  setBadge("connecting");
  let ws;
  try {
    ws = openAuthenticatedRelaySocket({
      relayUrl,
      token,
      isCurrent: (socket) => relayWs === socket,
      onAuthenticated: async (socket) => {
        relayAuthenticatedSocket = socket;
        relayStatusHint = "";
        clearRelayOpeningDeadline();
        reconnectAttempt = 0;
        setBadge("on");
        clearNavigationPolicy();
        await detachAllDebuggerSessions();
        // Compatibility with an older relay is intentionally empty-policy only.
        // A current relay installs its connection-bound policy before this fires.
        legacyHelloTimer = setTimeout(() => {
          legacyHelloTimer = null;
          if (relayWs !== socket || navigationPolicyController.hasInstalledPolicy()) {
            return;
          }
          navigationPolicyController.installLegacyEmptyPolicy();
          void sendHello();
        }, 250);
      },
      onApplicationMessage: (socket, msg) => {
        if (msg?.type === "navigationPolicy.v1") {
          if (legacyHelloTimer) {
            clearTimeout(legacyHelloTimer);
            legacyHelloTimer = null;
          }
          void navigationPolicyController
            .installFrame(msg)
            .catch(/** @param {unknown} error */ (error) => failRelayAuthentication(socket, error));
          return;
        }
        if (msg?.type === "navigationDecision") {
          navigationPolicyController.handleDecision(msg);
          return;
        }
        if (msg?.type === "revokeTasks") {
          void taskTabs.cleanupAll();
          return;
        }
        if (navigationPolicyController.hasInstalledPolicy()) {
          void handleRelayCommand(msg);
        }
      },
      onAuthenticationFailure: (socket, error) => failRelayAuthentication(socket, error),
      onClose: (socket, authenticated) => {
        if (relayWs !== socket) {
          return;
        }
        clearRelayOpeningDeadline();
        relayWs = null;
        if (authenticated) {
          relayAuthenticatedSocket = null;
        } else if (!relayStatusHint) {
          relayStatusHint =
            "Relay authentication v2 failed. Update OpenClaw, or re-pair after a relay key rotation.";
        }
        clearNavigationPolicy();
        void detachAllDebuggerSessions();
        setBadge("error");
        scheduleReconnect();
      },
    });
  } catch {
    setBadge("error");
    scheduleReconnect();
    return;
  }
  relayWs = ws;
  relayAuthenticatedSocket = null;
  armRelayOpeningDeadline();
  // onclose follows onerror and drives the reconnect, so no error handler needed.
}

function handleRelayOpeningDeadline() {
  const ws = relayWs;
  if (!ws) {
    clearRelayOpeningDeadline();
    return;
  }
  if (relayAuthenticatedSocket === ws) {
    clearRelayOpeningDeadline();
    return;
  }
  if (relayOpeningDeadlineAt === 0 || Date.now() < relayOpeningDeadlineAt) {
    return;
  }

  // Clear ownership before close so a delayed close/open event from this
  // socket cannot mutate the replacement connection's badge or deadline.
  relayWs = null;
  relayAuthenticatedSocket = null;
  clearRelayOpeningDeadline();
  try {
    ws.close(4001, "relay authentication timed out");
  } catch {
    // The socket may have changed state while the alarm event was queued.
  }
  setBadge("error");
  relayStatusHint = "Relay authentication v2 timed out. Make sure OpenClaw is up to date.";
  scheduleReconnect();
}

function scheduleReconnect() {
  if (reconnectTimer) {
    return;
  }
  const delay = reconnectDelayMs(reconnectAttempt);
  reconnectAttempt += 1;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void startAutomation();
  }, delay);
}

async function startAutomation() {
  await tabAccessReady;
  if (retiredCopilotCustodyBlocked) {
    return;
  }
  await nativeBootstrap.attempt();
  await connectRelay();
}

// ---------------------------------------------------------------------------
// Popup messaging + lifecycle
// ---------------------------------------------------------------------------

const handlePopupMessage = createPopupMessageHandler({
  pairingConfigStore,
  policy: tabAccessPolicy,
  accessReady: tabAccessReady,
  getConfig,
  getRelayState: () => relayState,
  getRelayStatusHint: () => relayStatusHint,
  getNativeBootstrapStatus: async () => {
    await tabAccessReady;
    if (!retiredCopilotCustodyBlocked) {
      await nativeBootstrap.attempt();
    }
    return await nativeBootstrap.status();
  },
  enableNativeBootstrap: async (enabled) => {
    await requireAutomationAllowed();
    return enabled ? await nativeBootstrap.enable() : await nativeBootstrap.disableSynchronously();
  },
  onManualPairing: () => nativeBootstrap.enable({ attemptNow: false }),
  onUnpairStart: () => nativeBootstrap.disableSynchronously(),
  isRetiredCopilotCustodyBlocked: () => retiredCopilotCustodyBlocked,
  requireAutomationAllowed,
  discardRetiredCopilotCustody: async () => {
    retiredCopilotCustodyBlocked = true;
    tabAccessPolicy.setEnabled(false);
    tabAccessPolicy.invalidateAll();
    await discardRetiredCopilotState();
    retiredCopilotCustodyBlocked = false;
  },
  resetRelayState: () => {
    relayStatusHint = "";
    reconnectAttempt = 0;
  },
  suspendRelayConnections,
  resumeRelayConnections,
  reconcilePairingInvalidation,
  reconcileAccessMode,
  runAccessMutation,
  detachAllDebuggerSessions,
  syncTabsToRelay,
  closeRelaySocket,
  connectRelay,
  setBadge,
  attachingTabs,
  detachDebugger,
  removeTabFromOpenClawGroup,
  addTabToOpenClawGroup,
  scheduleTabsSync,
  pauseTab,
});
nativeBootstrap = createNativeBootstrapController({
  getPairing: getConfig,
  applyPairing: async (request) => await handlePopupMessage.applyPairing(request),
});
chrome.runtime.onMessage.addListener((msg, _sender, reply) => handlePopupMessage(msg, reply));

registerTabAccessEvents({
  accessReady: tabAccessReady,
  policy: tabAccessPolicy,
  isTabInOpenClawGroup: isTabSelected,
  attachedTabs,
  attachedAccessEpochs,
  attachmentTokens,
  attachingTabs,
  send,
  scheduleTabsSync,
  detachDebugger,
  pauseTab,
  removeTabFromOpenClawGroup,
  placeTabInGroup: (tabId, groupId) => addTabToOpenClawGroup(tabId, groupId),
  runAccessMutation,
  classifyDescendantNavigation: classifyContainedDescendantNavigation,
  taskTabs,
  getUtilityWorldName: (tabId) => utilityWorldNames.get(tabId),
  forgetUtilityWorld: (tabId) => utilityWorldNames.delete(tabId),
});

// Watchdog: MV3 can stop this worker; the alarm revives it and re-connects.
chrome.alarms.create(RELAY_WATCHDOG_ALARM, { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === RELAY_WATCHDOG_ALARM) {
    void startAutomation();
  } else if (alarm.name === RELAY_OPENING_DEADLINE_ALARM) {
    handleRelayOpeningDeadline();
  }
});
chrome.runtime.onStartup.addListener(() => {
  void startAutomation();
});
chrome.runtime.onInstalled.addListener(() => {
  void startAutomation();
});
void startAutomation();
