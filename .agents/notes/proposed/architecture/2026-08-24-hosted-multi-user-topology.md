# Agent Note: Host Peck Harness as a multi-user service behind wallet login

Status: proposed

English | [中文](2026-08-24-hosted-multi-user-topology.zh.md)

## Problem

The only running Peck Harness deployment is one `dsh web` process on a personal laptop, loopback-bound and bridged to a WireGuard flat through socat, with the default permission preset at `danger-full-access` and no application authentication. The 2026-08-22 rapid audit records this as its P0: the setup is defensible only while every WireGuard peer is trusted and is the owner. Inviting real users breaks that premise in three ways at once: they need browser access without VPN membership, they need workspaces that are not the host's filesystem, and their model usage needs metering. None of those exist today.

Two candidate answers do not work as-is. A connector that would let a cloud agent operate a folder on the user's own machine does not exist in any repository. UHRP storage (`storage.peck.to`) is content-addressed static retrieval and cannot serve as a live, randomly mutated working tree.

## Proposal

Move multi-user Peck Harness to a hosted topology where the harness process runs on owned server infrastructure and each user gets an isolated execution world, entered by wallet login instead of VPN membership.

### Topology

One GCP VM pool (Cloud Run's request model does not fit hours-long PTY agent sessions) hosts N sandboxed execution worlds, container per user session. The existing portable-execution-world seam supplies the isolation mechanism without new harness architecture: `fs-e2b` and `subprocess-e2b` place `ctx.fs`, `ctx.subprocess`, and terminal sessions inside a remote sandbox while the harness process, Cordis objects, session persistence, and skills stay server-side. The raw `dsh web` GUI is never exposed directly; a product front end owns authentication and drives sessions over the existing JSON-RPC/ACP surfaces. The deployment refusal recommended by the audit (non-loopback reachability plus no authentication plus `danger-full-access` must refuse to start) guards every future configuration of this kind.

### Identity and payment flow

Wallet login reuses what exists: `wab` for the authentication exchange and BRC-42 identity keys as the user identifier, already the peck.to convention. A login maps identity to a hosted session and to a spending ceiling authorized through a BRC-100 payment channel. Model calls route through `llm.peck.to` under the metered-routing plan, reserve channel credit before serving, and return a signed receipt. Gateway-side signature verification of receipts — audit P1 — is a hard prerequisite: in a multi-user topology the receipt is the billing record, not a display.

### Workspace lifecycle

Each sandbox begins empty or cloned from a user-chosen source. The working tree lives only inside the sandbox for the session's life; durability comes from explicit exits rather than implicit persistence: export or publish artifacts to UHRP, push code to a git remote, or restore into a later sandbox from encrypted backup (BRC-2). Sandboxes are reaped after an idle timeout, so cost tracks use.

### Phasing

Phase 1 is the paid canary path already defined by the distribution plan, run on this topology: invite link, wallet login, isolated sandbox, one metered stream with a verified signed receipt. Phase 2, explicitly deferred, is the local workspace bridge: a small daemon on the user's machine speaking ACP/JSON-RPC upward and enforcing per-action approvals locally, so a cloud agent can operate a folder the user owns. It is a product of its own trust design and starts only after Phase 1 proves the hosted flow.

This note complements [the distribution and metered routing plan](2026-08-18-peck-distribution-and-metered-routing.md), which owns repository strategy and access classes; this note owns where the processes run and who can reach them.

## Alternatives considered

**Invite users into the WireGuard flat.** Rejected: it turns the audit's P0 into a shared attack surface where any invited peer reaches an unauthenticated host-execution endpoint running as the owner's user.

**Serve multiple users from one unisolated harness process.** Rejected: sessions, plugins, credentials, and shell processes share process state, so one user's arbitrary code execution is every user's. Isolation is the product requirement, not an optimization.

**Use UHRP as the workspace store.** Rejected for the live tree because UHRP is content-addressed retrieval without random-write semantics. Retained as the export, share, and publish layer around the sandbox workspace.

**Build the local-workspace connector first.** Rejected for sequencing: it requires a trusted local daemon, local approval UX, and reverse transport before a single user is served. Cloud sandboxes reach multi-user sooner and de-risk nothing less than the connector would.

## Acceptance criteria

- A new user goes from invite link to wallet login to an isolated sandboxed workspace to one metered model call with a verified signed receipt, with no VPN membership and no local install.
- No harness process configured with `danger-full-access` is reachable without application-level authentication; the startup refusal fires otherwise.
- Two concurrent users cannot observe each other's files, processes, or sessions.
- Workspace exit paths work from the sandbox: artifact export to UHRP and code push to a git remote.
- Idle sandboxes are reaped automatically and billed usage reconciles with issued receipts.

## Risks

Always-on sandboxes cost money even when idle; TTL reaping and wake-on-demand bound this but add cold-start latency. The e2b adapter family is an experimental POC; hardening for production (sandbox escape review, resource caps, reconnect behavior) is real work ahead of the first invitee. Receipt verification must land before any real-sats traffic, or billing displays lie at scale. The laptop deployment remains the development environment, so composition drift between it and the hosted profile is likely until the Peck composition layer lands.
