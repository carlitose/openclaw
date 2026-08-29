import { createDescendantTabContainment } from "./descendant-tab-containment.js";
import { ACCESS_MODE_ALL, ACCESS_MODE_SELECTED } from "./relay-core.js";
import { effectiveTabUrl } from "./tab-eligibility.js";

/** Register Chrome lifecycle events that can grant, revoke, or project tab access. */
export function registerTabAccessEvents({
  chromeApi = chrome,
  accessReady,
  policy,
  isTabInOpenClawGroup,
  attachedTabs,
  attachedAccessEpochs,
  attachmentTokens,
  attachingTabs,
  send,
  scheduleTabsSync,
  detachDebugger,
  pauseTab,
  removeTabFromOpenClawGroup,
  placeTabInGroup,
  runAccessMutation,
  classifyDescendantNavigation,
  taskTabs = {
    registerDescendant: () => null,
    generationFor: () => undefined,
    isInitializing: () => false,
    forget: () => undefined,
    replace: () => false,
    revoke: () => undefined,
  },
  getUtilityWorldName,
  forgetUtilityWorld,
}) {
  let groupEventRevision = 0;
  const descendantContainment = createDescendantTabContainment({
    chromeApi,
    accessReady,
    policy,
    isTabInOpenClawGroup,
    placeTabInGroup,
    removeTabFromGroup: removeTabFromOpenClawGroup,
    ...(classifyDescendantNavigation ? { classifyNavigation: classifyDescendantNavigation } : {}),
    scheduleTabsSync,
    runAccessMutation,
  });
  const mainContextProbes = new Map();
  const attachmentIsCurrent = (tabId, accessEpoch, attachmentToken) =>
    policy.epochIsCurrent(tabId, accessEpoch) &&
    attachedTabs.has(tabId) &&
    attachmentTokens.get(tabId) === attachmentToken;
  const probeMainContextId = async (tabId, accessEpoch, attachmentToken) => {
    const probe = {
      accessEpoch,
      attachmentToken,
      bindingName: `__openclaw_context_probe_${crypto.randomUUID()}`,
      contextId: undefined,
    };
    mainContextProbes.set(tabId, probe);
    let bindingInstalled = false;
    try {
      await chromeApi.debugger.sendCommand({ tabId }, "Runtime.addBinding", {
        name: probe.bindingName,
        executionContextName: "",
      });
      bindingInstalled = true;
      if (!attachmentIsCurrent(tabId, accessEpoch, attachmentToken)) {
        return undefined;
      }
      const bindingReference = `globalThis[${JSON.stringify(probe.bindingName)}]`;
      // The binding event reports the default context id. The same evaluation
      // deletes the temporary page property before the session binding is removed.
      await chromeApi.debugger.sendCommand({ tabId }, "Runtime.evaluate", {
        expression: `try { ${bindingReference}(""); } finally { delete ${bindingReference}; }`,
        silent: true,
      });
      return probe.contextId;
    } catch {
      return undefined;
    } finally {
      // A unique binding may outlive an access epoch, but never its debugger
      // attachment. Remove it without mutating a replacement attachment.
      if (bindingInstalled && attachmentTokens.get(tabId) === attachmentToken) {
        await chromeApi.debugger
          .sendCommand({ tabId }, "Runtime.removeBinding", { name: probe.bindingName })
          .catch(() => undefined);
      }
      if (mainContextProbes.get(tabId) === probe) {
        mainContextProbes.delete(tabId);
      }
    }
  };

  chromeApi.debugger.onEvent.addListener((source, method, params) => {
    if (typeof source.tabId !== "number") {
      return;
    }
    const mainContextProbe = mainContextProbes.get(source.tabId);
    if (
      method === "Runtime.bindingCalled" &&
      source.sessionId === undefined &&
      mainContextProbe &&
      attachmentTokens.get(source.tabId) === mainContextProbe.attachmentToken &&
      policy.epochIsCurrent(source.tabId, mainContextProbe.accessEpoch) &&
      params?.name === mainContextProbe.bindingName &&
      params?.payload === "" &&
      typeof params.executionContextId === "number"
    ) {
      mainContextProbe.contextId = params.executionContextId;
      return;
    }
    const accessEpoch = attachedAccessEpochs.get(source.tabId);
    const accessIsCurrent = accessEpoch && policy.epochIsCurrent(source.tabId, accessEpoch);
    const taskGeneration = taskTabs.isInitializing?.(source.tabId)
      ? taskTabs.generationFor?.(source.tabId)
      : undefined;
    if (!accessIsCurrent && !taskGeneration) {
      return;
    }
    send({
      type: "cdpEvent",
      tabId: source.tabId,
      ...(taskGeneration ? { taskGeneration } : {}),
      ...(source.sessionId ? { sessionId: source.sessionId } : {}),
      method,
      params,
    });
  });

  chromeApi.debugger.onDetach.addListener((source, reason) => {
    if (typeof source.tabId !== "number") {
      return;
    }
    attachedTabs.delete(source.tabId);
    attachedAccessEpochs.delete(source.tabId);
    attachmentTokens.delete(source.tabId);
    mainContextProbes.delete(source.tabId);
    forgetUtilityWorld(source.tabId);
    send({ type: "detached", tabId: source.tabId, reason });
    if (reason !== "canceled_by_user") {
      return;
    }
    taskTabs.revoke(source.tabId);
    const revocation = policy.beginRevocation(source.tabId);
    void runAccessMutation(async () => {
      try {
        await accessReady;
        if (policy.mode === ACCESS_MODE_ALL) {
          await pauseTab(source.tabId);
        } else {
          policy.invalidateTab(source.tabId);
          await removeTabFromOpenClawGroup(source.tabId);
          scheduleTabsSync();
        }
      } finally {
        policy.endRevocation(revocation);
      }
    }).catch(() => undefined);
  });

  chromeApi.tabs.onCreated.addListener((tab) => {
    if (typeof tab.openerTabId === "number" && typeof tab.id === "number") {
      taskTabs.registerDescendant(tab.openerTabId, tab.id);
    }
    descendantContainment.onCreated(tab);
  });

  chromeApi.tabs.onRemoved.addListener((tabId) => {
    descendantContainment.onRemoved(tabId);
    const taskGeneration = taskTabs.generationFor?.(tabId);
    taskTabs.forget(tabId);
    if (taskGeneration) {
      send({ type: "taskTabRemoved", tabId, taskGeneration });
    }
    void (async () => {
      await accessReady;
      policy.invalidateTab(tabId);
      attachedTabs.delete(tabId);
      attachedAccessEpochs.delete(tabId);
      attachmentTokens.delete(tabId);
      mainContextProbes.delete(tabId);
      forgetUtilityWorld(tabId);
      scheduleTabsSync();
      await policy.forgetTab(tabId).catch(() => undefined);
    })();
  });

  chromeApi.tabs.onReplaced.addListener((addedTabId, removedTabId) => {
    taskTabs.replace(addedTabId, removedTabId);
    const revocation = policy.beginRevocation(addedTabId);
    policy.invalidateTab(removedTabId);
    attachedTabs.delete(removedTabId);
    attachedAccessEpochs.delete(removedTabId);
    attachmentTokens.delete(removedTabId);
    mainContextProbes.delete(removedTabId);
    forgetUtilityWorld(removedTabId);
    void (async () => {
      try {
        await accessReady;
        await policy.replaceTab(addedTabId, removedTabId);
        await Promise.allSettled([attachingTabs.get(removedTabId), attachingTabs.get(addedTabId)]);
        await Promise.allSettled([detachDebugger(removedTabId), detachDebugger(addedTabId)]);
      } finally {
        policy.endRevocation(revocation);
        // Publish the replacement only after both old and newly racing
        // attachments are gone, so the relay cannot reattach into this cleanup.
        scheduleTabsSync();
      }
    })().catch(() => undefined);
  });

  const taskTabDefersReconciliation = async (tabId, eventIsCurrent) => {
    const taskGeneration = taskTabs.generationFor?.(tabId);
    if (!taskGeneration) {
      return !eventIsCurrent();
    }
    const taskTab = await chromeApi.tabs.get(tabId).catch(() => null);
    return (
      !eventIsCurrent() ||
      taskTabs.generationFor?.(tabId) !== taskGeneration ||
      !taskTab ||
      taskTab.url === "about:blank"
    );
  };

  chromeApi.tabs.onUpdated.addListener((tabId, changeInfo) => {
    scheduleTabsSync();
    const urlChanged = typeof changeInfo.url === "string";
    if (urlChanged || typeof changeInfo.groupId === "number") {
      // Security contract: every URL change retires synchronous CDP authority.
      // Pre-proof events intentionally drop; replay could cross a restricted destination.
      policy.invalidateTab(tabId);
    }
    descendantContainment.onUpdated(tabId, changeInfo);
    const eventEpoch = policy.capture(tabId);
    void (async () => {
      await accessReady;
      const eventIsCurrent = () => policy.epochIsCurrent(tabId, eventEpoch);
      if (!eventIsCurrent()) {
        return;
      }
      // pendingUrl is only the destination: the exact task attachment must stay alive while
      // about:blank is committed, or detaching here aborts the in-flight Page.navigate.
      if (await taskTabDefersReconciliation(tabId, eventIsCurrent)) {
        return;
      }
      const state = await policy.inspectTab(tabId, eventEpoch);
      if (!eventIsCurrent()) {
        return;
      }
      if (!state.accessible) {
        if (state.reason === "not-selected" || state.reason === "paused") {
          taskTabs.revoke(tabId);
        }
        await Promise.allSettled([attachingTabs.get(tabId)]);
        if (!eventIsCurrent()) {
          return;
        }
        // tabs.create() can register task ownership while the policy inspection
        // above is pending. Recheck at the final detach boundary.
        if (await taskTabDefersReconciliation(tabId, eventIsCurrent)) {
          return;
        }
        await detachDebugger(tabId);
      }
      if (state.accessible && attachedTabs.has(tabId) && !attachedAccessEpochs.has(tabId)) {
        attachedAccessEpochs.set(tabId, eventEpoch);
      }
      if (attachedTabs.has(tabId) && attachedAccessEpochs.has(tabId)) {
        if (!urlChanged) {
          attachedAccessEpochs.set(tabId, eventEpoch);
          return;
        }
        const attachmentToken = attachmentTokens.get(tabId);
        const snapshot = await chromeApi.debugger
          .sendCommand({ tabId }, "Page.getFrameTree")
          .catch(() => undefined);
        const frame = snapshot?.frameTree?.frame;
        const frameUrl =
          typeof frame?.url === "string" &&
          (frame.urlFragment === undefined || typeof frame.urlFragment === "string")
            ? `${frame.url}${frame.urlFragment ?? ""}`
            : null;
        if (
          !attachmentToken ||
          !attachmentIsCurrent(tabId, eventEpoch, attachmentToken) ||
          typeof frame?.id !== "string" ||
          typeof frame.loaderId !== "string" ||
          frameUrl !== effectiveTabUrl(state.tab)
        ) {
          return;
        }
        const mainContextId = await probeMainContextId(tabId, eventEpoch, attachmentToken);
        if (
          !attachmentIsCurrent(tabId, eventEpoch, attachmentToken) ||
          typeof mainContextId !== "number"
        ) {
          return;
        }
        const utilityWorldName = getUtilityWorldName(tabId);
        const utilityContext =
          typeof utilityWorldName === "string"
            ? await chromeApi.debugger
                .sendCommand({ tabId }, "Page.createIsolatedWorld", {
                  frameId: frame.id,
                  worldName: utilityWorldName,
                  grantUniveralAccess: true,
                })
                .catch(() => undefined)
            : undefined;
        const utilityContextId = utilityContext?.executionContextId;
        if (
          !attachmentIsCurrent(tabId, eventEpoch, attachmentToken) ||
          (utilityWorldName !== undefined && typeof utilityContextId !== "number")
        ) {
          return;
        }
        attachedAccessEpochs.set(tabId, eventEpoch);
        const contextOrigin = typeof frame.securityOrigin === "string" ? frame.securityOrigin : "";
        // Reconstruct only Chrome's proven current state, never pre-proof event payloads.
        send({
          type: "cdpEvent",
          tabId,
          method: "Page.frameNavigated",
          params: { frame, type: "Navigation" },
        });
        send({
          type: "cdpEvent",
          tabId,
          method: "Runtime.executionContextCreated",
          params: {
            context: {
              id: mainContextId,
              origin: contextOrigin,
              name: "",
              auxData: { frameId: frame.id, isDefault: true, type: "default" },
            },
          },
        });
        if (typeof utilityWorldName === "string" && typeof utilityContextId === "number") {
          send({
            type: "cdpEvent",
            tabId,
            method: "Runtime.executionContextCreated",
            params: {
              context: {
                id: utilityContextId,
                origin: contextOrigin,
                name: utilityWorldName,
                auxData: { frameId: frame.id, isDefault: false, type: "isolated" },
              },
            },
          });
        }
        // Enabling lifecycle events makes Chromium emit milestones already reached.
        await chromeApi.debugger
          .sendCommand({ tabId }, "Page.setLifecycleEventsEnabled", { enabled: true })
          .catch(() => undefined);
      }
    })();
  });

  const onGroupChanged = () => {
    descendantContainment.reconcile();
    const eventRevision = ++groupEventRevision;
    scheduleTabsSync();
    if (policy.mode !== ACCESS_MODE_SELECTED) {
      return;
    }
    // Group title/removal changes mutate the selected-mode ACL. Retire every
    // attachment epoch synchronously before any readiness or Chrome lookup.
    policy.invalidateAll();
    void accessReady.then(async () => {
      if (eventRevision !== groupEventRevision || policy.mode !== ACCESS_MODE_SELECTED) {
        return;
      }
      const epochs = new Map(
        [...attachedAccessEpochs.keys()]
          .filter((tabId) => attachedTabs.has(tabId))
          .map((tabId) => [tabId, policy.capture(tabId)]),
      );
      await Promise.allSettled(attachingTabs.values());
      if (eventRevision !== groupEventRevision) {
        return;
      }
      const selected = new Set((await policy.listAccessibleTabs()).map((tab) => tab.id));
      if (eventRevision !== groupEventRevision) {
        return;
      }
      await Promise.allSettled(
        [...attachedTabs]
          .filter((tabId) => !selected.has(tabId))
          .map((tabId) => detachDebugger(tabId)),
      );
      if (eventRevision !== groupEventRevision) {
        return;
      }
      let newerTabEventOwnsAccess = false;
      for (const [tabId, epoch] of epochs) {
        if (!selected.has(tabId) || !attachedTabs.has(tabId)) {
          continue;
        }
        const state = await policy.inspectTab(tabId, epoch);
        if (eventRevision !== groupEventRevision) {
          return;
        }
        if (!policy.epochIsCurrent(tabId, epoch)) {
          // A newer tab event owns this attachment's revision.
          newerTabEventOwnsAccess = true;
          continue;
        }
        if (state.accessible) {
          attachedAccessEpochs.set(tabId, epoch);
        } else {
          await detachDebugger(tabId);
          if (eventRevision !== groupEventRevision) {
            return;
          }
        }
      }
      if (eventRevision !== groupEventRevision) {
        return;
      }
      if (newerTabEventOwnsAccess) {
        onGroupChanged();
      }
    });
  };
  chromeApi.tabGroups.onUpdated.addListener(onGroupChanged);
  chromeApi.tabGroups.onRemoved.addListener(onGroupChanged);
}
