const UTILITY_WORLD_PREFIX = "__playwright_utility_world_";

function hasExactKeys(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function hasNoParams(params) {
  return params === undefined || hasExactKeys(params, []);
}

function isUtilityWorldName(value) {
  return (
    typeof value === "string" &&
    value.startsWith(UTILITY_WORLD_PREFIX) &&
    value.length > UTILITY_WORLD_PREFIX.length &&
    value.length <= 256
  );
}

/** Commands needed to initialize an unpublished empty page without reading or executing content. */
export function isTaskBootstrapCdpCommand(method, params) {
  switch (method) {
    case "Page.enable":
    case "Page.getFrameTree":
    case "Log.enable":
    case "Runtime.enable":
    case "Network.enable":
    case "Runtime.runIfWaitingForDebugger":
      return hasNoParams(params);
    case "Page.setLifecycleEventsEnabled":
    case "Emulation.setFocusEmulationEnabled":
      return hasExactKeys(params, ["enabled"]) && params.enabled === true;
    case "Page.setInterceptFileChooserDialog":
      return hasExactKeys(params, ["enabled"]) && typeof params.enabled === "boolean";
    case "Page.addScriptToEvaluateOnNewDocument":
      return (
        hasExactKeys(params, ["source", "worldName"]) &&
        params.source === "" &&
        isUtilityWorldName(params.worldName)
      );
    case "Page.createIsolatedWorld":
      return (
        hasExactKeys(params, ["frameId", "grantUniveralAccess", "worldName"]) &&
        typeof params.frameId === "string" &&
        params.frameId.length > 0 &&
        params.frameId.length <= 256 &&
        params.grantUniveralAccess === true &&
        isUtilityWorldName(params.worldName)
      );
    case "Target.setAutoAttach":
      return (
        hasExactKeys(params, ["autoAttach", "waitForDebuggerOnStart", "flatten"]) &&
        params.autoAttach === true &&
        params.waitForDebuggerOnStart === true &&
        params.flatten === true
      );
    case "Emulation.setEmulatedMedia":
      return (
        hasExactKeys(params, ["media", "features"]) &&
        params.media === "" &&
        Array.isArray(params.features) &&
        JSON.stringify(params.features) ===
          JSON.stringify([
            { name: "prefers-color-scheme", value: "" },
            { name: "prefers-reduced-motion", value: "" },
            { name: "forced-colors", value: "" },
            { name: "prefers-contrast", value: "" },
          ])
      );
    default:
      return false;
  }
}
