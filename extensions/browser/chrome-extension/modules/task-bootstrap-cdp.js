const UTILITY_WORLD_PREFIX = "__playwright_utility_world_";
const FONT_FAMILY_KEYS = "standard fixed serif sansSerif cursive fantasy math".split(" ");
// Playwright initializes media before navigation using these context-option enums.
// Keep valid defaults bounded without granting arbitrary Emulation-domain authority.
const MEDIA_FEATURES = [
  ["prefers-color-scheme", ["", "light", "dark", "no-preference"]],
  ["prefers-reduced-motion", ["", "reduce", "no-preference"]],
  ["forced-colors", ["", "active", "none"]],
  ["prefers-contrast", ["", "no-preference", "more"]],
];

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

function isFontFamilies(value) {
  const keys =
    value && typeof value === "object" && !Array.isArray(value) ? Object.keys(value) : [];
  return (
    keys.length > 0 &&
    keys.length <= FONT_FAMILY_KEYS.length &&
    keys.every(
      (key) =>
        FONT_FAMILY_KEYS.includes(key) &&
        typeof value[key] === "string" &&
        value[key].length > 0 &&
        value[key].length <= 256,
    )
  );
}

function isFontFamilyBootstrap(params) {
  return (
    (hasExactKeys(params, ["fontFamilies"]) ||
      hasExactKeys(params, ["fontFamilies", "forScripts"])) &&
    isFontFamilies(params.fontFamilies) &&
    (params.forScripts === undefined ||
      (Array.isArray(params.forScripts) &&
        params.forScripts.length <= 32 &&
        params.forScripts.every(
          (entry) =>
            hasExactKeys(entry, ["script", "fontFamilies"]) &&
            typeof entry.script === "string" &&
            /^[a-z]{4}$/.test(entry.script) &&
            isFontFamilies(entry.fontFamilies),
        )))
  );
}

function isEmulatedMediaBootstrap(params) {
  const features = params?.features;
  return (
    hasExactKeys(params, ["media", "features"]) &&
    params.media === "" &&
    Array.isArray(features) &&
    features.length === MEDIA_FEATURES.length &&
    features.every(
      (feature, index) =>
        hasExactKeys(feature, ["name", "value"]) &&
        feature.name === MEDIA_FEATURES[index][0] &&
        MEDIA_FEATURES[index][1].includes(feature.value),
    )
  );
}

function isRequestInterceptionBootstrap(params) {
  return (
    hasExactKeys(params, ["handleAuthRequests", "patterns"]) &&
    params.handleAuthRequests === true &&
    Array.isArray(params.patterns) &&
    params.patterns.length === 1 &&
    hasExactKeys(params.patterns[0], ["urlPattern", "requestStage"]) &&
    params.patterns[0].urlPattern === "*" &&
    params.patterns[0].requestStage === "Request"
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
    case "Page.setFontFamilies":
      // Headless Playwright applies bounded platform font defaults before navigation.
      // Keep that inert setup available without granting general Page-domain authority.
      return isFontFamilyBootstrap(params);
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
      return isEmulatedMediaBootstrap(params);
    case "Network.setCacheDisabled":
      // Playwright installs its request guard before the first URL. Exact task/client
      // ownership keeps this inert setup on the hidden tab; rejecting it dead-ends navigation.
      return hasExactKeys(params, ["cacheDisabled"]) && params.cacheDisabled === true;
    case "Fetch.enable":
      return isRequestInterceptionBootstrap(params);
    default:
      return false;
  }
}
