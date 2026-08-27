import assert from "node:assert/strict";

// Question: can one normalized hostname policy keep creation-time children
// unexposed until a meaningful URL is allowed, then revoke before later events?
// Branch: logic prototype. Assumption: Chrome tab snapshots arrive in order per
// tab. Useful result: the state machine and matcher below satisfy the ticket 02
// scenario matrix; ticket 05 must replace this disposable model with runtime code.

type HostnamePattern = { kind: "exact" | "subdomains"; hostname: string };
type CompiledPolicy = {
  allow: readonly HostnamePattern[];
  deny: readonly HostnamePattern[];
};
type UrlDecision =
  | { kind: "pending"; reason: "missing-url" | "bootstrap-url" }
  | { kind: "allow"; hostname: string }
  | { kind: "deny"; reason: "malformed-url" | "unsupported-url" | "hostname-policy" };
type CandidateState = "pending" | "admitted" | "denied" | "revoked";

function canonicalizeExactHostname(raw: string): string | null {
  const value = raw.trim().replace(/\.+$/u, "");
  if (!value || /[\s/@?#]/u.test(value)) {
    return null;
  }

  const isBracketedIpv6 = value.startsWith("[") && value.endsWith("]");
  const isUnbracketedIpv6 = !value.startsWith("[") && (value.match(/:/gu)?.length ?? 0) > 1;
  if (value.includes(":") && !isBracketedIpv6 && !isUnbracketedIpv6) {
    return null;
  }

  try {
    const authority = isUnbracketedIpv6 ? `[${value}]` : value;
    const parsed = new URL(`https://${authority}/`);
    if (parsed.username || parsed.password || parsed.port || parsed.pathname !== "/") {
      return null;
    }
    return (
      parsed.hostname
        .toLowerCase()
        .replace(/^\[|\]$/gu, "")
        .replace(/\.+$/u, "") || null
    );
  } catch {
    return null;
  }
}

function compilePattern(raw: string): HostnamePattern {
  const value = raw.trim();
  const wildcard = value.startsWith("*.");
  if ((value.includes("*") && !wildcard) || value === "*." || value === "*") {
    throw new Error(`invalid hostname pattern: ${raw}`);
  }
  const hostname = canonicalizeExactHostname(wildcard ? value.slice(2) : value);
  if (!hostname || (wildcard && hostname.includes(":"))) {
    throw new Error(`invalid hostname pattern: ${raw}`);
  }
  return { kind: wildcard ? "subdomains" : "exact", hostname };
}

function compilePolicy(input: {
  allowHostnames?: readonly string[];
  denyHostnames?: readonly string[];
}): CompiledPolicy {
  const compile = (values: readonly string[] | undefined) => {
    const unique = new Map<string, HostnamePattern>();
    for (const value of values ?? []) {
      const pattern = compilePattern(value);
      unique.set(`${pattern.kind}:${pattern.hostname}`, pattern);
    }
    return [...unique.values()].toSorted((left, right) =>
      `${left.kind}:${left.hostname}`.localeCompare(`${right.kind}:${right.hostname}`),
    );
  };
  return { allow: compile(input.allowHostnames), deny: compile(input.denyHostnames) };
}

function matches(hostname: string, pattern: HostnamePattern): boolean {
  return pattern.kind === "exact"
    ? hostname === pattern.hostname
    : hostname.endsWith(`.${pattern.hostname}`);
}

function decideUrl(rawUrl: string | undefined, policy: CompiledPolicy): UrlDecision {
  if (rawUrl === undefined || rawUrl.trim() === "") {
    return { kind: "pending", reason: "missing-url" };
  }
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { kind: "deny", reason: "malformed-url" };
  }
  if (parsed.href === "about:blank") {
    return { kind: "pending", reason: "bootstrap-url" };
  }
  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    parsed.username !== "" ||
    parsed.password !== ""
  ) {
    return { kind: "deny", reason: "unsupported-url" };
  }
  const hostname = canonicalizeExactHostname(parsed.hostname);
  if (!hostname) {
    return { kind: "deny", reason: "malformed-url" };
  }
  const denied = policy.deny.some((pattern) => matches(hostname, pattern));
  const allowed =
    policy.allow.length === 0 || policy.allow.some((pattern) => matches(hostname, pattern));
  return denied || !allowed
    ? { kind: "deny", reason: "hostname-policy" }
    : { kind: "allow", hostname };
}

class CreationCandidate {
  state: CandidateState = "pending";
  published = false;
  controllable = false;
  readonly policy: CompiledPolicy;

  constructor(policy: CompiledPolicy) {
    this.policy = policy;
  }

  observe(rawUrl: string | undefined): UrlDecision {
    const decision = decideUrl(rawUrl, this.policy);
    if (this.state === "denied" || this.state === "revoked") {
      return decision;
    }
    if (decision.kind === "pending") {
      return decision;
    }
    if (decision.kind === "deny") {
      this.state = this.state === "admitted" ? "revoked" : "denied";
      this.published = false;
      this.controllable = false;
      return decision;
    }
    this.state = "admitted";
    this.published = true;
    this.controllable = true;
    return decision;
  }

  canForwardEvent(): boolean {
    return this.state === "admitted" && this.published && this.controllable;
  }
}

const policy = compilePolicy({
  allowHostnames: ["login.example", "*.oauth.example", "BÜCHER.example"],
  denyHostnames: ["blocked.oauth.example", "*.deny.example"],
});

const matcherCases = [
  ["exact", "https://LOGIN.EXAMPLE:8443/start", "allow"],
  ["wildcard subdomain", "https://a.b.oauth.example/start", "allow"],
  ["wildcard bare suffix", "https://oauth.example/start", "deny"],
  ["IDNA", "https://bücher.example/start", "allow"],
  ["deny over wildcard allow", "https://blocked.oauth.example/start", "deny"],
  ["outside allowlist", "https://other.example/start", "deny"],
] as const;
const scenarioFamilies = [
  ...matcherCases.map(([name]) => `matcher:${name}`),
  "pattern-port-rejection",
  "missing-child-url",
  "about-blank-to-allowed",
  "about-blank-to-denied",
  "allowed-redirect",
  "denied-redirect",
  "later-denied-grouped-child",
  "malformed-and-unsupported-urls",
];

for (const [name, url, expected] of matcherCases) {
  assert.equal(decideUrl(url, policy).kind, expected, name);
}
assert.throws(
  () => compilePolicy({ allowHostnames: ["login.example:8443"] }),
  /invalid hostname pattern/u,
  "ports belong to URLs, not hostname patterns",
);

const missingChild = new CreationCandidate(policy);
assert.equal(missingChild.observe(undefined).kind, "pending");
assert.equal(missingChild.published, false);

const oauthChild = new CreationCandidate(policy);
assert.equal(oauthChild.observe("about:blank").kind, "pending");
assert.equal(oauthChild.canForwardEvent(), false);
const aboutBlankChildPublishedBeforeMeaningfulUrl = oauthChild.published;
assert.equal(oauthChild.observe("https://login.example/consent").kind, "allow");
assert.equal(oauthChild.canForwardEvent(), true);

const deniedChild = new CreationCandidate(policy);
assert.equal(deniedChild.observe("about:blank").kind, "pending");
assert.equal(deniedChild.observe("https://blocked.oauth.example/callback").kind, "deny");
assert.equal(deniedChild.state, "denied");
assert.equal(deniedChild.canForwardEvent(), false);

const allowedRedirect = new CreationCandidate(policy);
assert.equal(allowedRedirect.observe("https://login.example/start").kind, "allow");
assert.equal(allowedRedirect.observe("https://step.oauth.example/callback").kind, "allow");
assert.equal(allowedRedirect.canForwardEvent(), true);

const deniedRedirect = new CreationCandidate(policy);
assert.equal(deniedRedirect.observe("https://login.example/start").kind, "allow");
assert.equal(deniedRedirect.observe("https://outside.example/final").kind, "deny");
assert.equal(deniedRedirect.state, "revoked");
assert.equal(deniedRedirect.canForwardEvent(), false);

const groupedChild = new CreationCandidate(policy);
groupedChild.observe("https://step.oauth.example/start");
assert.equal(groupedChild.canForwardEvent(), true);
groupedChild.observe("https://child.deny.example/final");
assert.equal(groupedChild.state, "revoked");
assert.equal(groupedChild.canForwardEvent(), false);

for (const invalid of ["not a URL", "data:text/html,hello", "file:///tmp/private"]) {
  const candidate = new CreationCandidate(policy);
  assert.equal(candidate.observe(invalid).kind, "deny");
  assert.equal(candidate.canForwardEvent(), false);
}

process.stdout.write(
  `${JSON.stringify({
    ok: true,
    claim: "domain-policy-creation-state-prototype",
    scenarioFamilies,
    aboutBlankChildPublishedBeforeMeaningfulUrl,
    deniedChildControllable: deniedChild.controllable,
    deniedRedirectForwardable: deniedRedirect.canForwardEvent(),
    laterDeniedChildForwardable: groupedChild.canForwardEvent(),
  })}\n`,
);
