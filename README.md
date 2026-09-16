# Intelligent IVR Middleware (IIM)

Unattended Node.js control plane between **Asterisk** (AMI + ARI) and **PULSE CX**.

IIM does **not** own customers, agents, or queues. It admits inbound channels that land in Stasis, runs an **IVR program** you define, and calls PULSE when the engine or that program says so. Version **0.1.0** — lab-proven; not a packaged production product yet.

## What it does

| Piece | Role |
| --- | --- |
| **ARI** | All call control: answer, play, DTMF, hangup. Inbound = Stasis app (lab dialplan: `pulse-pbx-app`; set the same name on IIM Setup). |
| **AMI** | Stay logged in (keepalive). Not used for admit, hangup, or IVR. |
| **Instance** | Each process has its own ID, name, and description (IIM Setup). Use a **separate SQLite file** (`SQLITE_PATH`) per running copy. |
| **Inbound routing** | Match DID and/or trunk, concurrency cap, enable/drain, which IVR to start, optional **post-call survey (CSAT)** IVR. |
| **Outbound routing** | Which trunk IIM uses when it places a call (robo, agents, or both), plus optional CSAT IVR. |
| **IVRs** | One or more programs: steps that play, collect digits, call functions, then goto or hangup. |
| **Functions** | Generic (`answer`, `hangup`, `proc_createinteraction`, …) plus **custom** names wired to a PULSE API. Each function returns true or false. |
| **PULSE APIs** | One **full URL per row** (no shared base URL). Optional process-wide API key (`X-API-KEY` + `Authorization`). Mock JSON when the URL is empty. |

Stations **3001–3999** (configurable on IIM Setup) are IIM PBX phones. Other extensions (for example **2098**) are ignored unless that channel enters IIM Stasis. Lab: 2098 dials DID **7777** → Stasis → inbound route match.

Voice files live on **Asterisk** (`/var/lib/asterisk/sounds/custom/…`), not on the Windows IIM host.

## Quick start

```bash
cp .env.example .env
npm install
npx tsx src/index.ts
```

Or `npm run build` then `npm start`. After `src/` changes, restart the process.

Node **22+**. Bind host/port from `.env` (`HOST`, `PORT`; lab often `127.0.0.1:3000`).

| URL | Purpose |
| --- | --- |
| `/` | Superadmin login |
| `/app` | Live dashboard |
| `/telephony` | **IIM Setup** — instance identity, AMI/ARI, owned stations, voice path, menu defaults, PULSE Swagger URL |
| `/stations` | IIM-owned extensions (status + directory) |
| `/setups` | Inbound DID/trunk routing + IVR + CSAT |
| `/outbound` | Outbound trunks + CSAT |
| `/ivrs` | IVR programs (When / Do / Then) |
| `/functions` | Generic catalog + custom functions |
| `/pulse` | PULSE API endpoints, one key, mocks |
| `/alerts` | SMTP |
| `/console` | Live log console |
| `/logs` | Download hourly logs |
| `/docs` | IIM Swagger (session or `X-API-Key`) |
| `/health` | Process up + host + instance |
| `/ready` | SQLite + AMI/ARI when those links are **connect** (setup drain does **not** fail ready) |
| `/v1/*` | API: `X-API-Key` **or** signed UI session cookie |

First boot seeds `SUPERADMIN_USER` / `SUPERADMIN_PASSWORD` (defaults `superadmin` / `changeme`) hashed in SQLite. Change password from the **top-right avatar** menu. Env only seeds if no user exists yet.

Asterisk passwords in `.env` (`AMI_PASSWORD`, `ARI_PASSWORD`) override anything stored in SQLite. Do not commit `.env`.

Running more than one IIM: give each process its own `SQLITE_PATH`, `PORT`, and instance ID/name on IIM Setup.

## Inbound path

FreePBX inbound routes jump with `EXTEN=s`. Custom Destination Target must be:

```text
iim-inbound,s,1
```

Return: **No**. Dialplan: `asterisk/extensions_iim.conf` (paste into `extensions_custom.conf`, `fwconsole reload`). It picks DID from `FROM_DID` / DNID, then `Stasis(pulse-pbx-app)` — the ARI application name on IIM Setup must match.

Runtime:

1. ARI `StasisStart` → match an **inbound route** (DID/trunk, enabled, under `maxConcurrent`).
2. Unknown / drain / busy → ARI hangup (`rejected` or `busy`). Slot is reserved when the call is admitted.
3. If the route has an IVR, **the first menu block runs while still ringing**. That document is the program: Create Interaction, Create Session, Answer, prompts, and so on. Fail on a block follows that block’s **Then if failed** (usually hangup).
4. **Block duplicate callers** (inbound route) is checked when the Create Interaction block returns `isCliAlreadyExist=true`. The block fails, the call is rejected unanswered, logged, and counted.
5. If the route has **no** IVR, IIM still Create Interaction → Create Session → answer itself.

Lab sample IVR is not tied to DID **7777**. Hugo Bank seeds DID **7777** → **Hugo Bank IVR**. IVR prompts are **file names only** (`hugo-greeting`, `hugo-main-menu_{language}`). IIM Setup supplies `…/sounds/custom`; inbound **Voice subfolder** (e.g. `hugo`) supplies the next folder. Playback is `custom[/folder]/filename`. `{language}` becomes `ur` / `en` / `sn` / …. Do not write `custom/` in the IVR document. `proc_setlanguage ur` sets IIM files to Urdu and sends Pulse `languageQueueId` from IIM Setup (default **1**=Urdu, **2**=English).

If Pulse returns `{ responseBody: … }`, IIM unwraps it. Create Interaction also stores `isCliAlreadyExist` and `ivrRouting`. Create Session also stores `isPriority`, `isHighAlert`, and `recordingRelativePath`.

**Close Session** runs whenever both Pulse ids exist (IVR hangup or caller drop), with several retries, then gives up. It is not a new interaction.

**Add Interaction** (`CallInteraction/Add`) sends Pulse fields from the live call (`interactionId`, `sessionId`, queue ids, `action`).

Sounds are **Asterisk names** (for example `custom/urdu/BOK_GREETINGS`), not files on the Windows box.

## IVR programs

Each IVR is a list of steps. A step: play (or `none`), wait seconds (`0` = run immediately after play), retries, and a table:

**When** (`1`, `*`, `#`, `none`, `MaxTries`) → **Do** (function + optional param) → **Then if OK** / **Then if failed**.

`proc_*` functions return boolean. Success and fail are just next step or hangup. Custom functions live under `/functions` and point at a PULSE slot.

Attach the inbound IVR on **Inbound routing**. Survey IVR is a **different** program on the same page (or on outbound routing): one menu or many levels. It must reuse the live Pulse interaction/session — never Create Interaction / Create Session again.

Post-call survey is **CSAT** (customer satisfaction), not CSTA. It is stored on the route today. It will run only when the **agent** hangs up; if the caller drops first, IIM skips survey and closes the session. That hangup path is not wired yet (no agent-bridge control in this build).

## Call record (progress + logs)

Every admitted call carries:

| Field | Source |
| --- | --- |
| `internalId` | GUID created by IIM |
| `interactionId` | PULSE Create Interaction |
| `pulseSessionId` | PULSE Create Session |
| `isCliAlreadyExist` / `ivrRouting` | Create Interaction |
| `isPriority` / `isHighAlert` / `recordingRelativePath` | Create Session |
| `agentId` / `agentExtension` | PULSE when a transfer is required |
| `uniqueId` | Asterisk channel Uniqueid |
| `bridgeId` | Asterisk bridge when caller and agent are joined |
| `language` | IIM id `0` ur (default), `1` en, `2` sn, `3` ps, `4` ar, `5`–`9` ot5–ot9. Pulse `languageQueueId` is mapped on IIM Setup |
| `currentMenu` | Current IVR step key |
| `queuePosition` / `expectedWaitSec` | PULSE queue facts |
| `callerType` | PULSE |
| `postCallSurveyIvrId` | Copied from the inbound route when CSAT is on |

The same fields are included on call-related log lines (`callsInternalId`, `callInteractionId`, `callSessionId`, …).

## Two independent switches

| Switch | Effect |
| --- | --- |
| **Route `enabled`** | New calls on that DID/trunk. Off = drain. AMI/ARI stay connected. Wait until live count is 0 before maintenance. |
| **AMI connect** | AMI TCP only; retry while enabled. |
| **ARI connect** | ARI REST + WebSocket only; retry while enabled. |

IIM stations (default **3001–3999**) are set on IIM Setup. Env `IIM_OWNED_EXT_FROM` / `IIM_OWNED_EXT_TO` override SQLite.

## Logging

JSON (Pino) to **stdout** and `YYYYMMDDHH.log`. Wire dumps:

- `.AMI` — AMI packets (`>>>` / `<<<`)
- `.ARI` — ARI REST and WebSocket

Secrets (`api_key`, Basic auth, AMI `Secret`) are redacted as `***`.

IIM **proves it can write** to `LOG_DIR` (default `./logs`, relative to the Command Prompt folder), then creates `LOG_DIR/YYYYMMDD/` and writes `YYYYMMDDHH.log` / `.AMI` / `.ARI`. If that path cannot be created or a later write fails, it switches to `%TEMP%\iim-logs\YYYYMMDD\` (Windows) or `/tmp/iim-logs/YYYYMMDD/` — not `%TEMP%` itself. Startup line `hourly file logging ready` prints `logRoot`, `logPrimary`, and `logFallback`. stdout always still logs.

```
./logs/
  20260913/
    2026091300.log
    2026091300.AMI
    2026091300.ARI
```

Local time, one set of files per hour. `LOG_LEVEL=debug` adds app noise in `.log`; AMI/ARI wire is always dumped.

Look for `IIM instance identity`, `process startup` / `startup complete` / `process shutdown`, `Create Interaction ok`, `Create Session ok`, `Close Session ok`, and per call `IVR started`, `answered`, `IVR hangup`, `call shutdown`.

## UI security

Admin HTML is **not** a public static file. Pages under the sidebar and `/docs` require a signed `iim_sid` cookie (or `X-API-Key` for `/docs` and `/v1`). Anonymous browsers are sent to `/`. Logged-in browsers hitting `/` go to `/app`. Raw `*.html` URLs return 404.

Session cookie: `httpOnly`, `sameSite=strict`, signed with `API_KEY`. Set `COOKIE_SECURE=true` when the UI is served over HTTPS.

Cookie-authenticated `POST`/`PUT`/`PATCH`/`DELETE` need a matching `Origin`/`Referer` host and `X-CSRF-Token` (injected into the page; `public/js/csrf.js` adds it to `fetch`). API-key clients skip CSRF. Login is limited to **5 failed attempts per IP + username per 15 minutes**. Password change requires 8+ characters and drops every session for that user.

This is still a **lab** bind (`127.0.0.1`, HTTP). Put TLS and a reverse proxy in front before exposing the UI.

## HTTP API

`GET /v1/status` — telephony, instance, occupancy  
`GET /v1/calls` — live sessions  
`GET /v1/calls/recent` — persisted sessions  
`GET /v1/setups` — inbound routes  
`GET /v1/outbound-routes` — outbound trunks  
`GET /v1/ivrs` — IVR programs  
`GET /v1/ivrs/functions` — generic + custom functions  

Full list: `/docs`.

## Layout

```
src/
  asterisk/     AMI, ARI, supervisor
  calls/        match, registry, inbound, outbound pick, progress, CSAT helpers
  ivr/          document, engine, function catalog/runner
  pulse/        REST client, lifecycle (create / add / close)
  instance/     this process ID / name / description
  http/         UI routes + /v1
  db/           SQLite WAL + migrations
  logging/      hourly files
asterisk/       FreePBX dialplan snippet
public/         admin UI
```

## Not in this release

**Call direction** (not implemented). Today a session is always an inbound Stasis admit. Planned: `inbound` | `outbound` | `robo`.

**Post-call survey run** (config only). Routes can point at a CSAT IVR; IIM does not yet keep the caller after an agent hangup to collect it.

**Queue/bridge to an agent**, play-amount/play-string, bank-specific hardcoded IVRs (Hugo/Sindh/JS are documents + functions, not `if bank` in the engine), automated tests/CI, HTTPS termination in-process, multi-user RBAC, HA, or a packaged Windows/Linux service.
