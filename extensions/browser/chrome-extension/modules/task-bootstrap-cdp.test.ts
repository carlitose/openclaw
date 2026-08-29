import { describe, expect, it } from "vitest";
import { isTaskBootstrapCdpCommand } from "./task-bootstrap-cdp.js";

describe("task bootstrap CDP contract", () => {
  it.each([
    ["Page.enable", undefined],
    ["Page.getFrameTree", {}],
    ["Log.enable", {}],
    ["Page.setLifecycleEventsEnabled", { enabled: true }],
    ["Runtime.enable", {}],
    [
      "Page.addScriptToEvaluateOnNewDocument",
      { source: "", worldName: "__playwright_utility_world_page-guid" },
    ],
    [
      "Page.createIsolatedWorld",
      {
        frameId: "frame-1",
        grantUniveralAccess: true,
        worldName: "__playwright_utility_world_page-guid",
      },
    ],
    ["Page.setInterceptFileChooserDialog", { enabled: false }],
    ["Network.enable", undefined],
    ["Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }],
    ["Emulation.setFocusEmulationEnabled", { enabled: true }],
    [
      "Page.setFontFamilies",
      {
        fontFamilies: {
          standard: "Times New Roman",
          fixed: "Consolas",
          serif: "Times New Roman",
          sansSerif: "Arial",
          cursive: "Comic Sans MS",
          fantasy: "Impact",
        },
        forScripts: [
          {
            script: "cyrl",
            fontFamilies: {
              standard: "Times New Roman",
              fixed: "Courier New",
              serif: "Times New Roman",
              sansSerif: "Arial",
            },
          },
        ],
      },
    ],
    [
      "Emulation.setEmulatedMedia",
      {
        media: "",
        features: [
          { name: "prefers-color-scheme", value: "" },
          { name: "prefers-reduced-motion", value: "" },
          { name: "forced-colors", value: "" },
          { name: "prefers-contrast", value: "" },
        ],
      },
    ],
    [
      "Emulation.setEmulatedMedia",
      {
        media: "",
        features: [
          { name: "prefers-color-scheme", value: "light" },
          { name: "prefers-reduced-motion", value: "no-preference" },
          { name: "forced-colors", value: "none" },
          { name: "prefers-contrast", value: "no-preference" },
        ],
      },
    ],
    ["Runtime.runIfWaitingForDebugger", undefined],
  ])("allows %s with its inert bootstrap parameters", (method, params) => {
    expect(isTaskBootstrapCdpCommand(method, params)).toBe(true);
  });

  it.each([
    ["Runtime.evaluate", { expression: "location.href='https://example.com'" }],
    [
      "Page.addScriptToEvaluateOnNewDocument",
      { source: "location.href='https://example.com'", worldName: "__playwright_utility_world_x" },
    ],
    ["Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }],
    ["Page.enable", { extra: true }],
    ["Page.setFontFamilies", { fontFamilies: { systemUi: "Segoe UI" } }],
    ["Page.setFontFamilies", { fontFamilies: { sansSerif: "x".repeat(257) } }],
    [
      "Emulation.setEmulatedMedia",
      {
        media: "",
        features: [
          { name: "prefers-color-scheme", value: "sepia" },
          { name: "prefers-reduced-motion", value: "no-preference" },
          { name: "forced-colors", value: "none" },
          { name: "prefers-contrast", value: "no-preference" },
        ],
      },
    ],
    [
      "Page.setFontFamilies",
      {
        fontFamilies: { sansSerif: "Arial" },
        forScripts: [{ script: "latin", fontFamilies: { sansSerif: "Arial" } }],
      },
    ],
    [
      "Page.setFontFamilies",
      {
        fontFamilies: { sansSerif: "Arial" },
        forScripts: Array.from({ length: 33 }, () => ({
          script: "latn",
          fontFamilies: { sansSerif: "Arial" },
        })),
      },
    ],
  ])("rejects %s outside the exact bootstrap contract", (method, params) => {
    expect(isTaskBootstrapCdpCommand(method, params)).toBe(false);
  });
});
