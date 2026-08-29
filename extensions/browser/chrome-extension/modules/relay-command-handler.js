import { isTaskBootstrapCdpCommand } from "./task-bootstrap-cdp.js";

/** Build the authenticated application-command dispatcher for the relay socket. */
export function createRelayCommandHandler({
  send,
  attachDebugger,
  detachDebugger,
  addTabToOpenClawGroup,
  focusWindowForTab,
  scheduleTabsSync,
  captureAccess,
  requireAccessibleTab,
  rememberUtilityWorld,
  attachCreatedDebugger,
  taskTabs,
}) {
  return async (message) => {
    const { seq } = message;
    try {
      switch (message.type) {
        case "ping":
          send({ type: "pong" });
          return;
        case "attach":
          send({ type: "result", seq, result: await attachDebugger(message.tabId) });
          return;
        case "detach":
          await detachDebugger(message.tabId);
          send({ type: "result", seq, result: {} });
          return;
        case "cdp": {
          const epoch = captureAccess(message.tabId);
          const exactTask =
            taskTabs.isInitializing(message.tabId) &&
            taskTabs.owns(message.tabId, message.taskGeneration);
          const taskCommand =
            exactTask &&
            (message.method === "Page.navigate" ||
              isTaskBootstrapCdpCommand(message.method, message.params));
          if (!taskCommand) {
            await requireAccessibleTab(message.tabId, epoch);
          }
          const target = message.sessionId
            ? { tabId: message.tabId, sessionId: message.sessionId }
            : { tabId: message.tabId };
          const result = await chrome.debugger.sendCommand(
            target,
            message.method,
            message.params ?? {},
          );
          if (!taskCommand) {
            await requireAccessibleTab(message.tabId, epoch);
          }
          if (
            message.sessionId === undefined &&
            message.method === "Page.addScriptToEvaluateOnNewDocument" &&
            typeof message.params?.worldName === "string" &&
            message.params.worldName.length > 0
          ) {
            rememberUtilityWorld(message.tabId, message.params.worldName);
          }
          send({ type: "result", seq, result: result ?? {} });
          return;
        }
        case "createTab": {
          const tab = await chrome.tabs.create({
            url: message.url,
            active: message.background !== true,
          });
          const taskGeneration = taskTabs.registerRoot(tab.id);
          try {
            await addTabToOpenClawGroup(tab.id);
            if (message.focus === true) {
              await focusWindowForTab(tab);
            }
            const attached = await attachCreatedDebugger(tab.id, taskGeneration);
            scheduleTabsSync();
            send({
              type: "result",
              seq,
              result: { tabId: tab.id, taskGeneration, targetId: attached.targetId },
            });
          } catch (error) {
            const messageText = error instanceof Error ? error.message : String(error);
            const cleanup = await taskTabs.cleanup(taskGeneration);
            send({
              type: "error",
              seq,
              message:
                cleanup.status === "complete"
                  ? messageText
                  : `${messageText}; exact tab cleanup is incomplete—close tab ${tab.id} manually before retrying`,
              details: { kind: "tab-creation-failed", tabId: tab.id, cleanup },
            });
            return;
          }
          return;
        }
        case "cleanupTask": {
          if (!taskTabs.owns(message.tabId, message.taskGeneration)) {
            throw new Error(`task ownership for tab ${message.tabId} is no longer current`);
          }
          const cleanup = await taskTabs.cleanup(message.taskGeneration);
          if (cleanup.status === "incomplete") {
            send({
              type: "error",
              seq,
              message: `Task cleanup is incomplete—close tabs ${cleanup.remainingTabIds.join(", ")} manually before retrying`,
              details: { kind: "task-cleanup-incomplete", cleanup },
            });
          } else {
            send({ type: "result", seq, result: { cleanup } });
          }
          return;
        }
        case "publishTask": {
          if (!taskTabs.owns(message.tabId, message.taskGeneration)) {
            throw new Error(`task ownership for tab ${message.tabId} is no longer current`);
          }
          taskTabs.publish(message.tabId);
          send({ type: "result", seq, result: {} });
          return;
        }
        case "closeTab": {
          const epoch = captureAccess(message.tabId);
          await requireAccessibleTab(message.tabId, epoch);
          await detachDebugger(message.tabId);
          await requireAccessibleTab(message.tabId, epoch);
          await chrome.tabs.remove(message.tabId);
          send({ type: "result", seq, result: {} });
          return;
        }
        case "activateTab": {
          const epoch = captureAccess(message.tabId);
          const tab = await requireAccessibleTab(message.tabId, epoch);
          await chrome.tabs.update(message.tabId, { active: true });
          await requireAccessibleTab(message.tabId, epoch);
          await focusWindowForTab(tab);
          await requireAccessibleTab(message.tabId, epoch);
          send({ type: "result", seq, result: {} });
          return;
        }
        default:
          if (typeof seq === "number") {
            send({ type: "error", seq, message: `unknown relay command: ${message.type}` });
          }
      }
    } catch (error) {
      if (typeof seq === "number") {
        send({
          type: "error",
          seq,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
  };
}
