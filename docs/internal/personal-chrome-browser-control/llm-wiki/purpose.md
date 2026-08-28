# Project Purpose

## Goal

Compile the design, implementation history, verification boundaries, and remaining work for
the fork's Personal Chrome browser-control initiative. The wiki exists so later sessions can
recover why each boundary exists without replaying chat transcripts or treating an old patch
as current behavior.

## Key Questions

1. Which guarantees are already integrated in the fork, and which remain ticket work?
2. Which owner enforces profile launch, navigation policy, descendant containment, and exact
   task cleanup?
3. What does each evidence lane prove, and what can Docker never prove about personal Chrome?
4. Which human gates remain before restart testing and personal-profile acceptance?

## Scope

**In scope:**

- The Personal Chrome WAYFINDER, tickets, completion receipts, and accepted navigation-policy
  decision.
- Architectural ownership, state transitions, privacy boundaries, causal tests, and ticket
  lifecycle.
- Fork-only implementation history needed to continue tickets 05 through 08.

**Out of scope:**

- Personal credentials, cookies, profile contents, secrets, and unrelated host state.
- General OpenClaw browser documentation except where it directly defines this initiative.
- Claims about personal-profile or restart behavior that have not passed their human-gated
  acceptance lanes.

## Thesis

> Safe personal Chrome automation is possible only when profile selection, tab authority,
> navigation admission, and cleanup share exact lifecycle ownership while evidence claims stay
> bounded to the environment that produced them.
