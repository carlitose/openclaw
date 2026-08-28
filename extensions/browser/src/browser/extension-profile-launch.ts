/** Launch an explicitly selected personal Chrome profile for the extension relay. */
import { spawn } from "node:child_process";
import path from "node:path";
import {
  resolveBrowserExecutableForPlatform,
  type BrowserExecutable,
} from "./chrome.executables.js";
import type { ResolvedBrowserConfig, ResolvedBrowserProfile } from "./config.js";
import {
  BROWSER_ERROR_REASONS,
  BrowserProfileUnavailableError,
  type BrowserExtensionProfileErrorMetadata,
} from "./errors.js";
import { discoverChromeExtensionIds } from "./extension-install-layout.js";
import {
  BUNDLED_CHROME_EXTENSION_DIR,
  FOUNDATION_CHROME_WEB_STORE_EXTENSION_ID,
  resolveChromeExtensionInspectionPaths,
} from "./extension-install.js";
import { waitForProfileOperation } from "./server-context.lifecycle.js";
import type { ProfileRuntimeState } from "./server-context.types.js";

type ExtensionInstallationState = "installed" | "missing" | "ambiguous";

type ExtensionProfileLaunchDeps = {
  platform?: NodeJS.Platform;
  inspectInstallation?: (params: {
    userDataDir: string;
    profileDirectory: string;
    platform: NodeJS.Platform;
  }) => Promise<ExtensionInstallationState>;
  resolveExecutable?: typeof resolveBrowserExecutableForPlatform;
  spawnBrowser?: (params: { executablePath: string; args: string[] }) => Promise<void>;
};

type ExtensionProfileLaunchParams = {
  resolved: ResolvedBrowserConfig;
  profile: ResolvedBrowserProfile;
  runtime: ProfileRuntimeState;
  signal?: AbortSignal;
  deps?: ExtensionProfileLaunchDeps;
};

type PendingExtensionProfileLaunch = {
  key: string;
  promise: Promise<void>;
};

const pendingLaunches = new WeakMap<ProfileRuntimeState, PendingExtensionProfileLaunch>();
function unavailable(
  profile: string,
  reason: BrowserExtensionProfileErrorMetadata["reason"],
  message: string,
  cause?: unknown,
): BrowserProfileUnavailableError {
  return new BrowserProfileUnavailableError(message, {
    ...(cause === undefined ? {} : { cause }),
    metadata: { reason, details: { profile } },
  });
}

function resolveLaunchSelection(
  profile: ResolvedBrowserProfile,
  platform: NodeJS.Platform,
): {
  userDataDir: string;
  profileDirectory: string;
} {
  const userDataDir = profile.userDataDir?.trim();
  const profileDirectory = profile.profileDirectory?.trim();
  const pathApi = platform === "win32" ? path.win32 : path.posix;
  if (
    !userDataDir ||
    !profileDirectory ||
    profileDirectory === "." ||
    profileDirectory === ".." ||
    pathApi.basename(profileDirectory) !== profileDirectory
  ) {
    throw unavailable(
      profile.name,
      BROWSER_ERROR_REASONS.profileNotConfigured,
      `Extension profile "${profile.name}" cannot open Chrome because its exact userDataDir and profileDirectory are not configured. Configure both fields, or open and pair Chrome manually.`,
    );
  }
  return { userDataDir, profileDirectory };
}

async function inspectInstallation({
  userDataDir,
  profileDirectory,
  platform,
}: {
  userDataDir: string;
  profileDirectory: string;
  platform: NodeJS.Platform;
}): Promise<ExtensionInstallationState> {
  const { approvedPaths } = await resolveChromeExtensionInspectionPaths(
    BUNDLED_CHROME_EXTENSION_DIR,
    { platform },
  );
  const discovery = await discoverChromeExtensionIds({
    approvedDirs: approvedPaths,
    storeExtensionId: FOUNDATION_CHROME_WEB_STORE_EXTENSION_ID,
    roots: [
      {
        product: "chrome",
        label: "Configured Chrome",
        userDataDir,
        // Discovery does not inspect native-host registration; the exact
        // profile's Secure Preferences is the authoritative install record.
        nativeManifestDir: path.join(userDataDir, "NativeMessagingHosts"),
      },
    ],
    deps: { platform },
  });
  const matches = [...discovery.discovered, ...discovery.storeDiscovered].filter(
    (entry) => entry.profile === profileDirectory,
  );
  return matches.length === 0 ? "missing" : matches.length === 1 ? "installed" : "ambiguous";
}

async function spawnBrowser(params: { executablePath: string; args: string[] }): Promise<void> {
  const child = spawn(params.executablePath, params.args, {
    detached: true,
    stdio: "ignore",
  });
  await new Promise<void>((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", reject);
  });
  // The personal Chrome process is operator-owned. OpenClaw only requests that
  // Chrome open it and never retains a process handle that could stop or restart it.
  child.unref();
}

async function launchOnce(
  params: ExtensionProfileLaunchParams,
  selection: { userDataDir: string; profileDirectory: string },
): Promise<void> {
  const platform = params.deps?.platform ?? process.platform;
  const inspect = params.deps?.inspectInstallation ?? inspectInstallation;
  let installation: ExtensionInstallationState;
  try {
    installation = await inspect({ ...selection, platform });
  } catch (cause) {
    throw unavailable(
      params.profile.name,
      BROWSER_ERROR_REASONS.extensionNotInstalled,
      `The OpenClaw extension installation could not be verified for Chrome profile "${params.profile.name}". Run browser extension status and fix that exact profile before retrying.`,
      cause,
    );
  }
  if (installation !== "installed") {
    const ambiguous = installation === "ambiguous";
    throw unavailable(
      params.profile.name,
      ambiguous
        ? BROWSER_ERROR_REASONS.profileAmbiguous
        : BROWSER_ERROR_REASONS.extensionNotInstalled,
      ambiguous
        ? `Extension profile "${params.profile.name}" matches more than one trusted OpenClaw extension. Keep exactly one Store or approved unpacked installation in that Chrome profile.`
        : `The OpenClaw extension is not installed in the configured Chrome profile "${params.profile.name}". Install it in that exact profile before retrying.`,
    );
  }

  let executable: BrowserExecutable | null;
  try {
    executable = (params.deps?.resolveExecutable ?? resolveBrowserExecutableForPlatform)(
      { ...params.resolved, executablePath: params.profile.executablePath },
      platform,
    );
  } catch (cause) {
    throw unavailable(
      params.profile.name,
      BROWSER_ERROR_REASONS.chromeLaunchFailed,
      `Chrome could not be opened for extension profile "${params.profile.name}". Verify its executablePath and run browser doctor.`,
      cause,
    );
  }
  if (!executable) {
    throw unavailable(
      params.profile.name,
      BROWSER_ERROR_REASONS.chromeLaunchFailed,
      `No Chromium-family executable was found for extension profile "${params.profile.name}". Install Chrome or configure executablePath.`,
    );
  }

  try {
    await (params.deps?.spawnBrowser ?? spawnBrowser)({
      executablePath: executable.path,
      args: [
        `--user-data-dir=${selection.userDataDir}`,
        `--profile-directory=${selection.profileDirectory}`,
      ],
    });
  } catch (cause) {
    throw unavailable(
      params.profile.name,
      BROWSER_ERROR_REASONS.chromeLaunchFailed,
      `Chrome could not be opened for extension profile "${params.profile.name}". Run browser doctor and verify the interactive desktop session.`,
      cause,
    );
  }
}

/** Coalesce one operator-owned Chrome launch while preserving caller-local cancellation. */
export async function ensureExtensionProfileLaunched(
  params: ExtensionProfileLaunchParams,
): Promise<void> {
  params.signal?.throwIfAborted();
  const platform = params.deps?.platform ?? process.platform;
  const selection = resolveLaunchSelection(params.profile, platform);
  const key = `${selection.userDataDir}\0${selection.profileDirectory}\0${params.profile.executablePath ?? ""}`;
  for (;;) {
    const pending = pendingLaunches.get(params.runtime);
    if (pending) {
      await waitForProfileOperation(pending.promise, params.signal);
      if (pending.key === key) {
        return;
      }
      continue;
    }

    // Launch is lifecycle-owned: aborting one waiter must not cancel a launch
    // that a concurrent browser operation still needs.
    const promise = launchOnce(params, selection);
    const owned = { key, promise };
    pendingLaunches.set(params.runtime, owned);
    const settle = () => {
      if (pendingLaunches.get(params.runtime) === owned) {
        pendingLaunches.delete(params.runtime);
      }
    };
    void promise.then(settle, settle);
    await waitForProfileOperation(promise, params.signal);
    return;
  }
}
