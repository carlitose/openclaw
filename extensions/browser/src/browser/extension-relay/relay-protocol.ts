/**
 * Wire protocol between the extension relay server and the OpenClaw Chrome
 * extension. The extension owns tab eligibility/access, attaches chrome.debugger,
 * and forwards CDP traffic. All CDP target semantics (Target.* synthesis for
 * Playwright) live server-side in the bridge.
 */

/** Tab snapshot reported by the extension for tabs currently accessible to OpenClaw. */
export type RelayTabInfo = {
  tabId: number;
  url: string;
  title: string;
  active: boolean;
  /** Ephemeral task generation minted by the extension for relay-created tabs. */
  taskGeneration?: string;
};

/** First message the extension sends after the WebSocket opens. */
type ExtensionHelloMessage = {
  type: "hello";
  userAgent: string;
  /** Full browser product string, e.g. "Chrome/144.0.7204.49". */
  browserVersion: string;
  extensionVersion: string;
  /** Ephemeral extension-worker identity used to distinguish reconnect from replacement. */
  extensionInstanceId?: string;
  /** Exact nonce from this socket's navigation-policy installation frame. */
  navigationPolicyNonce?: string;
  tabs: RelayTabInfo[];
};

/** Ask the relay owner to apply hostname and SSRF policy to one live tab URL. */
type ExtensionNavigationCheckMessage = {
  type: "navigationCheck";
  seq: number;
  nonce: string;
  tabId: number;
  url: string;
};

/** Full refresh of accessible tabs; sent on any access-policy or tab change. */
type ExtensionTabsMessage = { type: "tabs"; tabs: RelayTabInfo[] };

/** CDP event emitted by an attached tab (child sessions carry sessionId). */
type ExtensionCdpEventMessage = {
  type: "cdpEvent";
  tabId: number;
  /** Exact unpublished task generation; omitted for ordinary accessible-tab events. */
  taskGeneration?: string;
  sessionId?: string;
  method: string;
  params?: unknown;
};

/** Successful response to a relay command (cdp/attach/createTab/...). */
type ExtensionResultMessage = { type: "result"; seq: number; result?: unknown };

/** Failed response to a relay command. */
type ExtensionErrorMessage = {
  type: "error";
  seq: number;
  message: string;
  details?: unknown;
};

/** chrome.debugger detached outside relay control (infobar cancel, tab gone). */
type ExtensionDetachedMessage = { type: "detached"; tabId: number; reason: string };

/** Exact task-owned physical tab removal observed by Chrome. */
type ExtensionTaskTabRemovedMessage = {
  type: "taskTabRemoved";
  tabId: number;
  taskGeneration: string;
};

/** Keepalive reply; message traffic keeps the MV3 service worker alive. */
type ExtensionPongMessage = { type: "pong" };

export type ExtensionToRelayMessage =
  | ExtensionHelloMessage
  | ExtensionTabsMessage
  | ExtensionCdpEventMessage
  | ExtensionResultMessage
  | ExtensionErrorMessage
  | ExtensionDetachedMessage
  | ExtensionTaskTabRemovedMessage
  | ExtensionNavigationCheckMessage
  | ExtensionPongMessage;

/**
 * Command bodies sent to the extension. The bridge assigns the `seq` used to
 * correlate the extension's result/error reply.
 */
export type RelayCommandBody =
  /** Forward a CDP command into an attached tab (or one of its child sessions). */
  | {
      type: "cdp";
      tabId: number;
      sessionId?: string;
      method: string;
      params?: unknown;
      taskGeneration?: string;
    }
  /** Attach chrome.debugger to an accessible tab. Result: { targetId: string }. */
  | { type: "attach"; tabId: number }
  /** Detach chrome.debugger from a tab (access revoked or client detached). */
  | { type: "detach"; tabId: number }
  /** Open a new tab inside the OpenClaw tab group. Result: { tabId: number }. */
  | { type: "createTab"; url: string; background?: boolean; focus?: boolean }
  /** Close an accessible tab. Result: {}. */
  | { type: "closeTab"; tabId: number }
  /** Close one exact task generation, descendants first. */
  | { type: "cleanupTask"; tabId: number; taskGeneration: string }
  /** End unpublished bootstrap authority after the relay adopts the exact task tab. */
  | { type: "publishTask"; tabId: number; taskGeneration: string }
  /** Focus an accessible tab (window + tab activation). Result: {}. */
  | { type: "activateTab"; tabId: number };

/** Keepalive probe; the extension answers with pong. */
type RelayPingMessage = {
  type: "ping";
};

type RelayNavigationPolicyMessage = {
  type: "navigationPolicy.v1";
  nonce: string;
  policy: import("../../../chrome-extension/modules/navigation-policy.js").CompiledNavigationPolicyV1;
};

type RelayNavigationDecisionMessage = {
  type: "navigationDecision";
  seq: number;
  nonce: string;
  allowed: boolean;
  message?: string;
};

type RelayRevokeTasksMessage = {
  type: "revokeTasks";
  reason: "extension-replaced" | "relay-stopped";
};

export type RelayToExtensionMessage =
  | (RelayCommandBody & { seq: number })
  | RelayPingMessage
  | RelayNavigationPolicyMessage
  | RelayNavigationDecisionMessage
  | RelayRevokeTasksMessage;

type RelayFrame = Record<string, unknown>;

function hasExactOwnKeys(value: object, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function isRelayTabInfo(value: unknown): value is RelayTabInfo {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const keys = Object.hasOwn(value, "taskGeneration")
    ? ["tabId", "url", "title", "active", "taskGeneration"]
    : ["tabId", "url", "title", "active"];
  if (!hasExactOwnKeys(value, keys)) {
    return false;
  }
  const tab = value as Record<string, unknown>;
  return (
    Number.isSafeInteger(tab.tabId) &&
    (tab.tabId as number) >= 0 &&
    typeof tab.url === "string" &&
    tab.url.length <= 16_384 &&
    typeof tab.title === "string" &&
    tab.title.length <= 4_096 &&
    typeof tab.active === "boolean" &&
    (tab.taskGeneration === undefined ||
      (typeof tab.taskGeneration === "string" && tab.taskGeneration.length <= 128))
  );
}

function isRelayTabInfoArray(value: unknown): value is RelayTabInfo[] {
  if (!Array.isArray(value) || value.length > 1_000 || !value.every(isRelayTabInfo)) {
    return false;
  }
  const tabIds = new Set(value.map((tab) => tab.tabId));
  return tabIds.size === value.length;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isExtensionHelloMessage(value: object): value is ExtensionHelloMessage {
  const keys = ["type", "userAgent", "browserVersion", "extensionVersion"];
  if (Object.hasOwn(value, "extensionInstanceId")) {
    keys.push("extensionInstanceId");
  }
  if (Object.hasOwn(value, "navigationPolicyNonce")) {
    keys.push("navigationPolicyNonce");
  }
  keys.push("tabs");
  if (!hasExactOwnKeys(value, keys)) {
    return false;
  }
  const hello = value as RelayFrame;
  if (
    hello.type !== "hello" ||
    typeof hello.userAgent !== "string" ||
    hello.userAgent.length === 0 ||
    hello.userAgent.length > 2_048 ||
    typeof hello.browserVersion !== "string" ||
    hello.browserVersion.length === 0 ||
    hello.browserVersion.length > 512 ||
    typeof hello.extensionVersion !== "string" ||
    hello.extensionVersion.length === 0 ||
    hello.extensionVersion.length > 128 ||
    (hello.extensionInstanceId !== undefined &&
      (typeof hello.extensionInstanceId !== "string" ||
        hello.extensionInstanceId.length < 16 ||
        hello.extensionInstanceId.length > 128)) ||
    (hello.navigationPolicyNonce !== undefined &&
      (typeof hello.navigationPolicyNonce !== "string" ||
        hello.navigationPolicyNonce.length < 16 ||
        hello.navigationPolicyNonce.length > 128)) ||
    !isRelayTabInfoArray(hello.tabs)
  ) {
    return false;
  }
  return true;
}

function isExtensionNavigationCheckMessage(
  msg: RelayFrame,
): msg is RelayFrame & ExtensionNavigationCheckMessage {
  return (
    hasExactOwnKeys(msg, ["type", "seq", "nonce", "tabId", "url"]) &&
    msg.type === "navigationCheck" &&
    isNonNegativeSafeInteger(msg.seq) &&
    typeof msg.nonce === "string" &&
    msg.nonce.length >= 16 &&
    msg.nonce.length <= 128 &&
    isNonNegativeSafeInteger(msg.tabId) &&
    typeof msg.url === "string" &&
    msg.url.length <= 16_384
  );
}

function isExtensionTabsMessage(msg: RelayFrame): msg is RelayFrame & ExtensionTabsMessage {
  return msg.type === "tabs" && isRelayTabInfoArray(msg.tabs);
}

function isExtensionCdpEventMessage(msg: RelayFrame): msg is RelayFrame & ExtensionCdpEventMessage {
  const keys = ["type", "tabId", "method"];
  if (Object.hasOwn(msg, "taskGeneration")) {
    keys.push("taskGeneration");
  }
  if (Object.hasOwn(msg, "sessionId")) {
    keys.push("sessionId");
  }
  if (Object.hasOwn(msg, "params")) {
    keys.push("params");
  }
  return (
    hasExactOwnKeys(msg, keys) &&
    msg.type === "cdpEvent" &&
    isNonNegativeSafeInteger(msg.tabId) &&
    (msg.taskGeneration === undefined ||
      (typeof msg.taskGeneration === "string" &&
        msg.taskGeneration.length >= 16 &&
        msg.taskGeneration.length <= 128)) &&
    (msg.sessionId === undefined || typeof msg.sessionId === "string") &&
    typeof msg.method === "string"
  );
}

function isExtensionResultMessage(msg: RelayFrame): msg is RelayFrame & ExtensionResultMessage {
  return msg.type === "result" && isNonNegativeSafeInteger(msg.seq);
}

function isExtensionErrorMessage(msg: RelayFrame): msg is RelayFrame & ExtensionErrorMessage {
  const keys = Object.hasOwn(msg, "details")
    ? ["type", "seq", "message", "details"]
    : ["type", "seq", "message"];
  const details = msg.details === undefined ? "" : JSON.stringify(msg.details);
  return (
    hasExactOwnKeys(msg, keys) &&
    msg.type === "error" &&
    isNonNegativeSafeInteger(msg.seq) &&
    typeof msg.message === "string" &&
    new TextEncoder().encode(msg.message).byteLength <= 4_096 &&
    details !== undefined &&
    new TextEncoder().encode(details).byteLength <= 16_384
  );
}

function isExtensionDetachedMessage(msg: RelayFrame): msg is RelayFrame & ExtensionDetachedMessage {
  return (
    msg.type === "detached" && isNonNegativeSafeInteger(msg.tabId) && typeof msg.reason === "string"
  );
}

function isExtensionTaskTabRemovedMessage(
  msg: RelayFrame,
): msg is RelayFrame & ExtensionTaskTabRemovedMessage {
  return (
    hasExactOwnKeys(msg, ["type", "tabId", "taskGeneration"]) &&
    msg.type === "taskTabRemoved" &&
    isNonNegativeSafeInteger(msg.tabId) &&
    typeof msg.taskGeneration === "string" &&
    msg.taskGeneration.length >= 16 &&
    msg.taskGeneration.length <= 128
  );
}

function isExtensionPongMessage(msg: RelayFrame): msg is RelayFrame & ExtensionPongMessage {
  return msg.type === "pong";
}

/** Parse one extension frame; returns null for malformed input. */
export function parseExtensionMessage(raw: string): ExtensionToRelayMessage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") {
    return null;
  }
  const msg = parsed as RelayFrame;
  // Validate the fields the bridge dereferences per frame type. Anything else
  // is dropped as malformed: bindSocket invokes the handler without try/catch,
  // so a bad frame reaching the bridge would escape as an uncaughtException.
  switch (msg.type) {
    case "hello":
      return isExtensionHelloMessage(msg) ? msg : null;
    case "tabs":
      return isExtensionTabsMessage(msg) ? msg : null;
    case "cdpEvent":
      return isExtensionCdpEventMessage(msg) ? msg : null;
    case "result":
      return isExtensionResultMessage(msg) ? msg : null;
    case "error":
      return isExtensionErrorMessage(msg) ? msg : null;
    case "detached":
      return isExtensionDetachedMessage(msg) ? msg : null;
    case "taskTabRemoved":
      return isExtensionTaskTabRemovedMessage(msg) ? msg : null;
    case "navigationCheck":
      return isExtensionNavigationCheckMessage(msg) ? msg : null;
    case "pong":
      return isExtensionPongMessage(msg) ? msg : null;
    default:
      return null;
  }
}
