# Intelligent IVR Middleware (IIM)

Unattended Node control plane between **Asterisk** (AMI/ARI) and **PULSE CX**. IIM does not own customers, agents, or queues. It admits inbound channels, calls PULSE before answer, and keeps call progress + a caller snapshot.

## Quick start

```bash
cp .env.example .env
npm install
npm run build
npm start
```

- `/health` — process up  
- `/ready` — SQLite + AMI/ARI when telephony is **connect** (setup drain does **not** fail ready)  
- `/docs` — Swagger  
- `/v1/*` — header `X-API-Key`

## Two independent switches

| Switch | Effect |
| --- | --- |
| **Setup `enabled`** | New calls on that DID/trunk. `false` = drain for maintenance. **AMI/ARI stay connected.** Wait until `activeCount` is 0, then stop/cleanup/config. |
| **Telephony connect/disconnect** | AMI/ARI sockets. Disconnect = drop links, **no retry**. Connect = bring up with **retry delay**. |

`POST /v1/telephony/connect` `{ "retryDelayMs": 5000 }`  
`POST /v1/telephony/disconnect`

## Call management setups

Each setup: name, **match DID and/or trunk**, **maxConcurrent** (channels we can bear: IVR + queue + talking), **enabled**.

Example: DID `1096`, cap `10`, **9** live → one more allowed. The next ring is **busy** (AMI hangup cause 17). Slot is taken **immediately** when we accept the ring, before PULSE.

Unknown DID/trunk → reject. Disabled setup → reject (maintenance), not busy.

## Inbound path

1. Asterisk ring: CallerID, DID, trunk (AMI `Newchannel` / `Newexten`)  
2. Match setup → enabled? → under cap?  
3. **PULSE `preAnswer`** (own URL, default timeout 5s, retries 0) → `interactionId` or reject  
4. IIM `sessionId`  
5. **PULSE `startSession`** → customer snapshot + `callerType` / `ivrPointer`  
6. IVR interpreter is the next slice (not in this build)

Configure PULSE slots: `GET/PUT /v1/pulse/apis/preAnswer` and `.../startSession`. Empty endpoint = reject `pulse_not_configured`.

Expected pre-answer JSON includes `interactionId` or `rejectReason`. Session JSON may include `customer`, `callerType`, `ivrPointer` (aliases `ivr` / `flow` accepted).

## Live calls

`GET /v1/calls` — in-memory sessions  
`GET /v1/status` — telephony + per-setup `activeCount` / `draining`

## Layout

```
src/
  asterisk/          AMI, ARI, supervisor (telephony switch)
  calls/             match, registry, inbound admission
  pulse/             per-slot REST client
  http/routes/       setups, pulse, telephony, calls
  db/                SQLite WAL + migrations
```
