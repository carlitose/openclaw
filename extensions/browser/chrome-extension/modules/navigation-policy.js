const MAX_POLICY_PATTERNS_PER_LIST = 128;
const MAX_COMPILED_POLICY_BYTES = 16 * 1024;
const encoder = new TextEncoder();

function exactOwnKeys(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function canonicalizeHostname(raw) {
  if (typeof raw !== "string") {
    return null;
  }
  const value = raw.trim().replace(/\.+$/u, "");
  if (!value || /[\s/@?#]/u.test(value)) {
    return null;
  }
  const bracketedIpv6 = value.startsWith("[") && value.endsWith("]");
  const unbracketedIpv6 = !value.startsWith("[") && (value.match(/:/gu)?.length ?? 0) > 1;
  if (value.includes(":") && !bracketedIpv6 && !unbracketedIpv6) {
    return null;
  }
  try {
    const parsed = new URL(`https://${unbracketedIpv6 ? `[${value}]` : value}/`);
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

function compilePattern(raw, path) {
  const value = typeof raw === "string" ? raw.trim() : "";
  const wildcard = value.startsWith("*.");
  if ((value.includes("*") && !wildcard) || value === "*." || value === "*") {
    throw new Error(`${path} must contain a hostname only; use example.com or *.example.com`);
  }
  const hostname = canonicalizeHostname(wildcard ? value.slice(2) : value);
  if (!hostname || (wildcard && hostname.includes(":"))) {
    throw new Error(`${path} must contain a hostname only; use example.com or *.example.com`);
  }
  return { kind: wildcard ? "subdomains" : "exact", hostname };
}

function compileList(values, path) {
  if (values !== undefined && !Array.isArray(values)) {
    throw new Error(`${path} must be an array of hostname patterns`);
  }
  if ((values?.length ?? 0) > MAX_POLICY_PATTERNS_PER_LIST) {
    throw new Error(`${path} supports at most ${MAX_POLICY_PATTERNS_PER_LIST} hostname patterns`);
  }
  const unique = new Map();
  for (const [index, value] of (values ?? []).entries()) {
    const pattern = compilePattern(value, `${path}[${index}]`);
    unique.set(`${pattern.kind}:${pattern.hostname}`, pattern);
  }
  return [...unique.values()].toSorted((left, right) =>
    `${left.kind}:${left.hostname}`.localeCompare(`${right.kind}:${right.hostname}`),
  );
}

/** Compile raw profile config into the deterministic connection-bound wire value. */
export function compileNavigationPolicy(input = {}, path = "navigationPolicy") {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error(`${path} must be an object`);
  }
  const policy = {
    version: 1,
    allow: compileList(input.allowHostnames, `${path}.allowHostnames`),
    deny: compileList(input.denyHostnames, `${path}.denyHostnames`),
  };
  if (encoder.encode(JSON.stringify(policy)).byteLength > MAX_COMPILED_POLICY_BYTES) {
    throw new Error(`${path} exceeds the ${MAX_COMPILED_POLICY_BYTES}-byte compiled policy limit`);
  }
  return policy;
}

function validCompiledPattern(value) {
  if (!exactOwnKeys(value, ["kind", "hostname"])) {
    return false;
  }
  if (value.kind !== "exact" && value.kind !== "subdomains") {
    return false;
  }
  const canonical = canonicalizeHostname(value.hostname);
  return (
    canonical === value.hostname && !(value.kind === "subdomains" && value.hostname.includes(":"))
  );
}

/** Validate an untrusted policy installation frame without normalizing it. */
export function parseCompiledNavigationPolicy(value) {
  if (!exactOwnKeys(value, ["version", "allow", "deny"]) || value.version !== 1) {
    return null;
  }
  if (
    !Array.isArray(value.allow) ||
    !Array.isArray(value.deny) ||
    value.allow.length > MAX_POLICY_PATTERNS_PER_LIST ||
    value.deny.length > MAX_POLICY_PATTERNS_PER_LIST ||
    !value.allow.every(validCompiledPattern) ||
    !value.deny.every(validCompiledPattern) ||
    encoder.encode(JSON.stringify(value)).byteLength > MAX_COMPILED_POLICY_BYTES
  ) {
    return null;
  }
  const normalized = compileNavigationPolicy({
    allowHostnames: value.allow.map((entry) =>
      entry.kind === "subdomains" ? `*.${entry.hostname}` : entry.hostname,
    ),
    denyHostnames: value.deny.map((entry) =>
      entry.kind === "subdomains" ? `*.${entry.hostname}` : entry.hostname,
    ),
  });
  return JSON.stringify(normalized) === JSON.stringify(value) ? value : null;
}

export function navigationPolicyIsEmpty(policy) {
  return policy.allow.length === 0 && policy.deny.length === 0;
}

function matches(hostname, pattern) {
  return pattern.kind === "exact"
    ? hostname === pattern.hostname
    : hostname !== pattern.hostname && hostname.endsWith(`.${pattern.hostname}`);
}

/** Classify one browser URL. Bootstrap state is hidden until a meaningful URL arrives. */
export function classifyNavigationUrl(rawUrl, policy) {
  if (typeof rawUrl !== "string" || rawUrl.trim() === "") {
    return { status: "pending", reason: "missing-url" };
  }
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { status: "denied", reason: "malformed-url" };
  }
  if (parsed.href === "about:blank") {
    return { status: "pending", reason: "bootstrap-url" };
  }
  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    parsed.username ||
    parsed.password
  ) {
    return { status: "denied", reason: "unsupported-url" };
  }
  const hostname = canonicalizeHostname(parsed.hostname);
  if (!hostname) {
    return { status: "denied", reason: "malformed-url" };
  }
  const denied = policy.deny.some((pattern) => matches(hostname, pattern));
  const allowed =
    policy.allow.length === 0 || policy.allow.some((pattern) => matches(hostname, pattern));
  return denied || !allowed
    ? { status: "denied", reason: "hostname-policy", hostname }
    : { status: "allowed", hostname };
}
