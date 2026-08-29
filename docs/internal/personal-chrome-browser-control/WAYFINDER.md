# Personal Chrome browser control

## Artifact Graph

- Artifact ID: `artifact:wayfinder-personal-chrome-browser-control`
- Role: `wayfinder`
- Standalone: true
- Source baseline: upstream OpenClaw `f07ac003b8375e398a8e82eef77132ba920e49e9`
- Working branch: `docs/personal-chrome-wayfinder`
- Children:
  - [01 - Build the conflict-free isolation harness](tickets/done/01-build-conflict-free-isolation-harness.md)
  - [02 - Decide the browser domain-policy seam](tickets/done/02-decide-browser-domain-policy-seam.md)
  - [03 - Implement extension-profile launch and readiness](tickets/done/03-implement-extension-profile-launch-and-readiness.md)
  - [04 - Implement descendant popup containment](tickets/done/04-implement-descendant-popup-containment.md)
  - [05 - Enforce task-owned lifecycle and domain policy](tickets/done/05-enforce-task-owned-lifecycle-and-domain-policy.md)
  - [06 - Prove the packaged flow in isolation](tickets/06-prove-packaged-flow-in-isolation.md)
  - [07 - Provision the Windows restart lane](tickets/07-provision-windows-restart-lane.md)
  - [08 - Accept the candidate on personal Chrome](tickets/08-accept-candidate-on-personal-chrome.md)

## Type and status

Wayfinding architecture and implementation specification. This document replaces the
previous Hattrick-specific maps, local-runtime patch plans, and partially completed restart
tickets as the only active scheduling source for this project.

The source analysis is complete enough to define the destination, invariants, ownership
boundaries, test topology, and first implementation frontier. No production browser-control
feature is claimed complete merely because an older local overlay or installed runtime once
demonstrated it.

## Purpose

OpenClaw must be able to start or reach one explicitly configured Chrome profile, use the
OpenClaw Chrome extension to create and control task-owned tabs in that signed-in profile,
and keep site-created authentication children under the same explicit consent boundary.

The reference flow is:

1. an agent asks profile `chrome` to open a permitted URL;
2. OpenClaw starts the configured Chrome profile only if its extension relay is unavailable;
3. the extension creates the root tab and places it in the OpenClaw tab group before the tab
   is published as controllable;
4. a site may open an OAuth or account-chooser child;
5. the child is admitted only if its creation-time opener belongs to the same OpenClaw group
   and its destination satisfies the configured domain policy;
6. OpenClaw continues the supported login flow in that grouped child;
7. password, OTP, CAPTCHA, passkey, recovery, new-consent, and account-ambiguity boundaries
   stop with a visible outcome;
8. OpenClaw closes only the exact tabs it created for the task.

"Inside the extension" means inside the extension-controlled OpenClaw tab group and relay
inventory. OAuth UI remains an ordinary Chrome page. It must not be embedded into the
extension popup or copied into an extension-owned page.

## Operator identity and privacy

The real account address is not configuration identity and must not appear in source,
tickets, fixtures, logs, or committed documentation. The durable name is **authorized
personal Chrome profile**. Machine-local configuration may identify Chrome's user-data
directory and profile-directory name, but never stores account credentials.

Cookies, local storage, IndexedDB, browser history, passwords, OAuth tokens, and account
sessions remain owned by Chrome. Development and automated tests must never copy the real
Chrome profile. The final host check uses the existing profile in place only after explicit
human authorization.

## Non-negotiable invariants

### Consent and privacy

- Personal Chrome runs in extension access mode `selected`.
- The named OpenClaw tab group is the authorization and ownership boundary.
- Automatic root creation authorizes only the new task-owned root.
- A child inherits only from an integer `openerTabId` whose tab is already in an OpenClaw
  group. General tab accessibility, active-tab status, URL similarity, and window proximity
  are not substitutes for opener ownership.
- An unrelated existing tab is never added to the group, attached, inspected, or closed.
- Manual ungrouping is immediate revocation and must retire in-flight CDP authority.

### Browser and profile selection

- The authenticated path uses profile `chrome` with driver `extension`.
- It never falls back to managed profile `openclaw` or existing-session profile `user`.
- A configured launcher may start the authorized personal Chrome profile, but it may not
  stop, restart, repair, or replace an already running personal Chrome process without an
  explicit operator action.
- An absent or ambiguous profile selection is a visible configuration error, not permission
  to choose another Chrome profile.

### Authentication

- A previously authorized account may be selected only when the chooser entry is uniquely
  and visibly identifiable by the operator-approved rule.
- Passwords, OTP/2FA, CAPTCHA, passkeys, recovery prompts, new consent, security
  interstitials, and ambiguous account lists are human boundaries.
- Successful login is confirmed from the destination site's visible authenticated UI, not
  from a URL or popup closure alone.

### Lifecycle

- Root creation is transactional: create, authorize/group, publish, attach, and return one
  stable logical tab reference, or remove the task-owned partial tab and return a typed
  failure.
- Popup containment is creation-time and fail-closed. A grouping or policy failure does not
  publish the child.
- Renderer replacement, MV3 worker suspension, and relay reconnection do not silently switch
  operation ownership to a different tab.
- Cleanup is provenance-based. A zero managed inventory is not proof that no physical tab
  remains.
- Every requested action has a visible success or a recorded failure with the next safe step.

### Development safety

- Tests never use the operator's live Gateway port `18789`, live OpenClaw state directory,
  live config, personal Chrome user-data directory, or real browser extension pairing.
- No test uses Codex Browser MCP, Codex Chrome control, Chrome DevTools MCP, or another
  `chrome.debugger` client against the test browser.
- The OpenClaw CLI and extension under test are the only browser controller in end-to-end
  tests.
- Test credentials are synthetic. Test sites are loopback fixtures unless a later human gate
  explicitly authorizes a real provider.

## Evidence ledger

### Present in current upstream source

| Capability                         | Current owner                                                                                                                            | Evidence and consequence                                                                                                                                                                                             |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Signed-in Chrome extension profile | `src/config/types.browser.ts`, `extensions/browser/src/browser/config.ts`                                                                | Built-in profile `chrome` resolves to driver `extension`; it is attach-only and does not currently select or launch a Chrome profile.                                                                                |
| Root-tab creation                  | `extensions/browser/src/browser/extension-relay/relay-bridge.ts`, `extensions/browser/chrome-extension/modules/relay-command-handler.js` | `Target.createTarget` becomes relay command `createTab`; the extension calls `chrome.tabs.create`, groups the tab, and synchronizes inventory.                                                                       |
| Selected-tab access boundary       | `extensions/browser/chrome-extension/modules/tab-access.js`, `tab-access-events.js`, `relay-tab-groups.js`                               | Selected mode derives access from the OpenClaw group; group changes invalidate access and detach revoked tabs.                                                                                                       |
| MV3 reconnect                      | `extensions/browser/chrome-extension/background.js`                                                                                      | Startup, install, and alarm handlers restart automation and reconnect the relay.                                                                                                                                     |
| Relay reattachment                 | `extensions/browser/src/browser/extension-relay/relay-bridge.ts`                                                                         | Current main records lost attachment intent and reattaches unchanged accessible tabs after a validated extension reconnect. The older local reconnect commit is superseded by this stronger upstream implementation. |
| Stable operation ownership         | `extensions/browser/src/browser/extension-relay/relay-bridge.ts` and tests                                                               | Current main tracks tab generations across renderer replacement and invalidates captured ownership on revoke or a different extension connection.                                                                    |
| Navigation SSRF guard              | `extensions/browser/src/browser/navigation-guard.ts`, `src/infra/net/ssrf.ts`                                                            | OpenClaw checks requested, redirect, and final URLs on its normal browser paths and blocks URL-embedded credentials.                                                                                                 |
| Isolated test-state helpers        | `src/test-utils/openclaw-test-state.ts`, `test/helpers/openclaw-test-instance.ts`                                                        | The repository already has canonical temporary state/config/Gateway helpers; new tests must reuse them.                                                                                                              |
| Docker and browser fixtures        | `scripts/e2e`, `scripts/docker/sandbox`, `docs/reference/test.md`                                                                        | Docker can prove packaged Gateway, protocol, raw CDP, and fixture behavior with isolated state. It is not a faithful Windows personal-profile extension environment.                                                 |

### Proven historically, but not implemented by current upstream

| Capability                | Durable conclusion                                                                                                              | Claim ceiling                                                                                           |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Popup ancestry            | Chrome 151 exposed `openerTabId` on normal and popup-window children.                                                           | Browser-mechanics evidence, not current production behavior.                                            |
| Exact group inheritance   | Grouping a popup with the opener's exact group ID moved it into the opener's normal window and cleared `openerTabId` afterward. | The opener relation must be captured before grouping.                                                   |
| Least-privilege predicate | A local overlay accepted only descendants of a grouped opener and rejected unrelated tabs.                                      | The brittle overlay patch is not the final implementation.                                              |
| Manual revoke             | Creation-only inheritance did not re-add a manually ungrouped child.                                                            | Must be re-proved in the upstream module architecture and selected mode.                                |
| Locked extension build    | A local builder detected upstream drift and preserved its last known-good output.                                               | Useful packaging evidence; the fork should implement source directly instead of keeping a text patcher. |
| Personal-profile OAuth    | An earlier composition reached an authenticated Hattrick page through a Google chooser.                                         | Historical evidence only; current fork/package/host composition is unverified.                          |
| Startup recovery          | A Windows scheduled task once started Chrome and restored the relay in the interactive session.                                 | It was host-specific and is not an upstream launcher contract.                                          |

### Not yet established

- The final integrated launch/readiness and popup-containment composition under Ticket 05.
- Production enforcement of the decided browsing allowlist and denylist. Existing
  `ssrfPolicy.allowedHostnames` remains a private-network exception and DNS-rebinding escape
  hatch, not an exclusive site whitelist.
- Domain-policy enforcement on direct authenticated CDP clients, redirect/final URLs, and
  site-created child tabs without an exposure race.
- Transactional cleanup when create, group, attach, policy validation, or discovery fails.
- A packaged, conflict-free full extension test using only the OpenClaw controller.
- Windows logon/restart behavior for the final fork candidate.
- Acceptance on the current authorized personal Chrome profile.

## Final architecture

### 1. Extension profile launcher and readiness

The browser plugin owns the feature. Extend extension-driver profile configuration only
after ticket `02` proves the smallest coherent config surface. The intended data is:

- browser executable, with existing executable discovery as the default;
- explicit Chrome user-data directory;
- explicit Chrome profile-directory name;
- bounded launch/readiness timeout;
- launch enabled only for that named extension profile.

The implementation should reuse `BrowserProfileConfig.executablePath` and determine whether
`userDataDir` can be safely generalized from `existing-session` rather than adding duplicate
paths. A `profileDirectory` field is likely required because one user-data root can contain
multiple profiles. If configuration validation changes, add the matching doctor migration or
diagnostic required by repository policy.

`ensureBrowserAvailable` for an extension profile becomes:

1. return immediately when the correct paired extension relay is healthy;
2. when no relay is present and launch is explicitly configured, start Chrome with exact
   `--user-data-dir` and `--profile-directory` arguments;
3. never pass secrets or the account address in arguments;
4. wait for the extension identity and relay assigned to that OpenClaw profile;
5. retry no more than once within one shared deadline;
6. report `profile-not-configured`, `chrome-launch-failed`, `extension-not-installed`,
   `relay-timeout`, or `profile-ambiguous` distinctly.

It must not launch the managed OpenClaw browser, attach Chrome MCP, kill Chrome, or copy a
profile. Windows service/session limitations remain explicit: a desktop Chrome process needs
an interactive session.

### 2. Transactional root creation

Keep the canonical path:

`browser open` -> `server-context.tab-ops` -> CDP `Target.createTarget` -> extension relay
`createTab` -> `chrome.tabs.create` -> OpenClaw group -> inventory -> debugger attach.

Strengthen ownership at the producer:

- validate the requested URL before relay dispatch;
- create the physical tab once;
- group it before returning a tab ID;
- if grouping fails, remove that exact new tab before returning an error;
- if relay attachment or target discovery fails, close the exact root by its physical tab
  provenance instead of relying only on managed inventory;
- return one logical task-tab handle that can resolve a replacement renderer target while
  the same tab generation remains authorized;
- record a typed cleanup outcome when compensating removal fails.

The implementation must not restore the old installed `server-context` patch or standalone
tab-alias-manager file. Current upstream already owns relay recovery and logical operation
identity; new work should compose with those owners.

### 3. Descendant popup containment

Implement popup behavior as an extension module, not a generated text patch.

`tab-access-events.js` should receive a narrow descendant-containment dependency and register
one `chrome.tabs.onCreated` listener. At creation it must:

1. require different integer child and opener IDs;
2. resolve the opener tab and confirm its `groupId` belongs to an exact-title OpenClaw group;
3. capture the opener group ID before any move/group operation;
4. record the child as pending while URL policy is unresolved;
5. group with `chrome.tabs.group({ tabIds: [childId], groupId: openerGroupId })` only after
   policy allows the child;
6. synchronize relay inventory after successful grouping;
7. leave unrelated, malformed, denied, or failed children unpublished;
8. never re-run inheritance after creation, so manual ungroup remains revocation.

The current `addTabToOpenClawGroup` helper chooses a group by child window and cannot express
the proven popup behavior. Generalize it to accept an exact existing group ID, or introduce a
narrow exact-group operation used by root and descendant owners without duplicating group
creation logic.

OAuth popups often begin with an empty URL or `about:blank`. The extension must retain only
the captured ancestry fact while waiting for the first meaningful `pendingUrl`/`url`; it must
not attach or publish the child during that pending state. A later disallowed navigation must
retire authority before any subsequent CDP event is forwarded.

### 4. Domain policy

The user-facing capability is optional per browser profile:

- **allow list unset or empty:** any otherwise safe public HTTP(S) hostname is eligible;
- **allow list non-empty:** only exact or wildcard-matching hostnames are eligible;
- **deny list:** matching hostnames are always rejected, including when also allowed;
- matching is case-insensitive, IDNA-normalized, hostname-only, and uses the repository's
  existing exact/`*.` subdomain semantics;
- `about:blank` is allowed only as an unexposed bootstrap state;
- embedded URL credentials and unsupported schemes remain blocked;
- private-network SSRF policy remains a separate, cumulative control.

Ticket `02` accepted `browser.profiles.<name>.navigationPolicy` with `allowHostnames` and
`denyHostnames`. It does not reinterpret `browser.ssrfPolicy.allowedHostnames` or revive the
retired public `hostnameAllowlist`. The browser plugin compiles one deterministic
`CompiledNavigationPolicyV1`; Node and MV3 consume the same pure matcher source. Deny wins,
missing/empty allow preserves otherwise-safe browsing, URL ports do not participate, and
private-network SSRF checks remain cumulative. The policy is used by:

- root open before `Target.createTarget`;
- navigation and redirect/final URL checks;
- authenticated direct relay CDP create/navigate commands;
- extension child admission and subsequent child/root URL changes;
- inventory publication and attachment eligibility.

The extension receives the compiled, non-secret policy after relay authentication and before
its first inventory-bearing hello. A connection nonce binds acknowledgement to the exact
socket; reconnect clears volatile policy state and requires a fresh installation. The
extension never persists a policy copy. A legacy hello is acceptable only for an empty policy;
a configured policy fails visibly on an incompatible extension.

The focused decision artifact is
`docs/adrs/2026-08-27-browser-navigation-hostname-policy.md`. Its disposable ticket `01`
prototype proves the creation-state model only; tickets `04` and `05` own real Chrome event
ordering and production enforcement.

### 5. Task-owned lifecycle

Represent task ownership independently of raw target IDs:

- root physical tab ID and generation;
- current CDP target/session identity;
- captured descendant relationships;
- grouped/attached/published state;
- cleanup disposition.

The lifecycle must cover success, navigation, renderer replacement, relay reconnect, manual
revocation, popup closure, root closure, timeout, and policy denial. Cleanup closes descendants
before roots when they are still task-owned. It must never close by URL-wide search.

Technical extension pages used for wake or repair are one-shot and remove themselves in a
`finally` path. A healthy readiness check creates no tabs. Periodic checks must not invoke a
full OAuth flow unless observed state requires it.

## Conflict-free test architecture

### Controller rule

The test browser has exactly one automation owner: the OpenClaw extension and CLI built from
this fork. Codex browser tools, Chrome MCP, Playwright direct CDP attachment, Puppeteer direct
attachment, and any second extension are excluded from that browser process. Observers read
fixture HTTP results, Gateway/relay logs, filesystem artifacts, and OpenClaw CLI JSON only.

### Layer 0: unit and protocol tests

- Run focused Vitest/Node tests with mocked Chrome APIs.
- Cover ancestry, exact group reuse, pending URL, allow/deny precedence, revoke, renderer
  replacement, reconnect, and compensating cleanup.
- Reuse repository fake-timer and shared-state rules.

### Layer 1: Docker package and relay tests

- Docker Desktop is available on the current host.
- Build/package the fork in Linux containers.
- Use a temporary OpenClaw home, config, state database, and free Gateway port.
- Run the real relay against a fake extension peer and loopback fake OAuth sites.
- Prove package contents, config parsing, protocol policy delivery, typed failures, and cleanup.
- Do not mount the personal OpenClaw home or Chrome profile. Copying the real config wholesale
  is prohibited; create a minimal synthetic config and use secretless fixtures.

Docker cannot prove Chrome extension UI, Windows profile selection, DPAPI-bound cookies, or
interactive-session startup. It is necessary but insufficient.

### Layer 2: native disposable Windows Chrome

- Download or pin Chrome for Testing in a task-owned temporary directory.
- Launch it with a unique temporary `--user-data-dir`.
- Load only the candidate OpenClaw extension with `--disable-extensions-except` and
  `--load-extension`.
- Start a package-built Gateway with isolated state and a free port.
- Pair only the disposable extension to the disposable Gateway.
- Use local fake root, OAuth popup, redirect, challenge, denied-domain, and unrelated-tab
  fixtures.
- Drive the browser only through `openclaw browser --browser-profile chrome ...`.
- Tear down only processes whose command lines contain the verified task-owned profile path,
  then remove that temporary directory.

This layer shares the Windows kernel but does not touch personal Chrome or personal OpenClaw.

### Layer 3: disposable Windows VM

A separate Windows VM is required before claiming login-session, Chrome restart, Gateway
restart, RDP disconnect, or machine reboot behavior. The current host has Docker/WSL2, but no
installed Windows Sandbox executable, VirtualBox CLI, or VMware CLI. Provisioning Hyper-V,
Windows Sandbox, VirtualBox, or another Windows VM is therefore a human-gated infrastructure
ticket.

The VM receives the fork package, a synthetic OpenClaw config, a test Chrome profile, and a
test account only. It must not receive a copy of the personal Chrome profile or credential
stores. Snapshot rollback provides recovery between runs.

### Layer 4: personal-profile acceptance

Only after layers 0-3 pass may a human authorize a narrow host check. Freeze the candidate,
stop all competing browser controllers, record pre-existing tabs without reading their
contents, create uniquely tagged harmless task tabs, exercise the permitted OAuth chooser if
available, close exact created IDs, and verify that live Gateway/config/profile state outside
the candidate boundary is unchanged.

## Legacy ticket reconciliation

The old docs are evidence, not active work. Their final disposition is:

| Old area                                                    | Disposition in this map                                                                                                   |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Chrome 151 popup prototype and local overlay                | Preserve conclusions; reimplement as current upstream source and tests in ticket `04`.                                    |
| Relay reconnect and stable target/operation identity        | Already present on current upstream main; verify, do not port the old local patch.                                        |
| Generic CLI root creation and transient technical-URL fixes | Preserve failure cases; replace installed core patches with upstream and address remaining lifecycle gaps in ticket `05`. |
| Hattrick cron/browser instruction edits                     | Product consumer only; do not treat prompts as browser infrastructure. Revisit after the generic feature passes.          |
| Startup task and interactive logon work                     | Host-specific historical evidence; replace with generic launcher code plus VM/host acceptance tickets.                    |
| Technical-tab leak and orphan cleanup                       | Preserve zero-growth and exact-provenance invariants in tickets `05` and `06`.                                            |
| Old restart/reboot tickets                                  | Superseded by tickets `07` and `08` against the final fork candidate.                                                     |
| Upstream PR research                                        | No PR or publication is authorized. Development remains in the fork.                                                      |

## Host cleanup and restoration boundary

Before implementation begins, normalize the real host:

- move the previous workspace `docs` directory to a recoverable timestamped backup and leave
  no active duplicate ticket map there;
- restore the installed OpenClaw `2026.7.1-2` core files to exact official npm bytes;
- remove only the extra local core module after backing it up;
- preserve `openclaw.json`, credentials, identity, devices, agents, state databases, memory,
  skills, plugin skills, workspaces other than the old docs subtree, scheduled jobs, Chrome
  user data, extension installation, pairing storage, and all unrelated projects;
- do not modify `C:\Users\rdpuser\projects\openclaw`, which contains unrelated dirty work;
- restart only the Gateway after exact-byte restoration; do not start or restart Chrome as
  part of cleanup.

The completion paths and verification hashes are recorded after the operation in
`Host baseline result` below.

## Host baseline result

Completed on 2026-08-26:

- The previous workspace `docs` tree was moved intact to
  `C:\Users\rdpuser\AppData\Local\OpenClaw\backups\personal-chrome-normalization\20260826-171548\workspace-docs`.
  Source and backup counts were both 92 files; the old active `docs` path no longer exists.
- Modified core files from both installed runtime roots were copied into the same backup under
  `core\global` and `core\stable`. The extra `dist\openclaw-tab-alias-manager.js` files were
  moved there rather than irreversibly deleted.
- Global npm and stable runtime roots now match all 8,550 official files from
  `openclaw@2026.7.1-2`: zero missing, zero different, and zero extra non-dependency files in
  each root.
- Official restored hashes include
  `server-context-CHfAdCP1.js` =
  `f1bd90d413ccaea85d5629d3c019de19bd9406985c90941b71aec42bce90826b` and
  `relay-lifecycle-D592mef3.js` =
  `3db7d82f72bc1247199a2926ea1f66f5d539bbacafb38ac0d8d60a78f9f1e177`.
- `openclaw.json` and all 17 files in the installed Chrome extension were hash-identical
  before and after restoration.
- Chrome had zero processes before and after the operation and was not started.
- The existing Gateway scheduled task was restarted. A second health sample returned
  `ok: true`, no plugin errors, non-degraded event loop, active config reload, and connected
  Telegram. Config validation returned valid with no warnings.
- Chrome Startup remained enabled/ready. Browser Bootstrap, Browser Health, and Watchdog
  remained disabled. No task enablement policy changed.
- The detailed recovery note is stored at
  `C:\Users\rdpuser\AppData\Local\OpenClaw\backups\personal-chrome-normalization\20260826-171548\RESTORE-MANIFEST.md`.

## Frontier and blocking edges

Tickets `01` through `04` are integrated in the fork. They establish the isolation harness,
navigation-policy decision, extension-profile launch/readiness, and descendant-popup
containment foundations.

The current frontier is:

- ticket `05` integrates launcher, root, popup, policy, and cleanup;
- ticket `06` freezes and proves the packaged candidate without personal state;
- ticket `07` is human-gated Windows VM/restart proof;
- ticket `08` is the only ticket allowed to touch the authorized personal Chrome profile.

## Definition of done

The project is complete only when all eight tickets are complete and the host acceptance
evidence proves:

- a disconnected but configured authorized Chrome profile can be started and its exact
  extension relay becomes ready;
- one permitted root opens in the OpenClaw group without manual sharing;
- an allowed OAuth child inherits the exact group and remains controllable;
- an unrelated child and a denied hostname remain private;
- allowlist, denylist, SSRF, redirect, final URL, and manual-revoke behavior are coherent;
- renderer replacement and relay reconnect preserve only same-tab task ownership;
- unsupported login challenges stop visibly;
- exact task-owned cleanup leaves no physical or managed residue;
- no personal OpenClaw state, unrelated tabs, or personal Chrome data changed outside the
  explicitly accepted test surface.

## Non-goals

- Bypassing authentication security controls.
- Reading or copying personal credentials, cookies, history, or unrelated tabs.
- Making arbitrary existing tabs automatically controllable.
- Embedding third-party login UI inside an extension page.
- Treating Docker as proof of Windows interactive Chrome behavior.
- Keeping local patches in installed npm `dist` files.
- Publishing an upstream issue, pull request, npm package, or release.
- Reworking Hattrick business rules, bids, purchases, schedules, or account security.
