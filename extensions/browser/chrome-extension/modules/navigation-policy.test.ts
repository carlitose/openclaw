import { describe, expect, it } from "vitest";
import {
  classifyNavigationUrl,
  compileNavigationPolicy,
  parseCompiledNavigationPolicy,
} from "./navigation-policy.js";

describe("profile navigation hostname policy", () => {
  const credentialUrl = new URL("https://login.example");
  credentialUrl.username = "fixture-user";
  credentialUrl.password = "fixture-password";
  const policy = compileNavigationPolicy({
    allowHostnames: ["login.example", "*.oauth.example", "BÜCHER.example"],
    denyHostnames: ["blocked.oauth.example", "*.deny.example"],
  });

  it.each([
    ["exact", "https://LOGIN.EXAMPLE:8443/start", "allowed"],
    ["wildcard descendant", "https://a.b.oauth.example/start", "allowed"],
    ["wildcard bare suffix", "https://oauth.example/start", "denied"],
    ["IDNA", "https://bücher.example/start", "allowed"],
    ["deny over wildcard allow", "https://blocked.oauth.example/start", "denied"],
    ["outside allowlist", "https://other.example/start", "denied"],
    ["creation bootstrap", "about:blank", "pending"],
    ["credential-bearing URL", credentialUrl.href, "denied"],
  ] as const)("classifies %s", (_name, url, expected) => {
    expect(classifyNavigationUrl(url, policy).status).toBe(expected);
  });

  it("rejects ports in patterns with a path-specific correction", () => {
    expect(() =>
      compileNavigationPolicy(
        { allowHostnames: ["login.example:8443"] },
        "browser.profiles.personal.navigationPolicy",
      ),
    ).toThrow(
      "browser.profiles.personal.navigationPolicy.allowHostnames[0] must contain a hostname only",
    );
  });

  it("normalizes, deduplicates, and validates the bounded wire representation", () => {
    const compiled = compileNavigationPolicy({
      allowHostnames: [" Login.Example. ", "login.example"],
      denyHostnames: ["*.DENY.example"],
    });
    expect(compiled).toEqual({
      version: 1,
      allow: [{ kind: "exact", hostname: "login.example" }],
      deny: [{ kind: "subdomains", hostname: "deny.example" }],
    });
    expect(parseCompiledNavigationPolicy(structuredClone(compiled))).toEqual(compiled);
    expect(parseCompiledNavigationPolicy({ ...compiled, version: 2 })).toBeNull();
  });
});
