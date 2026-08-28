import fs from "node:fs/promises";
import path from "node:path";
import { withTempDir } from "openclaw/plugin-sdk/test-env";
import { describe, expect, it } from "vitest";
import { resolveBundledChromeExtensionDir } from "./extension-install-layout.js";

describe("browser plugin package layout", () => {
  it.each([
    [
      "source",
      path.join("extensions", "browser", "src", "browser", "extension-install.ts"),
      path.join("extensions", "browser"),
    ],
    [
      "unified dist chunk",
      path.join("dist", "extension-install-build-hash.js"),
      path.join("dist", "extensions", "browser"),
    ],
    ["package-local dist", path.join("dist", "browser", "extension-install.js"), "."],
  ])(
    "resolves the bundled extension from %s",
    async (_label, moduleRelativePath, pluginRootRelativePath) => {
      await withTempDir("openclaw-browser-plugin-layout-", async (root) => {
        const pluginRoot = path.resolve(root, pluginRootRelativePath);
        await fs.mkdir(pluginRoot, { recursive: true });
        await fs.writeFile(path.join(pluginRoot, "package.json"), "{}", "utf8");
        await fs.writeFile(path.join(pluginRoot, "openclaw.plugin.json"), "{}", "utf8");

        expect(resolveBundledChromeExtensionDir(path.join(root, moduleRelativePath))).toBe(
          path.join(pluginRoot, "chrome-extension"),
        );
      });
    },
  );
});
