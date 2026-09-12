# Intelligent IVR Middleware (IIM)

Unattended Node.js control plane between **Asterisk** (AMI + ARI) and **PULSE CX**.

IIM does **not** own customers, agents, or queues. It admits inbound channels that land in Stasis, runs an **IVR program** you define, and calls PULSE only when that program says so. Version **0.1.0** — lab-proven; not a packaged production product yet.

## What it does

| Piece | Role |
| --- | --- |
| **ARI** | All call control: answer, play, DTMF, hangup. Inbound = Stasis app (lab: `pulse-pbx-app`). |
| **AMI** | Stay logged in (keepalive). Not used for admit, hangup, or IVR. |
| **Call setups** | Match DID and/or trunk, concurrency cap, enable/drain, which IVR to run. |
| **IVRs** | One or more programs: steps that play, collect digits, call functions, then goto or hangup. |
| **Functions** | Generic (`answer`, `hangup`, `proc_createinteraction`, …) plus **custom** names wired to a PULSE API. Each function returns true or false. |
| **PULSE APIs** | Stored endpoints (URL, timeout, retries, mock). Invoked from IVR **Do** rows, including before answer. |

Stations **3001–3999** (configurable on Telephony Setup) are IIM PBX phones. Other extensions (for example **2098**) are ignored unless that channel enters IIM Stasis. Lab: 2098 dials DID **7777** → Stasis → setup match.

## Quick start

```bash
cp .env.example .env
mkdir logs
npm install
npm run build
npm start
```

Node **22+**. Bind host/port from `.env` (`HOST`, `PORT`; lab often `127.0.0.1:3020`).

| URL | Purpose |
| --- | --- |
| `/` | Superadmin login |
| `/app` | Live dashboard |
| `/stations` | IIM-owned extensions (status + directory) |
| `/setups` | DID/trunk admission + attach IVR |
| `/ivrs` | IVR programs (When / Do / Then) |
| `/functions` | Generic catalog + custom functions |
| `/pulse` | PULSE API endpoints and mocks |
| `/telephony` | AMI/ARI target, connect/disconnect, owned extensions, PULSE Swagger URL, log tail |
| `/docs` | IIM Swagger (session or `X-API-Key`; Try it out uses the API key) |
| `/health` | Process up |
| `/ready` | SQLite + AMI/ARI when telephony is **connect** (setup drain does **not** fail ready) |
| `/v1/*` | API: `X-API-Key` **or** signed UI session cookie |

First boot seeds `SUPERADMIN_USER` / `SUPERADMIN_PASSWORD` (defaults `superadmin` / `changeme`) hashed in SQLite. Change password from the **top-right avatar** menu (not the dashboard). Env only seeds if no user exists yet.

Asterisk passwords in `.env` (`AMI_PASSWORD`, `ARI_PASSWORD`) override anything stored in SQLite. Do not commit `.env`.

## Inbound path

FreePBX inbound routes jump with `EXTEN=s`. Custom Destination Target must be:

```text
iim-inbound,s,1
```

Return: **No**. Dialplan: `asterisk/extensions_iim.conf` (paste into `extensions_custom.conf`, `fwconsole reload`). It picks DID from `FROM_DID` / DNID, then `Stasis(pulse-pbx-app)`.

Runtime:

1. ARI `StasisStart` → match a **call setup** (DID/trunk, enabled, under `maxConcurrent`).
2. Unknown / drain / busy → ARI hangup (`rejected` or `busy`). Slot is reserved when the call is admitted.
3. If the setup has an IVR, the **script starts unanswered**. `answer` is an IVR function. Typical PULSE starter: `proc_createinteraction` → `proc_createsession` → `answer` → prompts.
4. If the setup has **no** IVR, IIM answers and holds.

Sounds are **Asterisk names** (for example `hello-world`), not files on the Windows box.

## IVR programs

Each IVR is a list of steps. A step: play (or `none`), wait seconds (`0` = run immediately after play), retries, and a table:

**When** (`1`, `*`, `#`, `none`, `MaxTries`) → **Do** (function + optional param) → **Then if OK** / **Then if failed**.

`proc_*` functions return boolean. Success and fail are just next step or hangup — the user edits both. Custom functions live under `/functions` and point at a PULSE slot.

Attach the IVR on **Call setups**. Lab IVR: answer → play greeting → collect. **PULSE starter**: create interaction/session first; fail can hang up without answer if you program it that way.

## Call record (progress + logs)

Every admitted call carries:

| Field | Source |
| --- | --- |
| `internalId` | GUID created by IIM |
| `interactionId` | PULSE create-interaction |
| `pulseSessionId` | PULSE create-session |
| `agentId` / `agentExtension` | PULSE when a transfer is required |
| `uniqueId` | Asterisk channel Uniqueid |
| `bridgeId` | Asterisk bridge when caller and agent are joined |
| `language` | `0` Urdu (default), `1` English, `2` Sindhi, `3` Pashto, `4` Arabic |
| `currentMenu` | Current IVR step key |
| `queuePosition` / `expectedWaitSec` | PULSE queue facts |
| `callerType` | PULSE |

The same fields are included on call-related log lines (`callsInternalId`, `callInteractionId`, `callSessionId`, …).

## Two independent switches

| Switch | Effect |
| --- | --- |
| **Setup `enabled`** | New calls on that DID/trunk. Off = drain. AMI/ARI stay connected. Wait until live count is 0 before maintenance. |
| **AMI connect** | AMI TCP only; retry while enabled. |
| **ARI connect** | ARI REST + WebSocket only; retry while enabled. |

IIM stations (default **3001–3999**) are set on `/telephony`. Env `IIM_OWNED_EXT_FROM` / `IIM_OWNED_EXT_TO` override SQLite.

## Logging

JSON (Pino) to **stdout** and `YYYYMMDDHH.log`. Wire dumps:

- `.AMI` — AMI packets (`>>>` / `<<<`)
- `.ARI` — ARI REST and WebSocket

Secrets (`api_key`, Basic auth, AMI `Secret`) are redacted as `***`.

`LOG_DIR` (default `./logs`) is used only if that folder **already exists and is writable**. Otherwise: `%TEMP%\iim-logs` (Windows) or `/tmp/iim-logs`.

```
./logs/
  20260913/
    2026091300.log
    2026091300.AMI
    2026091300.ARI
```

Local time, one set of files per hour. `LOG_LEVEL=debug` adds app noise in `.log`; AMI/ARI wire is always dumped.

Look for `process startup` / `startup complete` / `process shutdown`, and per call `IVR started`, `answered`, `IVR hangup`, `IVR shutdown`, `call shutdown`.

## UI security

Admin HTML is **not** a public static file. `/app`, `/setups`, `/ivrs`, `/functions`, `/pulse`, `/telephony`, and `/docs` require a signed `iim_sid` cookie (or `X-API-Key` for `/docs` and `/v1`). Anonymous browsers are sent to `/`. Logged-in browsers hitting `/` go to `/app`. Raw `*.html` URLs return 404.

Session cookie: `httpOnly`, `sameSite=strict`, signed with `API_KEY`. Set `COOKIE_SECURE=true` when the UI is served over HTTPS.

Cookie-authenticated `POST`/`PUT`/`PATCH`/`DELETE` need a matching `Origin`/`Referer` host and `X-CSRF-Token` (injected into the page; `public/js/csrf.js` adds it to `fetch`). API-key clients skip CSRF. Login is limited to **5 failed attempts per IP + username per 15 minutes**. Password change requires 8+ characters and drops every session for that user.

This is still a **lab** bind (`127.0.0.1`, HTTP). Put TLS and a reverse proxy in front before exposing the UI.

## HTTP API

`GET /v1/calls` — live sessions  
`GET /v1/calls/recent` — persisted sessions  
`GET /v1/ivrs` — IVR programs  
`GET /v1/ivrs/functions` — generic + custom functions  
`GET /v1/status` — telephony + per-setup occupancy  

Full list: `/docs`.

## Layout

```
src/
  asterisk/     AMI, ARI, supervisor
  calls/        match, registry, inbound, call progress
  ivr/          document, engine, function catalog/runner
  pulse/        REST client per stored API
  http/         UI routes + /v1
  db/           SQLite WAL + migrations
  logging/      hourly files
asterisk/       FreePBX dialplan snippet
public/         admin UI
```

## Not in this release

**Call direction** (not implemented). Today a session is always an inbound Stasis admit. We will add `direction` on the call record because:

- An **agent extension** (owned 3001–3999) may place an **outbound** call. That is not a customer DID hit. Occupancy, live table, and PULSE ids must not look like inbound IVR.
- IIM itself may originate a **robo** call: dial a number, answer, run an IVR. Originate + playback + DTMF share the IVR engine, but the A-leg is ours, there is no inbound setup match, and hangup/retry policy is campaign-like.

Values: `inbound` | `outbound` | `robo`. Also needed with that: originator (station vs IIM), destination number, which IVR for robo, and caps that are not inbound DID setups.

Queue/bridge to an agent, play-amount/play-string, automated tests/CI, HTTPS termination in-process, multi-user RBAC, HA, or a packaged Windows/Linux service. Those are the next steps toward a commercial build.
