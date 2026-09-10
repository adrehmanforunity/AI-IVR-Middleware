import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Env } from "../config/env.js";
import type { Logger } from "../logging.js";
import type { AsteriskTarget } from "../asterisk/types.js";
import { MIGRATION_V1 } from "./migrations/001_init.js";
import { MIGRATION_V2 } from "./migrations/002_call_mgmt.js";
import type {
  CallSession,
  CallSetup,
  PulseApiConfig,
  PulseApiSlot,
  TelephonyConfig,
} from "../domain/types.js";

type TargetRow = {
  host: string;
  ami_port: number;
  ami_user: string;
  ami_password: string | null;
  ari_base_url: string;
  ari_user: string;
  ari_password: string | null;
  stasis_app: string;
  updated_at: string;
};

export type ConfigSnapshot = {
  target: AsteriskTarget;
  settings: Record<string, string>;
};

export class ConfigStore {
  private db: DatabaseSync | null = null;
  private snapshot: ConfigSnapshot | null = null;
  private writeOk = true;
  private lastError: string | null = null;

  constructor(
    private readonly env: Env,
    private readonly log: Logger,
  ) {}

  open(): void {
    try {
      mkdirSync(dirname(this.env.SQLITE_PATH) || ".", { recursive: true });
      const db = new DatabaseSync(this.env.SQLITE_PATH, { timeout: 5000 });
      db.exec("PRAGMA journal_mode = WAL;");
      db.exec("PRAGMA busy_timeout = 5000;");
      db.exec("PRAGMA foreign_keys = ON;");
      db.exec(MIGRATION_V1);
      db.prepare("INSERT OR IGNORE INTO meta (key, value) VALUES (?, ?)").run("schema_version", "1");
      this.migrate(db);
      this.db = db;
      this.writeOk = true;
      this.lastError = null;
      this.ensureSeedTarget();
      this.ensureCallMgmtSeed();
      this.refreshSnapshot();
      this.log.info({ component: "sqlite", path: this.env.SQLITE_PATH }, "sqlite ready");
    } catch (err) {
      this.writeOk = false;
      this.lastError = err instanceof Error ? err.message : String(err);
      this.log.error({ component: "sqlite", err }, "sqlite open failed — using memory snapshot if any");
    }
  }

  status(): { ok: boolean; lastError: string | null; usingSnapshot: boolean } {
    return {
      ok: this.writeOk && this.db != null,
      lastError: this.lastError,
      usingSnapshot: this.snapshot != null && this.db == null,
    };
  }

  getTarget(): AsteriskTarget {
    if (this.snapshot) return this.snapshot.target;
    return this.seedFromEnv();
  }

  getSettings(): Record<string, string> {
    return this.snapshot?.settings ?? {};
  }

  putTarget(patch: Partial<Omit<AsteriskTarget, "updatedAt">>, actor: string): AsteriskTarget {
    const current = this.getTarget();
    const next: AsteriskTarget = {
      ...current,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    this.runWrite(() => {
      const db = this.requireDb();
      db.prepare(
        `INSERT INTO asterisk_targets (
            id, host, ami_port, ami_user, ami_password, ari_base_url, ari_user, ari_password, stasis_app, updated_at
          ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            host=excluded.host,
            ami_port=excluded.ami_port,
            ami_user=excluded.ami_user,
            ami_password=excluded.ami_password,
            ari_base_url=excluded.ari_base_url,
            ari_user=excluded.ari_user,
            ari_password=excluded.ari_password,
            stasis_app=excluded.stasis_app,
            updated_at=excluded.updated_at`,
      ).run(
        next.host,
        next.amiPort,
        next.amiUser,
        next.amiPassword || null,
        next.ariBaseUrl,
        next.ariUser,
        next.ariPassword || null,
        next.stasisApp,
        next.updatedAt,
      );
      db.prepare("INSERT INTO audit_log (at, actor, action, detail) VALUES (?, ?, ?, ?)").run(
        next.updatedAt,
        actor,
        "put_asterisk_target",
        JSON.stringify({ host: next.host }),
      );
    });
    this.refreshSnapshot();
    return this.getTarget();
  }

  putSetting(key: string, value: string, actor: string): void {
    this.runWrite(() => {
      const db = this.requireDb();
      db.prepare(
        "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      ).run(key, value);
      db.prepare("INSERT INTO audit_log (at, actor, action, detail) VALUES (?, ?, ?, ?)").run(
        new Date().toISOString(),
        actor,
        "put_setting",
        JSON.stringify({ key }),
      );
    });
    this.refreshSnapshot();
  }

  getTelephony(): TelephonyConfig {
    const s = this.getSettings();
    const desired = s.telephony_desired === "disconnect" ? "disconnect" : "connect";
    const retryDelayMs = Math.max(500, Number(s.telephony_retry_delay_ms ?? 5000) || 5000);
    return { desired, retryDelayMs };
  }

  putTelephony(patch: Partial<TelephonyConfig>, actor: string): TelephonyConfig {
    const current = this.getTelephony();
    const next: TelephonyConfig = {
      desired: patch.desired ?? current.desired,
      retryDelayMs: patch.retryDelayMs ?? current.retryDelayMs,
    };
    this.putSetting("telephony_desired", next.desired, actor);
    this.putSetting("telephony_retry_delay_ms", String(next.retryDelayMs), actor);
    return this.getTelephony();
  }

  listSetups(): CallSetup[] {
    if (!this.db) return [];
    const rows = this.db.prepare("SELECT * FROM call_setups ORDER BY id").all() as SetupRow[];
    return rows.map(mapSetup);
  }

  getSetup(id: number): CallSetup | null {
    if (!this.db) return null;
    const row = this.db.prepare("SELECT * FROM call_setups WHERE id = ?").get(id) as SetupRow | undefined;
    return row ? mapSetup(row) : null;
  }

  createSetup(
    input: { name: string; enabled?: boolean; matchDid?: string; matchTrunk?: string; maxConcurrent?: number },
    actor: string,
  ): CallSetup {
    const now = new Date().toISOString();
    let id = 0;
    this.runWrite(() => {
      const r = this.requireDb()
        .prepare(
          `INSERT INTO call_setups (name, enabled, match_did, match_trunk, max_concurrent, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.name,
          input.enabled === false ? 0 : 1,
          input.matchDid?.trim() || null,
          input.matchTrunk?.trim() || null,
          input.maxConcurrent ?? 10,
          now,
          now,
        );
      id = Number(r.lastInsertRowid);
      this.requireDb()
        .prepare("INSERT INTO audit_log (at, actor, action, detail) VALUES (?, ?, ?, ?)")
        .run(now, actor, "create_setup", JSON.stringify({ id, name: input.name }));
    });
    const created = this.getSetup(id);
    if (!created) throw new Error("failed to load created setup");
    return created;
  }

  updateSetup(id: number, patch: Partial<Omit<CallSetup, "id" | "createdAt" | "updatedAt">>, actor: string): CallSetup {
    const current = this.getSetup(id);
    if (!current) {
      throw Object.assign(new Error("setup not found"), { code: "NOT_FOUND" });
    }
    const next = {
      name: patch.name ?? current.name,
      enabled: patch.enabled ?? current.enabled,
      matchDid: patch.matchDid !== undefined ? patch.matchDid : current.matchDid,
      matchTrunk: patch.matchTrunk !== undefined ? patch.matchTrunk : current.matchTrunk,
      maxConcurrent: patch.maxConcurrent ?? current.maxConcurrent,
    };
    const now = new Date().toISOString();
    this.runWrite(() => {
      this.requireDb()
        .prepare(
          `UPDATE call_setups SET name=?, enabled=?, match_did=?, match_trunk=?, max_concurrent=?, updated_at=?
           WHERE id=?`,
        )
        .run(
          next.name,
          next.enabled ? 1 : 0,
          next.matchDid.trim() || null,
          next.matchTrunk.trim() || null,
          next.maxConcurrent,
          now,
          id,
        );
      this.requireDb()
        .prepare("INSERT INTO audit_log (at, actor, action, detail) VALUES (?, ?, ?, ?)")
        .run(now, actor, "update_setup", JSON.stringify({ id }));
    });
    const updated = this.getSetup(id);
    if (!updated) throw new Error("failed to load updated setup");
    return updated;
  }

  listPulseApis(): PulseApiConfig[] {
    if (!this.db) return [];
    const rows = this.db.prepare("SELECT * FROM pulse_apis ORDER BY slot").all() as PulseRow[];
    return rows.map(mapPulse);
  }

  getPulseApi(slot: PulseApiSlot): PulseApiConfig | null {
    if (!this.db) return null;
    const row = this.db.prepare("SELECT * FROM pulse_apis WHERE slot = ?").get(slot) as PulseRow | undefined;
    return row ? mapPulse(row) : null;
  }

  putPulseApi(slot: PulseApiSlot, patch: Partial<Omit<PulseApiConfig, "slot" | "updatedAt">>, actor: string): PulseApiConfig {
    const current = this.getPulseApi(slot);
    if (!current) {
      throw Object.assign(new Error("unknown pulse api slot"), { code: "NOT_FOUND" });
    }
    const now = new Date().toISOString();
    const next: PulseApiConfig = {
      slot,
      method: patch.method ?? current.method,
      endpoint: patch.endpoint ?? current.endpoint,
      timeoutMs: patch.timeoutMs ?? current.timeoutMs,
      retries: patch.retries ?? current.retries,
      updatedAt: now,
    };
    this.runWrite(() => {
      this.requireDb()
        .prepare(
          `UPDATE pulse_apis SET method=?, endpoint=?, timeout_ms=?, retries=?, updated_at=? WHERE slot=?`,
        )
        .run(next.method, next.endpoint, next.timeoutMs, next.retries, now, slot);
      this.requireDb()
        .prepare("INSERT INTO audit_log (at, actor, action, detail) VALUES (?, ?, ?, ?)")
        .run(now, actor, "put_pulse_api", JSON.stringify({ slot }));
    });
    return this.getPulseApi(slot)!;
  }

  upsertSession(session: CallSession): void {
    try {
      this.runWrite(() => {
        this.requireDb()
          .prepare(
            `INSERT INTO call_sessions (
              session_id, unique_id, channel, setup_id, interaction_id, caller_id, did, trunk,
              state, caller_type, ivr_pointer, customer_json, reject_reason, started_at, ended_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(session_id) DO UPDATE SET
              unique_id=excluded.unique_id,
              channel=excluded.channel,
              setup_id=excluded.setup_id,
              interaction_id=excluded.interaction_id,
              caller_id=excluded.caller_id,
              did=excluded.did,
              trunk=excluded.trunk,
              state=excluded.state,
              caller_type=excluded.caller_type,
              ivr_pointer=excluded.ivr_pointer,
              customer_json=excluded.customer_json,
              reject_reason=excluded.reject_reason,
              ended_at=excluded.ended_at`,
          )
          .run(
            session.sessionId,
            session.uniqueId,
            session.channel,
            session.setupId,
            session.interactionId,
            session.callerId,
            session.did,
            session.trunk,
            session.state,
            session.callerType,
            session.ivrPointer,
            session.customer == null ? null : JSON.stringify(session.customer),
            session.rejectReason,
            session.startedAt,
            session.endedAt,
          );
      });
    } catch {
      // snapshot retained; call still lives in memory
    }
  }

  listRecentSessions(limit = 50): CallSession[] {
    if (!this.db) return [];
    const rows = this.db
      .prepare("SELECT * FROM call_sessions ORDER BY started_at DESC LIMIT ?")
      .all(limit) as SessionRow[];
    return rows.map(mapSession);
  }

  private migrate(db: DatabaseSync): void {
    const row = db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as
      | { value: string }
      | undefined;
    let version = Number(row?.value ?? 0);
    if (version < 2) {
      db.exec(MIGRATION_V2);
      db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', '2')").run();
      version = 2;
    }
  }

  private ensureCallMgmtSeed(): void {
    if (!this.db) return;
    const now = new Date().toISOString();
    this.db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('telephony_desired', 'connect')").run();
    this.db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('telephony_retry_delay_ms', '5000')").run();
    const slots: PulseApiSlot[] = ["preAnswer", "startSession"];
    const ins = this.db.prepare(
      `INSERT OR IGNORE INTO pulse_apis (slot, method, endpoint, timeout_ms, retries, updated_at)
       VALUES (?, 'POST', '', 5000, 0, ?)`,
    );
    for (const slot of slots) ins.run(slot, now);
  }

  private runWrite(fn: () => void): void {
    try {
      fn();
      this.writeOk = true;
      this.lastError = null;
    } catch (err) {
      this.writeOk = false;
      this.lastError = err instanceof Error ? err.message : String(err);
      this.log.error({ component: "sqlite", err }, "sqlite write failed — snapshot retained");
      const error = new Error(this.lastError);
      (error as { code?: string }).code = "SQLITE_WRITE_FAILED";
      throw error;
    }
  }

  private requireDb(): DatabaseSync {
    if (!this.db) {
      throw new Error("sqlite is not open");
    }
    return this.db;
  }

  private ensureSeedTarget(): void {
    if (!this.db) return;
    const row = this.db.prepare("SELECT 1 AS ok FROM asterisk_targets WHERE id = 1").get() as
      | { ok: number }
      | undefined;
    if (row) return;
    const seed = this.seedFromEnv();
    this.db
      .prepare(
        `INSERT INTO asterisk_targets (
          id, host, ami_port, ami_user, ami_password, ari_base_url, ari_user, ari_password, stasis_app, updated_at
        ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        seed.host,
        seed.amiPort,
        seed.amiUser,
        null,
        seed.ariBaseUrl,
        seed.ariUser,
        null,
        seed.stasisApp,
        seed.updatedAt,
      );
    this.db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run("stasis_app", seed.stasisApp);
  }

  private refreshSnapshot(): void {
    if (!this.db) return;
    try {
      const row = this.db.prepare("SELECT * FROM asterisk_targets WHERE id = 1").get() as TargetRow | undefined;
      const settingsRows = this.db.prepare("SELECT key, value FROM settings").all() as Array<{
        key: string;
        value: string;
      }>;
      const settings: Record<string, string> = {};
      for (const s of settingsRows) settings[s.key] = s.value;
      if (!row) return;
      const target = this.applySecretOverrides({
        host: row.host,
        amiPort: row.ami_port,
        amiUser: row.ami_user,
        amiPassword: row.ami_password ?? "",
        ariBaseUrl: row.ari_base_url,
        ariUser: row.ari_user,
        ariPassword: row.ari_password ?? "",
        stasisApp: row.stasis_app,
        updatedAt: row.updated_at,
      });
      this.snapshot = { target, settings };
    } catch (err) {
      this.log.error({ component: "sqlite", err }, "failed to refresh snapshot");
    }
  }

  private applySecretOverrides(target: AsteriskTarget): AsteriskTarget {
    return {
      ...target,
      amiPassword: this.env.AMI_PASSWORD || target.amiPassword,
      ariPassword: this.env.ARI_PASSWORD || target.ariPassword,
    };
  }

  private seedFromEnv(): AsteriskTarget {
    return this.applySecretOverrides({
      host: this.env.ASTERISK_HOST,
      amiPort: this.env.AMI_PORT,
      amiUser: this.env.AMI_USER,
      amiPassword: this.env.AMI_PASSWORD,
      ariBaseUrl: this.env.ARI_BASE_URL,
      ariUser: this.env.ARI_USER,
      ariPassword: this.env.ARI_PASSWORD,
      stasisApp: this.env.STASIS_APP,
      updatedAt: new Date().toISOString(),
    });
  }
}

type SetupRow = {
  id: number;
  name: string;
  enabled: number;
  match_did: string | null;
  match_trunk: string | null;
  max_concurrent: number;
  created_at: string;
  updated_at: string;
};

type PulseRow = {
  slot: PulseApiSlot;
  method: PulseApiConfig["method"];
  endpoint: string;
  timeout_ms: number;
  retries: number;
  updated_at: string;
};

type SessionRow = {
  session_id: string;
  unique_id: string | null;
  channel: string | null;
  setup_id: number | null;
  interaction_id: string | null;
  caller_id: string | null;
  did: string | null;
  trunk: string | null;
  state: CallSession["state"];
  caller_type: string | null;
  ivr_pointer: string | null;
  customer_json: string | null;
  reject_reason: string | null;
  started_at: string;
  ended_at: string | null;
};

function mapSetup(row: SetupRow): CallSetup {
  return {
    id: row.id,
    name: row.name,
    enabled: row.enabled === 1,
    matchDid: row.match_did ?? "",
    matchTrunk: row.match_trunk ?? "",
    maxConcurrent: row.max_concurrent,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapPulse(row: PulseRow): PulseApiConfig {
  return {
    slot: row.slot,
    method: row.method,
    endpoint: row.endpoint,
    timeoutMs: row.timeout_ms,
    retries: row.retries,
    updatedAt: row.updated_at,
  };
}

function mapSession(row: SessionRow): CallSession {
  let customer: unknown = null;
  if (row.customer_json) {
    try {
      customer = JSON.parse(row.customer_json);
    } catch {
      customer = row.customer_json;
    }
  }
  return {
    sessionId: row.session_id,
    uniqueId: row.unique_id ?? "",
    channel: row.channel ?? "",
    setupId: row.setup_id,
    interactionId: row.interaction_id,
    callerId: row.caller_id ?? "",
    did: row.did ?? "",
    trunk: row.trunk ?? "",
    state: row.state,
    callerType: row.caller_type,
    ivrPointer: row.ivr_pointer,
    customer,
    rejectReason: row.reject_reason,
    startedAt: row.started_at,
    endedAt: row.ended_at,
  };
}
