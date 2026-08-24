# Peck deployment traps

Peck-owned, not upstream. Traps in **this** deployment — the `dsh web` server on
P15 reached from other devices — where the obvious guess is wrong. Each entry is
symptom → cause → fix. Verified facts, with the command that proved them.

Not a design doc: decisions about shipped source belong in `.agents/notes/`.

Deployment shape (verified 2026-08-18; unchanged by the 2026-08-22 restart — current deployed state lives in [`IN_FLIGHT.md`](IN_FLIGHT.md)):

- `dsh-web.service` (user unit) → `bin.js web --trusted-host 10.10.0.2`, binds `127.0.0.1:3080`
- `dsh-wg-bridge.service` (user unit) → `socat TCP-LISTEN:3080,bind=10.10.0.2 → 127.0.0.1:3080`
- Reached from phone/z13 over WireGuard at `http://10.10.0.2:3080`

---

## 1. A remote browser gets 403 on settings, credentials, and presets

**Symptom.** The page loads on the phone, sessions list, but settings are dead
and the model picker cannot discover models.

**Cause.** The `/api` trust fence reads the **`Host` header**, not the socket
address. `PRIVILEGED_METHODS` (`packages/client/connection/src/index.ts`) is
re-checked with an *empty* trust list, which pins it to loopback. `trustedHosts`
does not help: that package's own doc calls it "a DNS-rebinding fence,
explicitly not authentication".

Proven by sending both Host values at the same loopback port:

| method | `Host: 127.0.0.1:3080` | `Host: 10.10.0.2:3080` |
|---|---|---|
| `settings.describe` | 200 | **403** |
| `credentials.describe` | 200 | **403** |
| `agentPreset.read` | 200 | **403** |
| `llm.discoverModels` | 200 | **403** |
| `agentPreset.list` | 200 | 200 |
| `llm.providers` | 200 | 200 |

**Fix.** None needed — this is deliberate. Do settings from a loopback client
(P15 itself). If you must lift it, see trap 4; understand what you are removing.

---

## 2. Workspace picking is dead from a remote browser

**Symptom.** No workspace can be selected on the phone, so nothing can start.

**Cause.** `directory-picker-auto` samples the situation **once at boot** and
mounts `native` when it sees a loopback-only bind + `DISPLAY` + zenity/kdialog
on `PATH`. All three hold here — **because the WireGuard bridge is socat running
outside dsh, so the bind sample cannot see it.** Native then drives
`host.pickDirectory`, which is loopback-pinned (trap 1) → 403. A *successful*
native call would be no better: the OS chooser opens on the P15 screen.

**Fix (applied 2026-08-18, in `~/.dsh/profiles/web/cordis.patch.yml`).** Pin the
`browse` rows and disable the chooser. This is the swap point named in
`packages/host/directory-picker-auto/README.md`; mounting the chooser *and* a
backend row together fails loud on a duplicate `directoryPicker` service.

```yaml
- id: directory-picker
  disabled: true

- insert:
    - id: directory-picker-browse-backend
      name: '@deepseek-ai/dsh-host-directory-picker-browse'
    - id: directory-picker-browse-surface
      name: '@deepseek-ai/dsh-client-ui-directory-picker-browse'
```

Backend row first — the surface's browser half drives the capability the backend
registers. Verify without touching the running server:

```bash
node apps/cli/lib/bin.js --profile web --dump-config < /dev/null | grep -A3 'id: directory-picker$'
```

Takes effect only on `systemctl --user restart dsh-web.service`, which drops
whatever is open in the GUI.

---

## 3. `ssh -L` looks like it fixes this. It fixes half.

**Symptom.** The z13 workaround (SSH-forward `127.0.0.1:3080` from P15) makes the
403s disappear, so the setup looks correct.

**Cause.** It does grant loopback authority — that half is real. But
`directory-picker-auto` still resolves `native`, so the file chooser opens **on
P15**, not on the machine you are sitting at. `picker-auto`'s README names this
case explicitly as a known limitation.

**Fix.** Trap 2's patch. Then `ssh -L` is only about authority, and the picker
works wherever you are.

---

## 4. A reverse proxy must rewrite **`Host` *and* `Origin`**

If you decide to give a remote device loopback authority, know two things before
you spend an hour on it:

- **`socat` cannot do it.** It is raw TCP and forwards headers untouched. The
  current WG bridge therefore cannot lift trap 1, by construction.
- **Rewriting `Host` alone still 403s.** The fence also requires `Origin` to
  match `Host` exactly when the browser attaches one — and a browser at
  `10.10.0.2:3080` always does. Rewrite both, in nginx/caddy.

**This removes the DNS-rebinding fence.** Defensible only while the surface stays
WireGuard-only and every peer is yours. Combined with
`permission.defaultPreset: danger-full-access` in `~/.dsh/settings.yaml`, anyone
who reaches the port gets arbitrary code execution as `thomas` on P15, with no
login. Never pair it with a public tunnel or a port-forward.

---

## 5. Never call `host.pickDirectory` from a script

It opens a **real OS dialog on the P15 desktop** and blocks until someone
answers it. A probe loop that includes it hangs and leaves a dialog on the
screen. Same for anything else under `host.*` that drives the desktop.

---

## 6. Driving the harness from a script (both routes verified)

**One-shot, no server involved** — clean stdout (last assistant message only),
exit 0/1, full tool access, cwd is the workspace:

```bash
node apps/cli/lib/bin.js --profile headless "<task>" < /dev/null
```

Measured 4.2 s for a read-file → transform → write-file task. One task per run:
no follow-up, no resume, no streaming, no listening port. It inherits
`danger-full-access`, so anything it starts runs unsupervised.

**Against the running server** — full RPC on loopback, including the privileged
methods of trap 1:

```bash
curl -s -X POST http://127.0.0.1:3080/api/agentPreset.list \
  -H 'Content-Type: application/json' \
  -d '{"type":"client-request","rpcId":"p1","method":"agentPreset.list","payload":{"args":[]}}'
```

The envelope is required: `type`, `rpcId`, `method`, `payload` — a bare `{}` or a
bare `{"args":[]}` returns a schema error, and `POST /api` with no method
suffix returns 404. Namespace and method are dot-joined in the path
(`/api/llm.providers`), never slash-joined.

---

## 7. The deployed build is not the working tree

`dsh web` serves `apps/web/dist` plus each package's built `lib/client.js`.
Editing `src` changes nothing until a rebuild. When judging what the phone
actually sees, read the **served** bundle, not the source:

```bash
curl -s 'http://127.0.0.1:3080/plugins/@deepseek-ai/dsh-client-ui-layout/client.js' | grep -c 1024
```

The served build is a snapshot: it only moves when someone rebuilds and restarts, so it always trails `master`. Judge what the phone actually sees from the **served** bundle (above), and record/refresh the deployed state — commit, date, toolchain — in [`IN_FLIGHT.md`](IN_FLIGHT.md), not here. Before any rebuild, confirm the installed `pnpm` matches the manifest pin (`npx -y pnpm@11.7.0` since 2026-08-22); a version mismatch is repaired only as a deliberate, server-down reinstall — never a purge under the live server.

---

## 8. Mobile layout: the shell adapts, the panels mostly do not

`AppFrame` auto-collapses the sidebar below **1024 px** (`SIDEBAR_AUTO_COLLAPSE`,
ResizeObserver-driven, verified present in the served bundle), drops the details
column to 0, and lets the center column take the rest without forcing
`CENTER_MIN` (640). So the chat column is usable on a phone.

What is genuinely missing, before anyone "fixes" mobile twice: the whole client
has **8** responsive media queries and all sit in leaf panels (onboarding
dialogs, plugin inventory, question composer, plan review, workflow panel,
trajectory table). `ui-layout`, `ui-sidebar`, `ui-conversation`,
`ui-input-trigger` have none. Drag handles are 8 px with hover-only affordances.
`manifest.webmanifest` exists (add-to-home-screen works) but there is no service
worker and only an SVG icon — no `apple-touch-icon`, so iOS home-screen icons
are blank.
