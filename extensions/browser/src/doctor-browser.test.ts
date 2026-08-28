// Browser tests cover doctor browser plugin behavior.
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAutoCleanupTempDirTracker } from "../test-support.js";
import {
  maybeArchiveLegacyClawdBrowserProfileResidue,
  noteChromeMcpBrowserReadiness,
} from "./doctor-browser.js";

const tempDirs = useAutoCleanupTempDirTracker(afterEach);

function requireFirstNoteText(noteFn: ReturnType<typeof vi.fn>): string {
  const [call] = noteFn.mock.calls;
  if (!call) {
    throw new Error("expected browser doctor note");
  }
  const [message] = call;
  return String(message);
}

function requireNoteTextContaining(noteFn: ReturnType<typeof vi.fn>, expected: string): string {
  const call = noteFn.mock.calls.find(([message]) => String(message).includes(expected));
  if (!call) {
    throw new Error(`expected browser doctor note containing ${expected}`);
  }
  return String(call[0]);
}

describe("browser doctor readiness", () => {
  it("does nothing when Chrome MCP is not configured", async () => {
    const noteFn = vi.fn();
    await noteChromeMcpBrowserReadiness(
      {
        browser: {
          extensionRelay: { allowLegacyAuth: false },
          profiles: {
            openclaw: { color: "#FF4500" },
          },
        },
      },
      {
        noteFn,
        platform: "linux",
        env: { DISPLAY: ":99" },
        getUid: () => 1000,
        resolveManagedExecutable: () => ({ kind: "chrome", path: "/usr/bin/google-chrome" }),
      },
    );
    expect(noteFn).not.toHaveBeenCalled();
  });

  it("warns while legacy Browser Relay Authentication remains enabled", async () => {
    const noteFn = vi.fn();
    await noteChromeMcpBrowserReadiness(
      {
        browser: {
          extensionRelay: { allowLegacyAuth: true },
          profiles: {
            openclaw: { color: "#FF4500" },
          },
        },
      },
      {
        noteFn,
        platform: "linux",
        env: { DISPLAY: ":99" },
        getUid: () => 1000,
        resolveManagedExecutable: () => ({ kind: "chrome", path: "/usr/bin/google-chrome" }),
      },
    );

    expect(noteFn).toHaveBeenCalledWith(
      expect.stringContaining("browser.extensionRelay.allowLegacyAuth=true"),
      "Browser relay authentication",
    );
  });

  it("warns when managed browser profiles have no local executable", async () => {
    const noteFn = vi.fn();
    await noteChromeMcpBrowserReadiness(
      {
        browser: {
          extensionRelay: { allowLegacyAuth: false },
          profiles: {
            openclaw: { color: "#FF4500" },
          },
        },
      },
      {
        noteFn,
        platform: "linux",
        env: { DISPLAY: ":99" },
        getUid: () => 1000,
        resolveManagedExecutable: () => null,
      },
    );

    expect(noteFn).toHaveBeenCalledWith(
      [
        "- OpenClaw-managed browser profile(s) are configured: openclaw.",
        "- No Chromium-based browser executable was found on this host for OpenClaw-managed launch.",
        "- Install Chrome, Chromium, Brave, Edge, or set browser.executablePath explicitly.",
      ].join("\n"),
      "Browser",
    );
  });

  it("warns when managed browser launch needs display and no-sandbox adjustments", async () => {
    const noteFn = vi.fn();
    await noteChromeMcpBrowserReadiness(
      {
        browser: {
          extensionRelay: { allowLegacyAuth: false },
          headless: false,
          noSandbox: false,
          profiles: {
            openclaw: { color: "#FF4500" },
          },
        },
      },
      {
        noteFn,
        platform: "linux",
        env: {},
        getUid: () => 0,
        resolveManagedExecutable: () => ({ kind: "chromium", path: "/usr/bin/chromium" }),
      },
    );

    expect(noteFn).toHaveBeenCalledWith(
      [
        "- OpenClaw-managed browser profile(s) are configured: openclaw.",
        "- No DISPLAY or WAYLAND_DISPLAY is set, and browser.headless is false. Managed browser launch needs a desktop session, Xvfb, or browser.headless: true.",
        "- The Gateway is running as root and browser.noSandbox is false. Chromium commonly requires browser.noSandbox: true in container/root runtimes.",
      ].join("\n"),
      "Browser",
    );
  });

  it("warns about legacy clawd managed browser profile residue", async () => {
    const noteFn = vi.fn();
    const configDir = "/tmp/openclaw-home";
    const legacyUserDataDir = path.join(configDir, "browser", "clawd", "user-data");

    await noteChromeMcpBrowserReadiness(
      {
        browser: {
          extensionRelay: { allowLegacyAuth: false },
          profiles: {
            openclaw: { color: "#FF4500" },
          },
        },
      },
      {
        noteFn,
        platform: "linux",
        env: { DISPLAY: ":99" },
        getUid: () => 1000,
        configDir,
        pathExists: (targetPath) => targetPath === legacyUserDataDir,
        resolveManagedExecutable: () => ({ kind: "chrome", path: "/usr/bin/google-chrome" }),
      },
    );

    expect(noteFn).toHaveBeenCalledTimes(1);
    const note = requireFirstNoteText(noteFn);
    expect(note).toContain("Legacy managed browser profile residue");
    expect(note).toContain(path.join(configDir, "browser", "clawd"));
    expect(note).toContain(path.join(configDir, "browser", "openclaw", "user-data"));
    expect(note).toContain("openclaw doctor --fix");
  });

  it("does not warn when clawd is still configured as a browser profile", async () => {
    const noteFn = vi.fn();

    await noteChromeMcpBrowserReadiness(
      {
        browser: {
          extensionRelay: { allowLegacyAuth: false },
          profiles: {
            clawd: { color: "#FF4500" },
            openclaw: { color: "#00AA00" },
          },
        },
      },
      {
        noteFn,
        platform: "linux",
        env: { DISPLAY: ":99" },
        getUid: () => 1000,
        configDir: "/tmp/openclaw-home",
        pathExists: () => true,
        resolveManagedExecutable: () => ({ kind: "chrome", path: "/usr/bin/google-chrome" }),
      },
    );

    expect(noteFn).not.toHaveBeenCalled();
  });

  it("warns when Chrome MCP is configured but Chrome is missing", async () => {
    const noteFn = vi.fn();
    await noteChromeMcpBrowserReadiness(
      {
        browser: {
          extensionRelay: { allowLegacyAuth: false },
          defaultProfile: "user",
        },
      },
      {
        noteFn,
        platform: "darwin",
        homeDir: "/__openclaw_browser_doctor_missing_home__",
        resolveChromeExecutable: () => null,
      },
    );

    const chromeNote = requireNoteTextContaining(noteFn, "Google Chrome was not found");
    expect(chromeNote).toContain("brave://inspect/#remote-debugging");
    const importNote = requireNoteTextContaining(noteFn, "System browser profile cookie import");
    expect(importNote).toContain("enabled");
    expect(importNote).toContain("Importable Chrome-family profile cookie databases found: 0");
  });

  it("warns when detected Chrome is too old for Chrome MCP", async () => {
    const noteFn = vi.fn();
    await noteChromeMcpBrowserReadiness(
      {
        browser: {
          extensionRelay: { allowLegacyAuth: false },
          profiles: {
            chromeLive: {
              driver: "existing-session",
              color: "#00AA00",
            },
          },
        },
      },
      {
        noteFn,
        platform: "linux",
        resolveChromeExecutable: () => ({ path: "/usr/bin/google-chrome" }),
        readVersion: () => "Google Chrome 143.0.7499.4",
      },
    );

    expect(noteFn).toHaveBeenCalledTimes(1);
    const note = requireFirstNoteText(noteFn);
    expect(note).toContain("too old");
    expect(note).toContain("Chrome 144+");
  });

  it("reports the detected Chrome version for existing-session profiles", async () => {
    const noteFn = vi.fn();
    await noteChromeMcpBrowserReadiness(
      {
        browser: {
          extensionRelay: { allowLegacyAuth: false },
          profiles: {
            chromeLive: {
              driver: "existing-session",
              color: "#00AA00",
            },
          },
        },
      },
      {
        noteFn,
        platform: "win32",
        resolveChromeExecutable: () => ({
          path: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
        }),
        readVersion: () => "Google Chrome 144.0.7534.0",
      },
    );

    expect(noteFn).toHaveBeenCalledTimes(1);
    expect(requireFirstNoteText(noteFn)).toContain("Detected Chrome Google Chrome 144.0.7534.0");
  });

  it("skips Chrome auto-detection when profiles use explicit userDataDir", async () => {
    const noteFn = vi.fn();
    await noteChromeMcpBrowserReadiness(
      {
        browser: {
          extensionRelay: { allowLegacyAuth: false },
          profiles: {
            braveLive: {
              driver: "existing-session",
              userDataDir: "/Users/test/Library/Application Support/BraveSoftware/Brave-Browser",
              color: "#FB542B",
            },
          },
        },
      },
      {
        noteFn,
        resolveChromeExecutable: () => {
          throw new Error("should not look up Chrome");
        },
      },
    );

    expect(noteFn).toHaveBeenCalled();
    const note = requireNoteTextContaining(noteFn, "explicit Chromium user data directory");
    expect(note).toContain("brave://inspect/#remote-debugging");
  });

  it("explains the interactive and manual boundaries for extension profile launch", async () => {
    const noteFn = vi.fn();
    await noteChromeMcpBrowserReadiness(
      {
        browser: {
          extensionRelay: { allowLegacyAuth: false },
          profiles: {
            personal: {
              driver: "extension",
              userDataDir: "C:\\Users\\operator\\Chrome Data",
              profileDirectory: "Profile 3",
            },
          },
        },
      },
      {
        noteFn,
        platform: "win32",
        configDir: "C:\\missing-openclaw-test-state",
        resolveManagedExecutable: () => {
          throw new Error("extension profiles are not managed profiles");
        },
      },
    );

    const message = requireNoteTextContaining(noteFn, "Extension profile launch is configured");
    expect(message).toContain("current interactive desktop session");
    expect(message).toContain("does not copy, stop, restart, or repair");
    expect(message).toContain("On Windows, extension installation and pairing remain manual");
  });
});

describe("browser plugin package layout", () => {
  it("passes the canonical bundled extension and plugin root to repair", async () => {
    const packageRoot = fs.realpathSync(tempDirs.make("openclaw-browser-doctor-"));
    fs.writeFileSync(path.join(packageRoot, "package.json"), "{}");

    const repairOwnedChromeExtensionNativeHosts = vi.fn(async () => ({
      changes: [],
      warnings: [],
    }));
    vi.resetModules();
    vi.doMock("./browser/extension-install.js", () => ({
      BUNDLED_CHROME_EXTENSION_DIR: path.join(packageRoot, "chrome-extension"),
      browserExtensionStatus: vi.fn(),
      FOUNDATION_CHROME_WEB_STORE_URL: "https://example.invalid",
      repairOwnedChromeExtensionNativeHosts,
    }));

    try {
      const { maybeRepairOwnedChromeExtensionNativeHosts } = await import("./doctor-browser.js");
      await maybeRepairOwnedChromeExtensionNativeHosts();
      expect(repairOwnedChromeExtensionNativeHosts).toHaveBeenCalledWith({
        bundledDir: path.join(packageRoot, "chrome-extension"),
        pluginRoot: packageRoot,
      });
    } finally {
      vi.doUnmock("./browser/extension-install.js");
      vi.resetModules();
    }
  });
});

describe("legacy clawd browser profile cleanup", () => {
  it("archives stale clawd residue with the safe trash mover", async () => {
    const movePathToTrash = vi.fn(async () => "/tmp/openclaw-home/browser/.trash/clawd");
    const configDir = "/tmp/openclaw-home";
    const legacyProfileDir = path.join(configDir, "browser", "clawd");
    const legacyUserDataDir = path.join(legacyProfileDir, "user-data");

    const result = await maybeArchiveLegacyClawdBrowserProfileResidue(
      {
        browser: {
          profiles: {
            openclaw: { color: "#FF4500" },
          },
        },
      },
      {
        configDir,
        pathExists: (targetPath) => targetPath === legacyUserDataDir,
        movePathToTrash,
      },
    );

    expect(movePathToTrash).toHaveBeenCalledWith(legacyProfileDir);
    expect(result.warnings).toStrictEqual([]);
    expect(result.changes.join("\n")).toContain(
      "Archived legacy clawd managed browser profile residue.",
    );
    expect(result.changes.join("\n")).toContain(
      path.join(configDir, "browser", "openclaw", "user-data"),
    );
  });

  it("does not archive a configured clawd browser profile", async () => {
    const movePathToTrash = vi.fn(async () => "/tmp/unused");

    const result = await maybeArchiveLegacyClawdBrowserProfileResidue(
      {
        browser: {
          defaultProfile: "clawd",
          profiles: {
            clawd: { color: "#FF4500" },
          },
        },
      },
      {
        configDir: "/tmp/openclaw-home",
        pathExists: () => true,
        movePathToTrash,
      },
    );

    expect(movePathToTrash).not.toHaveBeenCalled();
    expect(result).toStrictEqual({ changes: [], warnings: [] });
  });
});
