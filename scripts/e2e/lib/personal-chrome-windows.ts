import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import { fetchWithSsrFGuard } from "openclaw/plugin-sdk/ssrf-runtime";

const execFileAsync = promisify(execFile);
const NATIVE_HOST_NAME = "ai.openclaw.browser_bootstrap";
const NATIVE_HOST_REGISTRY_KEY = `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${NATIVE_HOST_NAME}`;
const EXTENSION_ID_PATTERN = /^[a-p]{32}$/u;
// Chromium persists --load-extension entries as ManifestLocation::kCommandLine.
// Requiring this value excludes bundled/component and UI-loaded extensions.
const CHROME_EXTENSION_COMMAND_LINE_LOCATION = 8;

const PINNED_CHROME_FOR_TESTING_VERSION = "152.0.7977.64";
const PINNED_CHROME_FOR_TESTING_URL =
  "https://storage.googleapis.com/chrome-for-testing-public/152.0.7977.64/win64/chrome-win64.zip";
// The pinned Windows executable is not Authenticode-signed and the CfT API
// publishes no SHA-256. Pin the audited archive bytes before extraction.
const PINNED_CHROME_FOR_TESTING_SHA256 =
  "b0db25dea445822429d8ebd36d53344cadcd63127308759456964029bbe18004";

export type WindowsChromeProcess = {
  pid: number;
  executablePath: string;
  commandLine: string;
};

type ChromeForTestingInstall = {
  executablePath: string;
  version: string;
  sha256: string;
};

type IsolationChromeLauncher = {
  executablePath: string;
  argumentsPath: string;
  securePreferencesRestorePath: string;
};

function comparablePath(value: string): string {
  return path.resolve(value).toLocaleLowerCase("en-US");
}

function isSameOrInside(candidate: string, parent: string): boolean {
  const relative = path.relative(comparablePath(parent), comparablePath(candidate));
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..");
}

export function buildChromeForTestingCommand(params: {
  executablePath: string;
  profileDir: string;
  extensionDir: string;
  initialUrl?: string;
}): string[] {
  return [
    params.executablePath,
    `--user-data-dir=${params.profileDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-sync",
    "--headless=new",
    "--window-size=1280,900",
    `--disable-extensions-except=${params.extensionDir}`,
    `--load-extension=${params.extensionDir}`,
    params.initialUrl ?? "about:blank",
  ];
}

export function assertNoForeignChromeProcesses(params: {
  processes: readonly WindowsChromeProcess[];
  profileDir: string;
}): void {
  const profile = comparablePath(params.profileDir);
  const foreign = params.processes.filter(
    (entry) => !entry.commandLine.toLocaleLowerCase("en-US").includes(profile),
  );
  if (foreign.length > 0) {
    throw new Error(
      `native disposable-Chrome lane requires every existing chrome.exe process to be closed; found ${foreign.length} foreign process(es)`,
    );
  }
}

function parsePowerShellJson<T>(stdout: string): T[] {
  if (!stdout.trim()) {
    return [];
  }
  const parsed: unknown = JSON.parse(stdout);
  return (Array.isArray(parsed) ? parsed : [parsed]) as T[];
}

export async function listWindowsChromeProcesses(): Promise<WindowsChromeProcess[]> {
  const script = [
    "$items = @(Get-CimInstance Win32_Process -Filter \"Name = 'chrome.exe'\" | ForEach-Object { [pscustomobject]@{ pid = [int]$_.ProcessId; executablePath = [string]$_.ExecutablePath; commandLine = [string]$_.CommandLine } })",
    "$items | ConvertTo-Json -Compress",
  ].join("; ");
  const { stdout } = await execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", script],
    { windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
  );
  return parsePowerShellJson<WindowsChromeProcess>(stdout).filter(
    (entry) =>
      Number.isInteger(entry.pid) &&
      typeof entry.executablePath === "string" &&
      typeof entry.commandLine === "string",
  );
}

async function downloadPinnedArchive(target: string): Promise<string> {
  const { response, release } = await fetchWithSsrFGuard({
    url: PINNED_CHROME_FOR_TESTING_URL,
    requireHttps: true,
    maxRedirects: 3,
    auditContext: "personal-chrome-windows.chrome-for-testing-download",
  });
  let completed = false;
  try {
    if (!response.ok || !response.body) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error(`Chrome for Testing download failed with HTTP ${response.status}`);
    }
    const hash = createHash("sha256");
    const hashStream = new Transform({
      transform(chunk, _encoding, callback) {
        hash.update(chunk);
        callback(null, chunk);
      },
    });
    await pipeline(
      Readable.fromWeb(response.body as import("node:stream/web").ReadableStream<Uint8Array>),
      hashStream,
      createWriteStream(target, { flags: "wx" }),
    );
    const sha256 = hash.digest("hex");
    if (sha256 !== PINNED_CHROME_FOR_TESTING_SHA256) {
      throw new Error(
        `Chrome for Testing archive checksum mismatch: expected ${PINNED_CHROME_FOR_TESTING_SHA256}, got ${sha256}`,
      );
    }
    completed = true;
    return sha256;
  } finally {
    await release();
    if (!completed) {
      await fs.rm(target, { force: true }).catch(() => undefined);
    }
  }
}

async function expandArchive(archivePath: string, destination: string): Promise<void> {
  const script =
    "Expand-Archive -LiteralPath $env:OPENCLAW_CFT_ARCHIVE -DestinationPath $env:OPENCLAW_CFT_DESTINATION -Force";
  await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    env: {
      ...process.env,
      OPENCLAW_CFT_ARCHIVE: archivePath,
      OPENCLAW_CFT_DESTINATION: destination,
    },
    windowsHide: true,
    maxBuffer: 4 * 1024 * 1024,
  });
}

async function inspectChromeVersion(executablePath: string): Promise<string> {
  const script = [
    "$file = Get-Item -LiteralPath $env:OPENCLAW_CFT_EXE",
    "[pscustomobject]@{ version = [string]$file.VersionInfo.FileVersion } | ConvertTo-Json -Compress",
  ].join("; ");
  const { stdout } = await execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", script],
    {
      env: { ...process.env, OPENCLAW_CFT_EXE: executablePath },
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    },
  );
  const [inspection] = parsePowerShellJson<{ version: string }>(stdout);
  if (!inspection) {
    throw new Error("Chrome for Testing version inspection returned no result");
  }
  return inspection.version;
}

export async function installPinnedChromeForTesting(
  destination: string,
): Promise<ChromeForTestingInstall> {
  await fs.mkdir(destination, { recursive: true });
  const archivePath = path.join(destination, `chrome-${PINNED_CHROME_FOR_TESTING_VERSION}.zip`);
  const sha256 = await downloadPinnedArchive(archivePath);
  await expandArchive(archivePath, destination);
  await fs.rm(archivePath, { force: true });

  const executablePath = await fs.realpath(path.join(destination, "chrome-win64", "chrome.exe"));
  if (!isSameOrInside(executablePath, destination)) {
    throw new Error("Chrome for Testing executable escaped the task-owned installation root");
  }
  const version = await inspectChromeVersion(executablePath);
  if (version !== PINNED_CHROME_FOR_TESTING_VERSION) {
    throw new Error(
      `Chrome for Testing version mismatch: expected ${PINNED_CHROME_FOR_TESTING_VERSION}, got ${version}`,
    );
  }
  return {
    executablePath,
    version,
    sha256,
  };
}

function chromeLauncherSource(): string {
  return `using System;
using System.Diagnostics;
using System.IO;
using System.Linq;

internal static class OpenClawIsolationChromeLauncher
{
    private static string Quote(string value)
    {
        if (value.IndexOf((char)34) >= 0) throw new InvalidDataException();
        return new string((char)34, 1) + value + new string((char)34, 1);
    }

    public static int Main(string[] args)
    {
        if (args.Length != 2 ||
            !args[0].StartsWith("--user-data-dir=", StringComparison.Ordinal) ||
            !args[1].StartsWith("--profile-directory=", StringComparison.Ordinal))
            return 2;

        string chrome = Environment.GetEnvironmentVariable("OPENCLAW_ISOLATION_CHROME_EXE");
        string extension = Environment.GetEnvironmentVariable("OPENCLAW_ISOLATION_EXTENSION_DIR");
        string argumentsPath = Environment.GetEnvironmentVariable("OPENCLAW_ISOLATION_LAUNCH_ARGS");
        string taskRoot = Environment.GetEnvironmentVariable("OPENCLAW_ISOLATION_ROOT");
        string restorePath = Environment.GetEnvironmentVariable("OPENCLAW_ISOLATION_SECURE_PREFERENCES_RESTORE");
        if (String.IsNullOrWhiteSpace(chrome) || String.IsNullOrWhiteSpace(extension) ||
            String.IsNullOrWhiteSpace(argumentsPath) || String.IsNullOrWhiteSpace(taskRoot) ||
            String.IsNullOrWhiteSpace(restorePath))
            return 3;

        File.WriteAllLines(argumentsPath, args, new System.Text.UTF8Encoding(false));
        string prefix = Path.GetFullPath(taskRoot).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
        string restore = Path.GetFullPath(restorePath);
        string userDataDir = Path.GetFullPath(args[0].Substring("--user-data-dir=".Length));
        string profileDirectory = args[1].Substring("--profile-directory=".Length);
        string preferences = Path.GetFullPath(Path.Combine(userDataDir, profileDirectory, "Secure Preferences"));
        if (!restore.StartsWith(prefix, StringComparison.OrdinalIgnoreCase) ||
            !preferences.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
            return 4;
        File.Copy(restore, preferences, true);
        string[] chromeArgs = args.Concat(new[] {
            "--no-first-run",
            "--no-default-browser-check",
            "--disable-background-networking",
            "--disable-component-update",
            "--disable-sync",
            "--headless=new",
            "--window-size=1280,900",
            "--disable-extensions-except=" + extension,
            "--load-extension=" + extension,
            "about:blank"
        }).ToArray();
        ProcessStartInfo start = new ProcessStartInfo {
            FileName = chrome,
            Arguments = String.Join(" ", chromeArgs.Select(Quote)),
            UseShellExecute = false,
            CreateNoWindow = true
        };
        Process.Start(start);
        return 0;
    }
}
`;
}

export async function compileIsolationChromeLauncher(
  taskRoot: string,
): Promise<IsolationChromeLauncher> {
  const directory = path.join(taskRoot, "chrome-launcher");
  const sourcePath = path.join(directory, "OpenClawIsolationChromeLauncher.cs");
  const executablePath = path.join(directory, "openclaw-isolation-chrome.exe");
  const argumentsPath = path.join(directory, "arguments.txt");
  const securePreferencesRestorePath = path.join(directory, "Secure Preferences.restore");
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(sourcePath, chromeLauncherSource(), { encoding: "utf8", flag: "wx" });
  const script =
    "Add-Type -Path $env:OPENCLAW_CHROME_LAUNCHER_SOURCE -OutputAssembly $env:OPENCLAW_CHROME_LAUNCHER_EXE -OutputType ConsoleApplication";
  await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    env: {
      ...process.env,
      OPENCLAW_CHROME_LAUNCHER_SOURCE: sourcePath,
      OPENCLAW_CHROME_LAUNCHER_EXE: executablePath,
    },
    windowsHide: true,
    maxBuffer: 4 * 1024 * 1024,
  });
  return { executablePath, argumentsPath, securePreferencesRestorePath };
}

function nativeHostSource(expectedOrigin: string): string {
  if (!/^chrome-extension:\/\/[a-p]{32}\/$/u.test(expectedOrigin)) {
    throw new Error("invalid native host extension origin");
  }
  return `using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using System.Text.RegularExpressions;
using System.Web.Script.Serialization;

internal static class OpenClawIsolationNativeHost
{
    private const string ExpectedOrigin = "${expectedOrigin}";
    private const int MaxFrameBytes = 4 * 1024;

    private static byte[] ReadExact(Stream input, int count)
    {
        byte[] buffer = new byte[count];
        int offset = 0;
        while (offset < count)
        {
            int read = input.Read(buffer, offset, count - offset);
            if (read <= 0) throw new EndOfStreamException();
            offset += read;
        }
        return buffer;
    }

    private static void WriteResponse(Dictionary<string, object> response)
    {
        JavaScriptSerializer serializer = new JavaScriptSerializer();
        byte[] payload = new UTF8Encoding(false).GetBytes(serializer.Serialize(response));
        byte[] length = BitConverter.GetBytes(payload.Length);
        Stream output = Console.OpenStandardOutput();
        output.Write(length, 0, length.Length);
        output.Write(payload, 0, payload.Length);
        output.Flush();
    }

    private static Dictionary<string, object> Failure(string code)
    {
        return new Dictionary<string, object> { { "v", 1 }, { "ok", false }, { "code", code } };
    }

    public static void Main(string[] args)
    {
        try
        {
            string callerOrigin = null;
            foreach (string argument in args)
            {
                if (argument.StartsWith("chrome-extension://", StringComparison.Ordinal))
                {
                    if (callerOrigin != null) throw new InvalidDataException();
                    callerOrigin = argument;
                }
            }
            if (!String.Equals(callerOrigin, ExpectedOrigin, StringComparison.Ordinal))
            {
                WriteResponse(Failure("origin_forbidden"));
                return;
            }

            Stream input = Console.OpenStandardInput();
            int length = BitConverter.ToInt32(ReadExact(input, 4), 0);
            if (length <= 0 || length > MaxFrameBytes) throw new InvalidDataException();
            string json = new UTF8Encoding(false, true).GetString(ReadExact(input, length));
            JavaScriptSerializer serializer = new JavaScriptSerializer();
            Dictionary<string, object> request = serializer.DeserializeObject(json) as Dictionary<string, object>;
            if (request == null || request.Count != 3 || Convert.ToInt32(request["v"]) != 1 ||
                !String.Equals(Convert.ToString(request["op"]), "bootstrap", StringComparison.Ordinal))
                throw new InvalidDataException();
            string nonce = Convert.ToString(request["nonce"]);
            if (!Regex.IsMatch(nonce, "^[A-Za-z0-9_-]{22}$")) throw new InvalidDataException();

            string taskRoot = Path.GetFullPath(Environment.GetEnvironmentVariable("OPENCLAW_ISOLATION_ROOT"));
            string pairingPath = Path.GetFullPath(Environment.GetEnvironmentVariable("OPENCLAW_ISOLATION_PAIRING_FILE"));
            string prefix = taskRoot.TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
            if (!pairingPath.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
                throw new InvalidDataException();
            string pairing = File.ReadAllText(pairingPath, new UTF8Encoding(false, true)).Trim();
            if (pairing.Length == 0 || pairing.Length > MaxFrameBytes) throw new InvalidDataException();
            WriteResponse(new Dictionary<string, object> {
                { "v", 1 }, { "ok", true }, { "nonce", nonce }, { "pairingString", pairing }
            });
        }
        catch
        {
            WriteResponse(Failure("invalid_request"));
        }
    }
}
`;
}

export async function compileIsolationNativeHost(params: {
  taskRoot: string;
  extensionId: string;
}): Promise<{ executablePath: string; manifestPath: string; expectedOrigin: string }> {
  if (!EXTENSION_ID_PATTERN.test(params.extensionId)) {
    throw new Error("invalid Chrome extension ID for native host");
  }
  const expectedOrigin = `chrome-extension://${params.extensionId}/`;
  const sourcePath = path.join(params.taskRoot, "native-host", "OpenClawIsolationNativeHost.cs");
  const executablePath = path.join(params.taskRoot, "native-host", "openclaw-isolation-host.exe");
  const manifestPath = path.join(params.taskRoot, "native-host", `${NATIVE_HOST_NAME}.json`);
  await fs.mkdir(path.dirname(sourcePath), { recursive: true });
  await fs.writeFile(sourcePath, nativeHostSource(expectedOrigin), {
    encoding: "utf8",
    flag: "wx",
  });

  const script =
    "Add-Type -Path $env:OPENCLAW_NATIVE_SOURCE -ReferencedAssemblies System.Web.Extensions -OutputAssembly $env:OPENCLAW_NATIVE_EXE -OutputType ConsoleApplication";
  await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    env: {
      ...process.env,
      OPENCLAW_NATIVE_SOURCE: sourcePath,
      OPENCLAW_NATIVE_EXE: executablePath,
    },
    windowsHide: true,
    maxBuffer: 4 * 1024 * 1024,
  });
  await fs.writeFile(
    manifestPath,
    `${JSON.stringify(
      {
        name: NATIVE_HOST_NAME,
        description: "OpenClaw disposable Chrome isolation bootstrap",
        path: executablePath,
        type: "stdio",
        allowed_origins: [expectedOrigin],
      },
      null,
      2,
    )}\n`,
    { encoding: "utf8", flag: "wx" },
  );
  return { executablePath, manifestPath, expectedOrigin };
}

async function registryManifestPath(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("reg.exe", ["query", NATIVE_HOST_REGISTRY_KEY, "/ve"], {
      windowsHide: true,
    });
    const match = /REG_SZ\s+(.+)$/imu.exec(stdout);
    return match?.[1]?.trim() ?? "";
  } catch (error) {
    if ((error as { code?: number }).code === 1) {
      return null;
    }
    throw error;
  }
}

function nativeHostRunCleanupError(runError: unknown, cleanupError: unknown): AggregateError {
  return new AggregateError(
    [runError, cleanupError],
    "native messaging host run and cleanup both failed",
    { cause: cleanupError },
  );
}

export async function withIsolationNativeHostRegistration<T>(
  manifestPath: string,
  run: () => Promise<T>,
): Promise<T> {
  const existing = await registryManifestPath();
  if (existing !== null) {
    throw new Error(`refusing to overwrite existing native messaging host registration`);
  }
  await execFileAsync(
    "reg.exe",
    ["add", NATIVE_HOST_REGISTRY_KEY, "/ve", "/t", "REG_SZ", "/d", manifestPath, "/f"],
    { windowsHide: true },
  );
  let primaryError: Error | undefined;
  let result: T | undefined;
  try {
    if (comparablePath((await registryManifestPath()) ?? "") !== comparablePath(manifestPath)) {
      throw new Error("native messaging host registration did not round-trip exactly");
    }
    result = await run();
  } catch (error) {
    primaryError = error instanceof Error ? error : new Error(String(error));
  }
  try {
    const current = await registryManifestPath();
    if (current !== null && comparablePath(current) !== comparablePath(manifestPath)) {
      throw new Error("native messaging host registration changed during the isolation run");
    }
    if (current !== null) {
      await execFileAsync("reg.exe", ["delete", NATIVE_HOST_REGISTRY_KEY, "/f"], {
        windowsHide: true,
      });
    }
    if ((await registryManifestPath()) !== null) {
      throw new Error("native messaging host registration remained after cleanup");
    }
  } catch (error) {
    const cleanupError = error instanceof Error ? error : new Error(String(error));
    if (primaryError) {
      throw nativeHostRunCleanupError(primaryError, cleanupError);
    }
    throw cleanupError;
  }
  if (primaryError) {
    throw primaryError;
  }
  return result as T;
}

export async function waitForCandidateExtensionPreference(params: {
  profileDir: string;
  extensionId: string;
  extensionDir: string;
  timeoutMs?: number;
}): Promise<void> {
  const deadline = Date.now() + (params.timeoutMs ?? 30_000);
  const preferencePath = path.join(params.profileDir, "Default", "Secure Preferences");
  while (Date.now() < deadline) {
    try {
      const parsed: unknown = JSON.parse(await fs.readFile(preferencePath, "utf8"));
      const settings = (parsed as { extensions?: { settings?: Record<string, unknown> } })
        ?.extensions?.settings;
      if (settings) {
        const commandLineExtensions = Object.entries(settings).filter(([, raw]) => {
          const entry = raw as { location?: unknown };
          return entry?.location === CHROME_EXTENSION_COMMAND_LINE_LOCATION;
        });
        const [candidate] = commandLineExtensions;
        const entry = candidate?.[1] as { path?: unknown } | undefined;
        if (
          commandLineExtensions.length === 1 &&
          candidate?.[0] === params.extensionId &&
          typeof entry?.path === "string" &&
          comparablePath(entry.path) === comparablePath(params.extensionDir)
        ) {
          return;
        }
        if (commandLineExtensions.length > 0) {
          throw new Error(
            "disposable Chrome loaded a command-line extension other than the candidate",
          );
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 100);
    });
  }
  throw new Error("candidate extension did not appear in the disposable Chrome profile");
}

export async function markCandidateExtensionAsManuallyInstalled(params: {
  profileDir: string;
  extensionId: string;
  extensionDir: string;
  restorePath: string;
}): Promise<void> {
  const preferencePath = path.join(params.profileDir, "Default", "Secure Preferences");
  const original = await fs.readFile(preferencePath);
  const parsed: unknown = JSON.parse(original.toString("utf8"));
  const settings = (parsed as { extensions?: { settings?: Record<string, unknown> } })?.extensions
    ?.settings;
  const entry = settings?.[params.extensionId] as
    | { location?: unknown; path?: unknown }
    | undefined;
  if (
    entry?.location !== CHROME_EXTENSION_COMMAND_LINE_LOCATION ||
    typeof entry.path !== "string" ||
    comparablePath(entry.path) !== comparablePath(params.extensionDir)
  ) {
    throw new Error("candidate extension preference changed before cold-launch setup");
  }

  // Headless Chrome can bootstrap an unpacked MV3 extension only from the command line.
  // The product cold-launch boundary accepts only the manual-install record that this
  // disposable profile represents; command-line-only extensions remain rejected.
  await fs.writeFile(params.restorePath, original, { flag: "wx" });
  entry.location = 4;
  await fs.writeFile(preferencePath, JSON.stringify(parsed), "utf8");
}
