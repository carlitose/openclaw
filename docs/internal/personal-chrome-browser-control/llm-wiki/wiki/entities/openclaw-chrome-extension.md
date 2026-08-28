---
type: entity
title: OpenClaw Chrome extension
entity_type: tool
created: 2026-08-28
updated: 2026-08-28
sources: [artifact-wayfinder-personal-chrome-browser-control, artifact-ticket-personal-chrome-browser-control-04]
tags: [openclaw, chrome, mv3, browser-control]
related: [task-owned-browser-authority, descendant-popup-containment]
---

# OpenClaw Chrome extension

The OpenClaw Chrome extension is the MV3 component that exposes explicitly authorized Chrome
tabs to the browser relay. In selected mode, the named OpenClaw tab group is the visible
operator consent boundary.

## Responsibilities in this initiative

The extension creates task roots on authenticated relay command, places authorized tabs into
the correct group, publishes only admitted inventory, attaches or detaches the debugger under
the current access epoch, and reconnects after MV3 worker suspension. Ticket 04 adds
creation-time descendant containment for normal and popup-window children.

The extension does not own account credentials, general login UI, provider-specific policy, or
persistent copies of navigation policy. OAuth pages remain ordinary Chrome tabs. A compiled
profile policy arrives only after relay authentication and stays connection-bound in memory.

Selected-mode revocation is immediate: manual ungrouping or policy loss retires automation
authority. Unrelated existing tabs, children of non-grouped openers, and extension pages remain
private. The exact physical tab and task lifecycle are broader than the extension inventory and
are completed by [[concepts/task-owned-browser-authority]].

## Related concepts

- [[concepts/descendant-popup-containment]] - creation-time child authority.
- [[concepts/navigation-hostname-policy]] - destination admission and later revocation.
- [[concepts/extension-profile-readiness]] - reaching the correct paired extension profile.

## Sources

- [[sources/artifact-wayfinder-personal-chrome-browser-control]]
- [[sources/artifact-ticket-personal-chrome-browser-control-04]]
