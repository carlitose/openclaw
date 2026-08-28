---
summary: "Decision for one profile-scoped browser hostname policy across Gateway and Chrome extension boundaries"
title: "Browser navigation hostname policy"
doc-schema-version: 1
read_when:
  - Implementing browser navigation allowlists, denylists, popup containment, or relay policy delivery
  - Changing browser SSRF hostname semantics, inventory admission, or debugger attachment
---

# Browser navigation hostname policy

- Status: accepted for tickets 04 and 05
- Date: 2026-08-27
- Owner: bundled browser plugin
- Follow-up implementation: tickets 04 and 05 in the Personal Chrome browser-control plan

## Context

Browser navigation currently has two hostname concepts with deliberately different meanings:

- `SsrFPolicy.allowedHostnames` is a trust exception. An exact matching hostname skips private-network rejection in `src/infra/net/ssrf.ts:231`; the browser navigation guard also uses it to permit hostname-based navigation under explicitly strict mode in `extensions/browser/src/browser/navigation-guard.ts:108`. It is not an exclusive browsing list.
- Internal `SsrFPolicy.hostnameAllowlist` is exclusive. `src/infra/net/ssrf.ts:373` applies it before the private-network decision and rejects a hostname outside the list. It is an internal request-boundary input, not a supported browser config key.
- Current doctor code merges the retired public `browser.ssrfPolicy.hostnameAllowlist` into `allowedHostnames` and removes the old key at `src/commands/doctor/shared/legacy-config-migrations.runtime.retired.ts:156`. Reusing that retired name would reverse the current migration and silently change exception semantics.

The normal browser paths preflight explicit URLs and inspect redirects/final URLs through `extensions/browser/src/browser/navigation-guard.ts:119`, `extensions/browser/src/browser/pw-session-navigation.ts:303`, and `extensions/browser/src/browser/cdp.ts:216`. The extension relay is a separate entry point: `Target.createTarget` creates immediately at `extensions/browser/src/browser/extension-relay/relay-bridge.ts:982`, while arbitrary session commands are forwarded at `extensions/browser/src/browser/extension-relay/relay-bridge.ts:787`. The extension command handler then forwards CDP and creates tabs at `extensions/browser/chrome-extension/modules/relay-command-handler.js:20` and `extensions/browser/chrome-extension/modules/relay-command-handler.js:50` without a hostname policy.

Inventory and attachment are also separate today. The extension publishes every tab admitted by its group/access policy in `extensions/browser/chrome-extension/background.js:196`; the relay accepts those snapshots in `extensions/browser/src/browser/extension-relay/relay-bridge.ts:406`; debugger attachment checks only the access epoch in `extensions/browser/chrome-extension/background.js:217`. URL changes already invalidate CDP authority synchronously before asynchronous inspection at `extensions/browser/chrome-extension/modules/tab-access-events.js:167`. That is the correct revocation seam to extend.

`allowedHostnames` exception behavior shipped in `v2026.7.1`. The retirement of the browser config `hostnameAllowlist` exists on the selected main base and is beta-only, but this decision follows that current canonical shape rather than reviving a removed surface.

## Existing solutions preflight

Chrome [match patterns](https://developer.chrome.com/docs/extensions/develop/concepts/match-patterns) define useful host-wildcard syntax, but they are extension permission patterns with scheme and path components; they do not own OpenClaw config, relay negotiation, tab generations, or SSRF composition. A public-suffix library is unnecessary because this policy matches full hostnames, not registrable domains. The platform URL parser already performs IDNA conversion; Node documents the same conversion through [`url.domainToASCII`](https://nodejs.org/api/url.html#urldomaintoasciidomain).

No dependency is added. One small pure module shared by the Gateway side and the unpacked extension is the smaller and safer solution.

## Decision

### Config

Add one optional profile-scoped surface:

```json5 validate=false
{
  browser: {
    profiles: {
      chrome: {
        driver: "extension",
        navigationPolicy: {
          allowHostnames: ["example.com", "*.oauth.example.com"],
          denyHostnames: ["blocked.oauth.example.com"],
        },
      },
    },
  },
}
```

The rules are:

1. Missing `navigationPolicy`, missing `allowHostnames`, and an empty `allowHostnames` all mean any otherwise-valid HTTP(S) hostname may be admitted. SSRF policy still applies independently.
2. A non-empty `allowHostnames` is exclusive.
3. `denyHostnames` always wins, including when the same hostname matches an allow entry.
4. An exact pattern matches one normalized hostname. `*.example.com` matches proper subdomains at any depth, never bare `example.com` or a sibling such as `evil-example.com`.
5. Patterns contain hostnames only. Schemes, credentials, paths, queries, fragments, and ports are invalid. A URL port does not participate in matching.
6. Configuration compilation trims whitespace, removes a final DNS dot, lowercases, converts Unicode domains to ASCII IDNA form, validates IPv4/IPv6 literals, rejects wildcard IPs, deduplicates, and sorts. The URL side uses the platform `URL.hostname` and the same final hostname normalizer.
7. Only HTTP and HTTPS are meaningful admitted destinations. A missing URL or `about:blank` may be a bounded creation bootstrap but is never public inventory. Malformed URLs, credential-bearing URLs, other schemes, and denied hostnames fail closed.

This profile scope is intentional. The extension relay and its Chrome profile are one lifecycle owner; a global policy would couple unrelated managed, remote-CDP, and extension profiles. No environment variable or parallel global default is added.

### Matcher and runtime representation

The browser plugin owns one pure JavaScript module at the future implementation seam `extensions/browser/chrome-extension/modules/navigation-policy.js`. Keeping it inside the unpacked extension tree lets Chrome execute the exact source that the Node side imports from the same plugin package. A declaration file supplies Node-side types.

Config resolution compiles raw strings once into this bounded, deterministic value:

```ts
type CompiledNavigationPolicyV1 = {
  version: 1;
  allow: Array<{ kind: "exact" | "subdomains"; hostname: string }>;
  deny: Array<{ kind: "exact" | "subdomains"; hostname: string }>;
};
```

The module owns compilation, canonical parsing, matching, deny precedence, and URL classification. Callers carry the compiled object forward with `ResolvedBrowserProfile`; hot paths do not reread config or rediscover profile state.

Domain policy and SSRF remain cumulative:

```text
URL syntax/protocol -> navigation hostname policy -> existing browser SSRF guard
```

A navigation allow entry never authorizes a private destination. That still requires the existing, explicit `browser.ssrfPolicy` exception. Conversely, an SSRF `allowedHostnames` exception never bypasses the navigation allow/deny decision.

### Authenticated relay delivery

The relay server receives the compiled policy when the profile lifecycle creates it. After Browser Relay Authentication v2 succeeds, the server sends a bounded `navigationPolicy.v1` installation frame with a fresh non-secret connection nonce. A capable extension:

1. clears any previous in-memory policy when the socket changes;
2. validates and installs the compiled value with the shared module;
3. returns its first `hello` only after installation, echoing the connection nonce;
4. computes the initial tab inventory under that policy.

The relay promotes the candidate socket only when the nonce belongs to that exact socket and the policy-aware hello arrives before the existing handshake deadline. Missing, malformed, stale, or mismatched policy state closes the candidate and does not replace a healthy active extension.

The extension never writes the policy or nonce to `chrome.storage`. On disconnect, key rotation, profile lifecycle replacement, or reconnect, it invalidates policy-dependent access epochs, detaches controlled tabs, withholds inventory, and waits for a fresh policy from the newly authenticated connection. Config remains process-stable as required by the browser runtime; a config change takes effect through the owning restart/reload lifecycle.

For compatibility, an old extension hello may be accepted only when the compiled policy is empty. A non-empty policy requires the policy-aware handshake and otherwise fails visibly with an update/reload instruction. This preserves the shipped default pairing path without creating an enforcement fallback.

### Enforcement ownership

| Boundary                                         | Owner and required behavior                                                                                                                                                                                                                                              |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Root creation through OpenClaw                   | Browser plugin checks the compiled hostname decision, then the existing SSRF guard, before `Target.createTarget`. A partial physical tab remains transaction-owned until admission or exact cleanup.                                                                     |
| Direct authenticated relay `Target.createTarget` | Relay bridge applies the same composite preflight before sending `createTab`; it never trusts a caller-side check.                                                                                                                                                       |
| Direct authenticated relay `Page.navigate`       | Relay bridge classifies the URL-bearing command and applies the same composite preflight before forwarding. Unknown or malformed URL-bearing forms fail closed.                                                                                                          |
| Normal OpenClaw navigation and interactions      | Existing Playwright route, redirect-chain, and final-URL guards compose the shared hostname decision before SSRF.                                                                                                                                                        |
| Redirect and final URL                           | The normal route owner checks each observable hop. The extension also invalidates authority synchronously on a URL change, then admits the proven current URL or detaches and removes it from inventory.                                                                 |
| Popup or normal child creation                   | The extension captures the exact opener tab generation and group at `tabs.onCreated`. Missing URL and `about:blank` remain bounded pending state with no inventory or debugger authority. First meaningful `pendingUrl` or URL is evaluated before grouping/publication. |
| Later root or child URL change                   | Extension tab-access lifecycle invalidates the tab epoch before awaited Chrome reads. Allowed current state may receive a new epoch; denied, malformed, or unsupported state detaches and stays unpublished.                                                             |
| Inventory                                        | Extension filters before sending `hello`/`tabs`; the relay defensively re-evaluates snapshots with the same compiled object before storing or listing them.                                                                                                              |
| Debugger attachment and every CDP forward        | Extension access policy requires both the current access epoch and current policy admission. Relay capture also binds to the exact extension connection and tab state.                                                                                                   |

The policy is an automation admission and control boundary, not a general Chrome firewall. Explicit root and CDP navigation requests are rejected before dispatch. Existing Playwright request interception protects normal interactions. A destination initiated entirely by page script may begin loading before Chrome reports the new URL; the synchronous tab-event path must nevertheless retire automation authority before any subsequent debugger event is relayed. Network-wide blocking would require a separately approved extension-permission and web-request design.

## Creation state model

The ticket 01 harness prototype is `scripts/e2e/personal-chrome-domain-policy-prototype.mts`. It is deliberately non-production and must be replaced by the shared matcher and extension state machine in tickets 04/05.

```text
created with proven opener
  -> pending (missing URL or about:blank; hidden and unattached)
  -> admitted (first meaningful HTTP(S) URL passes allow, deny, and SSRF)
  -> denied (first meaningful URL fails; never controllable)

admitted
  -> admitted (allowed redirect or later URL)
  -> revoked (denied, malformed, or unsupported URL; epoch retires first)
```

Pending child state contains only tab ID, opener tab generation, captured group ID, connection/policy generation, and a bounded deadline. Closure, opener revocation, group loss, relay replacement, timeout, or a terminal URL decision deletes it. It is neither inventory nor attach authority.

The prototype covers missing URL, hidden `about:blank`, first meaningful `pendingUrl`, allowed and denied redirects, deny-over-allow, wildcard bare-suffix rejection, mixed case, IDNA, URL ports, invalid pattern ports, and a grouped child that later changes to a denied hostname. Its maximum claim is state-machine feasibility; it does not prove Chrome event ordering or production enforcement.

## Compatibility and doctor

No migration or `doctor --fix` rewrite is required:

- the field is additive and missing/empty preserves current navigation behavior;
- existing `browser.ssrfPolicy.allowedHostnames` retains its shipped exception meaning;
- the retired `browser.ssrfPolicy.hostnameAllowlist` migration remains unchanged;
- invalid new patterns are rejected by schema/config compilation before runtime, with a path-specific message and a corrected example.

The new surface passes the config bar because no existing supported key can express an exclusive per-profile browsing allowlist or a denylist. Reinterpreting `allowedHostnames` would silently widen private-network trust, while the internal `hostnameAllowlist` has no deny semantics, is not profile-owned, and was explicitly removed from browser config.

## Consequences

- One deterministic matcher source serves Node and MV3; there is no copied extension config or second matcher.
- The default path is unchanged and remains visible: configuring a policy activates it on the named profile; an incompatible extension reports a concrete reload/update step.
- Enforcement work spans config/schema, relay handshake, bridge classification, extension access epochs, inventory, attach, and existing navigation guards. Ticket 05 must land these as one coherent boundary, while ticket 04 consumes the same state machine for descendants.
- The current `data:text/html,` accessible blank workaround in `extensions/browser/src/browser/extension-relay/relay-bridge.ts:21` cannot become public inventory under the new policy. Ticket 05 must absorb or remove it inside the root creation transaction.
- Production implementation must cap pattern counts and serialized bytes, add schema/help/docs, and cover old-extension negotiation, reconnect, timeout, malformed frames, and exact cleanup.

## Rejected alternatives

### Reinterpret `ssrfPolicy.allowedHostnames`

Rejected because it is a shipped private-network exception. Making it exclusive would break existing configurations; using it for both meanings would let a browsing preference authorize internal addresses.

### Restore public `ssrfPolicy.hostnameAllowlist`

Rejected because current main deliberately migrates that key away, it has no denylist or profile ownership, and reviving it would conflict with the established doctor contract.

### Separate Gateway and extension lists

Rejected because reconnects, normalization updates, and wildcard fixes could drift. The authenticated relay already supplies the exact connection-bound delivery seam for one compiled policy.

### Chrome match-pattern permissions or a public-suffix dependency

Rejected because match patterns are permission declarations rather than runtime task admission, and registrable-domain parsing is outside the full-hostname contract.
