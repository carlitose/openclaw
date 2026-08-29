import { describe, expect, it } from "vitest";
import { OpenClawSchema } from "./zod-schema.js";

function extensionProfile(profile: Record<string, unknown>) {
  return OpenClawSchema.safeParse({
    browser: { profiles: { personal: { driver: "extension", ...profile } } },
  });
}

describe("browser extension launch profile schema", () => {
  it("accepts an exact user-data root and Chrome profile directory", () => {
    expect(
      extensionProfile({
        userDataDir: "C:\\Users\\operator\\AppData\\Local\\Google\\Chrome\\User Data",
        profileDirectory: "Profile 3",
      }).success,
    ).toBe(true);
  });

  it.each([
    [{ userDataDir: "C:\\Chrome Data" }, "partial launch selection"],
    [{ profileDirectory: "Default" }, "partial launch selection"],
    [
      { userDataDir: "C:\\Chrome Data", profileDirectory: "..\\Other" },
      "profile-directory traversal",
    ],
    [{ driver: "openclaw", cdpPort: 18800, profileDirectory: "Default" }, "non-extension driver"],
  ])("rejects %s (%s)", (profile, _label) => {
    expect(extensionProfile(profile).success).toBe(false);
  });

  it("accepts a bounded profile navigation policy", () => {
    expect(
      extensionProfile({
        navigationPolicy: {
          allowHostnames: ["example.com", "*.oauth.example.com"],
          denyHostnames: ["blocked.oauth.example.com"],
        },
      }).success,
    ).toBe(true);
  });

  it("rejects oversized profile navigation policy lists", () => {
    expect(
      extensionProfile({
        navigationPolicy: {
          allowHostnames: Array.from({ length: 129 }, (_, index) => `host-${index}.example`),
        },
      }).success,
    ).toBe(false);
  });
});
