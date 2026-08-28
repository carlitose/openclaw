import {
  classifyNavigationUrl,
  compileNavigationPolicy,
  parseCompiledNavigationPolicy,
} from "./navigation-policy.js";
import { effectiveTabUrl } from "./tab-eligibility.js";

/** Owns the relay-bound policy, remote decisions, and task-tab cleanup coupling. */
export function createNavigationPolicyController({
  chromeApi = chrome,
  timeoutMs,
  isRelayAuthenticated,
  send,
  taskTabs,
  invalidateAccess,
  onPolicyInstalled,
}) {
  let installedPolicy = null;
  let installedNonce = null;
  let nextCheckSeq = 1;
  const pendingChecks = new Map();
  const decisionCache = new Map();

  function clear() {
    installedPolicy = null;
    installedNonce = null;
    for (const pending of pendingChecks.values()) {
      clearTimeout(pending.timer);
      pending.resolve({ status: "denied", reason: "relay-disconnected" });
    }
    pendingChecks.clear();
    decisionCache.clear();
    invalidateAccess();
  }

  async function cleanupDeniedTaskTab(tabId, expectedUrl, expectedNonce) {
    const current = await chromeApi.tabs.get(tabId).catch(() => null);
    if (
      !current ||
      effectiveTabUrl(current) !== expectedUrl ||
      (expectedNonce !== undefined && installedNonce !== expectedNonce)
    ) {
      return;
    }
    const taskGeneration = taskTabs.generationFor(tabId);
    if (taskGeneration) {
      await taskTabs.cleanup(taskGeneration);
    }
  }

  async function checkRemote(tab, url, nonce) {
    const seq = nextCheckSeq++;
    const decision = await new Promise((resolve) => {
      const timer = setTimeout(() => {
        pendingChecks.delete(seq);
        resolve({ status: "denied", reason: "navigation-check-timeout" });
      }, timeoutMs);
      pendingChecks.set(seq, { nonce, resolve, timer });
      send({ type: "navigationCheck", seq, nonce, tabId: tab.id, url });
    });
    if (installedNonce === nonce) {
      decisionCache.set(tab.id, { url, nonce, decision });
    }
    if (decision.status === "denied") {
      void cleanupDeniedTaskTab(tab.id, url, nonce);
    }
    return decision;
  }

  function classifyTab(tab) {
    const policy = installedPolicy;
    const nonce = installedNonce;
    if (!policy) {
      return { status: "denied", reason: "policy-not-installed" };
    }
    const url = effectiveTabUrl(tab);
    const local = classifyNavigationUrl(url, policy);
    if (local.status !== "allowed" || !nonce) {
      if (local.status === "denied") {
        void cleanupDeniedTaskTab(tab.id, url);
      }
      return local;
    }
    const cached = decisionCache.get(tab.id);
    if (cached?.url === url && cached.nonce === nonce) {
      return cached.decision;
    }
    if (!isRelayAuthenticated()) {
      return { status: "denied", reason: "relay-disconnected" };
    }
    return checkRemote(tab, url, nonce);
  }

  async function installFrame(message) {
    const policy = parseCompiledNavigationPolicy(message?.policy);
    if (
      Object.keys(message ?? {}).length !== 3 ||
      message?.type !== "navigationPolicy.v1" ||
      typeof message.nonce !== "string" ||
      message.nonce.length < 16 ||
      message.nonce.length > 128 ||
      !policy
    ) {
      throw new Error("relay sent an invalid navigation policy installation");
    }
    clear();
    installedPolicy = policy;
    installedNonce = message.nonce;
    await onPolicyInstalled(message.nonce);
  }

  function installLegacyEmptyPolicy() {
    installedPolicy = compileNavigationPolicy();
  }

  function handleDecision(message) {
    const pending = pendingChecks.get(message?.seq);
    if (
      !pending ||
      message?.type !== "navigationDecision" ||
      message.nonce !== pending.nonce ||
      typeof message.allowed !== "boolean"
    ) {
      return;
    }
    pendingChecks.delete(message.seq);
    clearTimeout(pending.timer);
    pending.resolve(
      message.allowed
        ? { status: "allowed" }
        : { status: "denied", reason: "navigation-policy", message: message.message },
    );
  }

  return {
    classifyTab,
    clear,
    handleDecision,
    hasInstalledPolicy: () => installedPolicy !== null,
    installFrame,
    installLegacyEmptyPolicy,
  };
}
