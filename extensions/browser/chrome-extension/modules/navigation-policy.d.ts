export type NavigationHostnamePattern = {
  kind: "exact" | "subdomains";
  hostname: string;
};

export type CompiledNavigationPolicyV1 = {
  version: 1;
  allow: NavigationHostnamePattern[];
  deny: NavigationHostnamePattern[];
};

export type NavigationUrlDecision =
  | { status: "pending"; reason: "missing-url" | "bootstrap-url" }
  | {
      status: "denied";
      reason: "malformed-url" | "unsupported-url" | "hostname-policy";
      hostname?: string;
    }
  | { status: "allowed"; hostname: string };

export function compileNavigationPolicy(
  input?: { allowHostnames?: readonly string[]; denyHostnames?: readonly string[] },
  path?: string,
): CompiledNavigationPolicyV1;
export function parseCompiledNavigationPolicy(value: unknown): CompiledNavigationPolicyV1 | null;
export function navigationPolicyIsEmpty(policy: CompiledNavigationPolicyV1): boolean;
export function classifyNavigationUrl(
  rawUrl: unknown,
  policy: CompiledNavigationPolicyV1,
): NavigationUrlDecision;
