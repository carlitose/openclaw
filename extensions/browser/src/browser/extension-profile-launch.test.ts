import { describe, expect, it, vi } from "vitest";
import { ensureExtensionProfileLaunched } from "./extension-profile-launch.js";
import { makeBrowserProfile, makeBrowserServerState } from "./server-context.test-harness.js";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("extension profile launch", () => {
  it("coalesces concurrent launches and passes only the selected Chrome profile", async () => {
    const profile = makeBrowserProfile({
      name: "personal",
      driver: "extension",
      attachOnly: true,
      userDataDir: "C:\\Users\\operator\\Chrome Data",
      profileDirectory: "Profile 3",
      executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      cdpUrl: "http://127.0.0.1:18799/ignored-by-extension-launch",
    });
    const state = makeBrowserServerState({
      profile,
      resolvedOverrides: { extraArgs: ["--test-only-ignored-argument=must-not-leak"] },
    });
    const runtime = { profile, running: null };
    const spawned = deferred();
    const spawnBrowser = vi.fn(async () => await spawned.promise);
    const deps = {
      platform: "win32" as const,
      inspectInstallation: vi.fn(async () => "installed" as const),
      resolveExecutable: vi.fn(() => ({ kind: "chrome" as const, path: profile.executablePath! })),
      spawnBrowser,
    };

    const first = ensureExtensionProfileLaunched({
      resolved: state.resolved,
      profile,
      runtime,
      deps,
    });
    const second = ensureExtensionProfileLaunched({
      resolved: state.resolved,
      profile,
      runtime,
      deps,
    });
    await vi.waitFor(() => expect(spawnBrowser).toHaveBeenCalledOnce());
    expect(spawnBrowser).toHaveBeenCalledWith({
      executablePath: profile.executablePath,
      args: ["--user-data-dir=C:\\Users\\operator\\Chrome Data", "--profile-directory=Profile 3"],
    });

    spawned.resolve();
    await expect(Promise.all([first, second])).resolves.toEqual([undefined, undefined]);
    expect(deps.inspectInstallation).toHaveBeenCalledOnce();
    expect(deps.resolveExecutable).toHaveBeenCalledOnce();
  });

  it.each([
    ["missing", "extension-not-installed"],
    ["ambiguous", "profile-ambiguous"],
  ] as const)("returns a typed, redacted %s diagnosis", async (installation, reason) => {
    const profile = makeBrowserProfile({
      name: "personal",
      driver: "extension",
      attachOnly: true,
      userDataDir: "C:\\Users\\operator\\Chrome Data",
      profileDirectory: "Default",
    });
    const state = makeBrowserServerState({ profile });
    const runtime = { profile, running: null };

    const error = await ensureExtensionProfileLaunched({
      resolved: state.resolved,
      profile,
      runtime,
      deps: {
        platform: "win32",
        inspectInstallation: async () => installation,
        resolveExecutable: () => ({ kind: "chrome", path: "C:\\Chrome\\chrome.exe" }),
        spawnBrowser: vi.fn(),
      },
    }).catch((cause: unknown) => cause);

    expect(error).toMatchObject({ metadata: { reason, details: { profile: "personal" } } });
    expect(JSON.stringify(error)).not.toContain("Chrome Data");
  });

  it("redacts installation inspection failures", async () => {
    const profile = makeBrowserProfile({
      name: "personal",
      driver: "extension",
      attachOnly: true,
      userDataDir: "C:\\Users\\operator\\Chrome Data",
      profileDirectory: "Default",
    });

    const error = await ensureExtensionProfileLaunched({
      resolved: makeBrowserServerState({ profile }).resolved,
      profile,
      runtime: { profile, running: null },
      deps: {
        platform: "win32",
        inspectInstallation: async () => {
          throw new Error(`access denied: ${profile.userDataDir}`);
        },
      },
    }).catch((cause: unknown) => cause);

    expect(error).toMatchObject({
      message: expect.not.stringContaining("Chrome Data"),
      metadata: {
        reason: "extension-not-installed",
        details: { profile: "personal" },
      },
    });
  });
});
