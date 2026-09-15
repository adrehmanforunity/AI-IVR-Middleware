import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Env } from "../config/env.js";
import type { Logger } from "../logging/index.js";
import type { AsteriskTarget } from "../asterisk/types.js";
import { MIGRATION_V1 } from "./migrations/001_init.js";
import { MIGRATION_V2 } from "./migrations/002_call_mgmt.js";
import { MIGRATION_V3 } from "./migrations/003_users.js";
import { hashPassword, newSessionToken, verifyPassword } from "../auth/password.js";
import type {
  CallSession,
  CallSetup,
  Ivr,
  IvrCustomFunction,
  IvrCustomFunctionInput,
  IvrFunctionDef,
  IvrMenu,
  IvrMenuDraft,
  IvrSaveInput,
  OutboundRoute,
  OutboundRouteInput,
  PulseApiConfig,
  PulseApiSlot,
  StationDirectory,
  TelephonyConfig,
} from "../domain/types.js";
import { MIGRATION_V6 } from "./migrations/006_ivr.js";
import { MIGRATION_V7 } from "./migrations/007_ivr_document.js";
import { MIGRATION_V8 } from "./migrations/008_call_progress.js";
import { MIGRATION_V9 } from "./migrations/009_stations.js";
import { MIGRATION_V10 } from "./migrations/010_outbound_routes.js";
import { MIGRATION_V11 } from "./migrations/011_pulse_screen_facts.js";
import { MIGRATION_V12 } from "./migrations/012_post_call_survey.js";
import { GENERIC_FUNCTIONS } from "../ivr/catalog.js";
import { LEGACY_PULSE_SLOTS, LEGACY_SLOT_REMAP, PULSE_API_SEEDS } from "../pulse/seed.js";
import { PULSE_API_KEY_SETTING } from "../pulse/auth.js";
import { normalizeSave, normalizeMenu } from "../ivr/document.js";
import { LAB_SAMPLE_IVR, LAB_SAMPLE_IVR_NAME } from "../ivr/labSample.js";
import { MENU_DEFAULT_VALUES } from "../ivr/menuDefaults.js";
import { parseSmtp, SMTP_DEFAULTS, SMTP_SETTING_KEYS, type SmtpConfig } from "../mail/smtp.js";
import { parseCallerLanguage } from "../calls/progress.js";
import { effectiveSurveyIvrId } from "../calls/survey.js";
import {
  INSTANCE_DESC_KEY,
  INSTANCE_ID_KEY,
  INSTANCE_NAME_KEY,
  newInstanceId,
  normalizeInstanceDescription,
  normalizeInstanceId,
  normalizeInstanceName,
  parseInstance,
  type IimInstance,
} from "../instance/identity.js";
import { DEFAULT_OWNED_EXT_FROM, DEFAULT_OWNED_EXT_TO, parseOwnedExtensions } from "../calls/match.js";

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

export type AuthUser = {
  id: number;
  username: string;
  role: string;
  createdAt: string;
  updatedAt: string;
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
      this.ensureSuperadmin();
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

  getInstance(): IimInstance {
    return parseInstance(this.getSettings());
  }

  getPulseApiKey(): string {
    return (this.getSettings()[PULSE_API_KEY_SETTING] ?? "").trim();
  }

  putPulseApiKey(apiKey: string, actor: string): { keySet: boolean } {
    this.putSetting(PULSE_API_KEY_SETTING, apiKey.trim(), actor);
    return { keySet: this.getPulseApiKey().length > 0 };
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
    let stored = key === "pulse_swagger_url" ? normalizeHttpUrl(value) : value;
    if (key === INSTANCE_ID_KEY) {
      stored = normalizeInstanceId(value);
      if (!stored) {
        throw Object.assign(
          new Error("instance id must be 2–64 letters, numbers, dots, hyphens, or underscores"),
          { code: "BAD_REQUEST" },
        );
      }
    }
    if (key === INSTANCE_NAME_KEY) {
      stored = normalizeInstanceName(value);
      if (!stored) {
        throw Object.assign(new Error("instance name is required"), { code: "BAD_REQUEST" });
      }
    }
    if (key === INSTANCE_DESC_KEY) {
      stored = normalizeInstanceDescription(value);
    }
    this.runWrite(() => {
      const db = this.requireDb();
      db.prepare(
        "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      ).run(key, stored);
      db.prepare("INSERT INTO audit_log (at, actor, action, detail) VALUES (?, ?, ?, ?)").run(
        new Date().toISOString(),
        actor,
        "put_setting",
        JSON.stringify({ key }),
      );
    });
    this.refreshSnapshot();
  }

  listStations(): StationDirectory[] {
    if (!this.db) return [];
    const rows = this.db.prepare("SELECT * FROM stations ORDER BY CAST(extension AS INTEGER)").all() as StationRowDb[];
    return rows.map(mapStation);
  }

  putStation(
    extension: string,
    input: { displayName?: string; agentId?: string; notes?: string },
    actor: string,
  ): StationDirectory {
    const now = new Date().toISOString();
    const existing = this.db
      ? (this.db.prepare("SELECT * FROM stations WHERE extension = ?").get(extension) as StationRowDb | undefined)
      : undefined;
    const current = existing ? mapStation(existing) : undefined;
    const row: StationDirectory = {
      extension,
      displayName: input.displayName !== undefined ? input.displayName.trim() : (current?.displayName ?? ""),
      agentId: input.agentId !== undefined ? input.agentId.trim() : (current?.agentId ?? ""),
      notes: input.notes !== undefined ? input.notes.trim() : (current?.notes ?? ""),
      updatedAt: now,
    };
    this.runWrite(() => {
      this.requireDb()
        .prepare(
          `INSERT INTO stations (extension, display_name, agent_id, notes, updated_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(extension) DO UPDATE SET
             display_name=excluded.display_name,
             agent_id=excluded.agent_id,
             notes=excluded.notes,
             updated_at=excluded.updated_at`,
        )
        .run(row.extension, row.displayName, row.agentId, row.notes, row.updatedAt);
      this.requireDb()
        .prepare("INSERT INTO audit_log (at, actor, action, detail) VALUES (?, ?, ?, ?)")
        .run(now, actor, "put_station", JSON.stringify({ extension }));
    });
    return row;
  }

  getTelephony(): TelephonyConfig {
    const s = this.getSettings();
    const legacyDesired = s.telephony_desired === "disconnect" ? "disconnect" : "connect";
    const legacyRetry = Math.max(500, Number(s.telephony_retry_delay_ms ?? 5000) || 5000);
    const owned = parseOwnedExtensions(
      this.env.IIM_OWNED_EXT_FROM ?? s.iim_owned_ext_from ?? DEFAULT_OWNED_EXT_FROM,
      this.env.IIM_OWNED_EXT_TO ?? s.iim_owned_ext_to ?? DEFAULT_OWNED_EXT_TO,
    );
    return {
      ami: {
        desired: (s.telephony_ami_desired ?? legacyDesired) === "disconnect" ? "disconnect" : "connect",
        retryDelayMs: Math.max(500, Number(s.telephony_ami_retry_delay_ms ?? legacyRetry) || legacyRetry),
        connectTimeoutMs: Math.max(500, Number(s.telephony_ami_connect_timeout_ms ?? 8000) || 8000),
      },
      ari: {
        desired: (s.telephony_ari_desired ?? legacyDesired) === "disconnect" ? "disconnect" : "connect",
        retryDelayMs: Math.max(500, Number(s.telephony_ari_retry_delay_ms ?? legacyRetry) || legacyRetry),
        connectTimeoutMs: Math.max(500, Number(s.telephony_ari_connect_timeout_ms ?? 8000) || 8000),
      },
      ownedExtensions: owned,
    };
  }

  getSmtp(): SmtpConfig {
    return parseSmtp(this.getSettings());
  }

  putSmtp(patch: Partial<SmtpConfig>, actor: string): SmtpConfig {
    const current = this.getSmtp();
    const next: SmtpConfig = {
      ...current,
      ...patch,
      password: patch.password != null && patch.password !== "" ? patch.password : current.password,
    };
    const k = SMTP_SETTING_KEYS;
    this.putSetting(k.enabled, next.enabled ? "1" : "0", actor);
    this.putSetting(k.host, next.host, actor);
    this.putSetting(k.port, String(next.port), actor);
    this.putSetting(k.security, next.security, actor);
    this.putSetting(k.auth, next.auth, actor);
    this.putSetting(k.user, next.user, actor);
    if (patch.password != null && patch.password !== "") this.putSetting(k.password, next.password, actor);
    this.putSetting(k.from, next.from, actor);
    this.putSetting(k.fromName, next.fromName, actor);
    this.putSetting(k.replyTo, next.replyTo, actor);
    this.putSetting(k.helo, next.helo, actor);
    this.putSetting(k.timeoutMs, String(next.timeoutMs), actor);
    this.putSetting(k.rejectUnauthorized, next.rejectUnauthorized ? "1" : "0", actor);
    this.putSetting(k.adminTo, next.adminTo, actor);
    this.putSetting(k.businessTo, next.businessTo, actor);
    this.putSetting(k.cooldownSec, String(next.cooldownSec), actor);
    return this.getSmtp();
  }

  putTelephony(
    patch: {
      ami?: Partial<TelephonyConfig["ami"]>;
      ari?: Partial<TelephonyConfig["ari"]>;
      ownedExtensions?: Partial<TelephonyConfig["ownedExtensions"]>;
    },
    actor: string,
  ): TelephonyConfig {
    const current = this.getTelephony();
    const ami = { ...current.ami, ...patch.ami };
    const ari = { ...current.ari, ...patch.ari };
    const owned = parseOwnedExtensions(
      patch.ownedExtensions?.from ?? current.ownedExtensions.from,
      patch.ownedExtensions?.to ?? current.ownedExtensions.to,
    );
    this.putSetting("telephony_ami_desired", ami.desired, actor);
    this.putSetting("telephony_ami_retry_delay_ms", String(ami.retryDelayMs), actor);
    this.putSetting("telephony_ami_connect_timeout_ms", String(ami.connectTimeoutMs), actor);
    this.putSetting("telephony_ari_desired", ari.desired, actor);
    this.putSetting("telephony_ari_retry_delay_ms", String(ari.retryDelayMs), actor);
    this.putSetting("telephony_ari_connect_timeout_ms", String(ari.connectTimeoutMs), actor);
    this.putSetting("iim_owned_ext_from", String(owned.from), actor);
    this.putSetting("iim_owned_ext_to", String(owned.to), actor);
    return this.getTelephony();
  }

  passwordOverrides(): { amiFromEnv: boolean; ariFromEnv: boolean } {
    return {
      amiFromEnv: Boolean(this.env.AMI_PASSWORD),
      ariFromEnv: Boolean(this.env.ARI_PASSWORD),
    };
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
    input: {
      name: string;
      enabled?: boolean;
      matchDid?: string;
      matchTrunk?: string;
      maxConcurrent?: number;
      ivrId?: number | null;
      postCallSurveyEnabled?: boolean;
      postCallSurveyIvrId?: number | null;
    },
    actor: string,
  ): CallSetup {
    const now = new Date().toISOString();
    const surveyOn = input.postCallSurveyEnabled === true;
    const surveyIvr = input.postCallSurveyIvrId ?? null;
    requireSurveyIvr(surveyOn, surveyIvr);
    let id = 0;
    this.runWrite(() => {
      const r = this.requireDb()
        .prepare(
          `INSERT INTO call_setups (name, enabled, match_did, match_trunk, max_concurrent, ivr_id,
            post_call_survey_enabled, post_call_survey_ivr_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.name,
          input.enabled === false ? 0 : 1,
          input.matchDid?.trim() || null,
          input.matchTrunk?.trim() || null,
          input.maxConcurrent ?? 10,
          input.ivrId ?? null,
          surveyOn ? 1 : 0,
          surveyIvr,
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
      ivrId: patch.ivrId !== undefined ? patch.ivrId : current.ivrId,
      postCallSurveyEnabled: patch.postCallSurveyEnabled ?? current.postCallSurveyEnabled,
      postCallSurveyIvrId:
        patch.postCallSurveyIvrId !== undefined ? patch.postCallSurveyIvrId : current.postCallSurveyIvrId,
    };
    requireSurveyIvr(next.postCallSurveyEnabled, next.postCallSurveyIvrId);
    const now = new Date().toISOString();
    this.runWrite(() => {
      this.requireDb()
        .prepare(
          `UPDATE call_setups SET name=?, enabled=?, match_did=?, match_trunk=?, max_concurrent=?, ivr_id=?,
            post_call_survey_enabled=?, post_call_survey_ivr_id=?, updated_at=?
           WHERE id=?`,
        )
        .run(
          next.name,
          next.enabled ? 1 : 0,
          next.matchDid.trim() || null,
          next.matchTrunk.trim() || null,
          next.maxConcurrent,
          next.ivrId,
          next.postCallSurveyEnabled ? 1 : 0,
          next.postCallSurveyIvrId,
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

  deleteSetup(id: number, actor: string): void {
    const current = this.getSetup(id);
    if (!current) {
      throw Object.assign(new Error("setup not found"), { code: "NOT_FOUND" });
    }
    this.runWrite(() => {
      this.requireDb().prepare("DELETE FROM call_setups WHERE id = ?").run(id);
      this.requireDb()
        .prepare("INSERT INTO audit_log (at, actor, action, detail) VALUES (?, ?, ?, ?)")
        .run(new Date().toISOString(), actor, "delete_setup", JSON.stringify({ id, name: current.name }));
    });
  }

  listOutboundRoutes(): OutboundRoute[] {
    if (!this.db) return [];
    const rows = this.db.prepare("SELECT * FROM outbound_routes ORDER BY id").all() as OutboundRow[];
    return rows.map(mapOutbound);
  }

  getOutboundRoute(id: number): OutboundRoute | null {
    if (!this.db) return null;
    const row = this.db.prepare("SELECT * FROM outbound_routes WHERE id = ?").get(id) as OutboundRow | undefined;
    return row ? mapOutbound(row) : null;
  }

  createOutboundRoute(input: OutboundRouteInput, actor: string): OutboundRoute {
    const name = input.name.trim();
    const trunk = input.trunk.trim();
    if (!name || !trunk) {
      throw Object.assign(new Error("name and trunk are required"), { code: "BAD_REQUEST" });
    }
    const audience = normalizeAudience(input.audience);
    const surveyOn = input.postCallSurveyEnabled === true;
    const surveyIvr = input.postCallSurveyIvrId ?? null;
    requireSurveyIvr(surveyOn, surveyIvr);
    const now = new Date().toISOString();
    let id = 0;
    this.runWrite(() => {
      const r = this.requireDb()
        .prepare(
          `INSERT INTO outbound_routes (name, description, trunk, audience, enabled,
            post_call_survey_enabled, post_call_survey_ivr_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          name,
          (input.description ?? "").trim(),
          trunk,
          audience,
          input.enabled === false ? 0 : 1,
          surveyOn ? 1 : 0,
          surveyIvr,
          now,
          now,
        );
      id = Number(r.lastInsertRowid);
      this.requireDb()
        .prepare("INSERT INTO audit_log (at, actor, action, detail) VALUES (?, ?, ?, ?)")
        .run(now, actor, "create_outbound_route", JSON.stringify({ id, name }));
    });
    const created = this.getOutboundRoute(id);
    if (!created) throw new Error("failed to load outbound route");
    return created;
  }

  updateOutboundRoute(id: number, patch: Partial<OutboundRouteInput>, actor: string): OutboundRoute {
    const current = this.getOutboundRoute(id);
    if (!current) throw Object.assign(new Error("outbound route not found"), { code: "NOT_FOUND" });
    const next = {
      name: (patch.name ?? current.name).trim(),
      description: patch.description !== undefined ? patch.description.trim() : current.description,
      trunk: (patch.trunk ?? current.trunk).trim(),
      audience: patch.audience ? normalizeAudience(patch.audience) : current.audience,
      enabled: patch.enabled ?? current.enabled,
      postCallSurveyEnabled: patch.postCallSurveyEnabled ?? current.postCallSurveyEnabled,
      postCallSurveyIvrId:
        patch.postCallSurveyIvrId !== undefined ? patch.postCallSurveyIvrId : current.postCallSurveyIvrId,
    };
    if (!next.name || !next.trunk) {
      throw Object.assign(new Error("name and trunk are required"), { code: "BAD_REQUEST" });
    }
    requireSurveyIvr(next.postCallSurveyEnabled, next.postCallSurveyIvrId);
    const now = new Date().toISOString();
    this.runWrite(() => {
      this.requireDb()
        .prepare(
          `UPDATE outbound_routes SET name=?, description=?, trunk=?, audience=?, enabled=?,
            post_call_survey_enabled=?, post_call_survey_ivr_id=?, updated_at=? WHERE id=?`,
        )
        .run(
          next.name,
          next.description,
          next.trunk,
          next.audience,
          next.enabled ? 1 : 0,
          next.postCallSurveyEnabled ? 1 : 0,
          next.postCallSurveyIvrId,
          now,
          id,
        );
      this.requireDb()
        .prepare("INSERT INTO audit_log (at, actor, action, detail) VALUES (?, ?, ?, ?)")
        .run(now, actor, "update_outbound_route", JSON.stringify({ id }));
    });
    const updated = this.getOutboundRoute(id);
    if (!updated) throw new Error("failed to load outbound route");
    return updated;
  }

  deleteOutboundRoute(id: number, actor: string): void {
    const current = this.getOutboundRoute(id);
    if (!current) throw Object.assign(new Error("outbound route not found"), { code: "NOT_FOUND" });
    this.runWrite(() => {
      this.requireDb().prepare("DELETE FROM outbound_routes WHERE id = ?").run(id);
      this.requireDb()
        .prepare("INSERT INTO audit_log (at, actor, action, detail) VALUES (?, ?, ?, ?)")
        .run(new Date().toISOString(), actor, "delete_outbound_route", JSON.stringify({ id, name: current.name }));
    });
  }

  listIvrs(): Ivr[] {
    if (!this.db) return [];
    const heads = this.db.prepare("SELECT * FROM ivrs ORDER BY id").all() as IvrRow[];
    return heads.map((row) => this.hydrateIvr(row));
  }

  getIvr(id: number): Ivr | null {
    if (!this.db) return null;
    const row = this.db.prepare("SELECT * FROM ivrs WHERE id = ?").get(id) as IvrRow | undefined;
    return row ? this.hydrateIvr(row) : null;
  }

  createIvr(input: IvrSaveInput, actor: string): Ivr {
    const doc = normalizeSave(input);
    const now = new Date().toISOString();
    let id = 0;
    this.runWrite(() => {
      const db = this.requireDb();
      const r = db
        .prepare(
          "INSERT INTO ivrs (name, enabled, created_at, updated_at, document, entry_key) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .run(
          input.name.trim() || "IVR",
          input.enabled === false ? 0 : 1,
          now,
          now,
          JSON.stringify({ entryKey: doc.entryKey, menus: doc.menus }),
          doc.entryKey,
        );
      id = Number(r.lastInsertRowid);
      db.prepare("INSERT INTO audit_log (at, actor, action, detail) VALUES (?, ?, ?, ?)").run(
        now,
        actor,
        "create_ivr",
        JSON.stringify({ id, name: input.name }),
      );
    });
    const created = this.getIvr(id);
    if (!created) throw new Error("failed to load created ivr");
    return created;
  }

  updateIvr(id: number, input: IvrSaveInput, actor: string): Ivr {
    const current = this.getIvr(id);
    if (!current) throw Object.assign(new Error("ivr not found"), { code: "NOT_FOUND" });
    const doc = normalizeSave(input);
    const now = new Date().toISOString();
    this.runWrite(() => {
      const db = this.requireDb();
      db.prepare("UPDATE ivrs SET name=?, enabled=?, document=?, entry_key=?, updated_at=? WHERE id=?").run(
        input.name.trim() || current.name,
        input.enabled === false ? 0 : 1,
        JSON.stringify({ entryKey: doc.entryKey, menus: doc.menus }),
        doc.entryKey,
        now,
        id,
      );
      db.prepare("INSERT INTO audit_log (at, actor, action, detail) VALUES (?, ?, ?, ?)").run(
        now,
        actor,
        "update_ivr",
        JSON.stringify({ id }),
      );
    });
    const updated = this.getIvr(id);
    if (!updated) throw new Error("failed to load updated ivr");
    return updated;
  }

  deleteIvr(id: number, actor: string): void {
    const current = this.getIvr(id);
    if (!current) throw Object.assign(new Error("ivr not found"), { code: "NOT_FOUND" });
    this.runWrite(() => {
      const db = this.requireDb();
      db.prepare("UPDATE call_setups SET ivr_id = NULL WHERE ivr_id = ?").run(id);
      db.prepare("DELETE FROM ivrs WHERE id = ?").run(id);
      db.prepare("INSERT INTO audit_log (at, actor, action, detail) VALUES (?, ?, ?, ?)").run(
        new Date().toISOString(),
        actor,
        "delete_ivr",
        JSON.stringify({ id, name: current.name }),
      );
    });
  }

  private hydrateIvr(row: IvrRow): Ivr {
    const parsed = parseIvrDocument(row.document, row.entry_key);
    return {
      id: row.id,
      name: row.name,
      enabled: row.enabled === 1,
      entryKey: parsed.entryKey,
      menus: parsed.menus,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  listIvrFunctionCatalog(): IvrFunctionDef[] {
    const custom = this.listCustomIvrFunctions().map(
      (f): IvrFunctionDef => ({
        name: f.name,
        kind: "pulse",
        source: "custom",
        description: f.description,
        pulseSlot: f.pulseSlot,
        paramHint: f.paramHint,
        enabled: f.enabled,
      }),
    );
    return [...GENERIC_FUNCTIONS, ...custom];
  }

  listCustomIvrFunctions(): IvrCustomFunction[] {
    if (!this.db) return [];
    const rows = this.db.prepare("SELECT * FROM ivr_functions ORDER BY name").all() as FnRow[];
    return rows.map(mapFn);
  }

  getCustomIvrFunction(id: number): IvrCustomFunction | null {
    if (!this.db) return null;
    const row = this.db.prepare("SELECT * FROM ivr_functions WHERE id = ?").get(id) as FnRow | undefined;
    return row ? mapFn(row) : null;
  }

  createCustomIvrFunction(input: IvrCustomFunctionInput, actor: string): IvrCustomFunction {
    const name = normalizeFnName(input.name);
    if (!name) throw Object.assign(new Error("function name is required"), { code: "BAD_REQUEST" });
    if (!input.pulseSlot?.trim()) throw Object.assign(new Error("PULSE API is required"), { code: "BAD_REQUEST" });
    const now = new Date().toISOString();
    let id = 0;
    this.runWrite(() => {
      const db = this.requireDb();
      try {
        const r = db
          .prepare(
            `INSERT INTO ivr_functions (name, description, pulse_slot, param_hint, enabled, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            name,
            (input.description ?? "").trim(),
            input.pulseSlot.trim(),
            (input.paramHint ?? "").trim(),
            input.enabled === false ? 0 : 1,
            now,
            now,
          );
        id = Number(r.lastInsertRowid);
      } catch (err) {
        throw Object.assign(new Error("function name already exists"), { code: "CONFLICT", cause: err });
      }
      db.prepare("INSERT INTO audit_log (at, actor, action, detail) VALUES (?, ?, ?, ?)").run(
        now,
        actor,
        "create_ivr_function",
        JSON.stringify({ id, name }),
      );
    });
    const created = this.getCustomIvrFunction(id);
    if (!created) throw new Error("failed to load function");
    return created;
  }

  updateCustomIvrFunction(id: number, input: Partial<IvrCustomFunctionInput>, actor: string): IvrCustomFunction {
    const current = this.getCustomIvrFunction(id);
    if (!current) throw Object.assign(new Error("function not found"), { code: "NOT_FOUND" });
    const name = input.name !== undefined ? normalizeFnName(input.name) : current.name;
    if (!name) throw Object.assign(new Error("function name is required"), { code: "BAD_REQUEST" });
    const now = new Date().toISOString();
    this.runWrite(() => {
      const db = this.requireDb();
      db.prepare(
        `UPDATE ivr_functions SET name=?, description=?, pulse_slot=?, param_hint=?, enabled=?, updated_at=? WHERE id=?`,
      ).run(
        name,
        input.description !== undefined ? input.description.trim() : current.description,
        input.pulseSlot !== undefined ? input.pulseSlot.trim() : current.pulseSlot,
        input.paramHint !== undefined ? input.paramHint.trim() : current.paramHint,
        input.enabled === undefined ? (current.enabled ? 1 : 0) : input.enabled ? 1 : 0,
        now,
        id,
      );
      db.prepare("INSERT INTO audit_log (at, actor, action, detail) VALUES (?, ?, ?, ?)").run(
        now,
        actor,
        "update_ivr_function",
        JSON.stringify({ id, name }),
      );
    });
    const updated = this.getCustomIvrFunction(id);
    if (!updated) throw new Error("failed to load function");
    return updated;
  }

  deleteCustomIvrFunction(id: number, actor: string): void {
    const current = this.getCustomIvrFunction(id);
    if (!current) throw Object.assign(new Error("function not found"), { code: "NOT_FOUND" });
    this.runWrite(() => {
      const db = this.requireDb();
      db.prepare("DELETE FROM ivr_functions WHERE id = ?").run(id);
      db.prepare("INSERT INTO audit_log (at, actor, action, detail) VALUES (?, ?, ?, ?)").run(
        new Date().toISOString(),
        actor,
        "delete_ivr_function",
        JSON.stringify({ id, name: current.name }),
      );
    });
  }

  listPulseApis(): PulseApiConfig[] {
    if (!this.db) return [];
    const rows = this.db.prepare("SELECT * FROM pulse_apis ORDER BY display_name, slot").all() as PulseRow[];
    return rows.map(mapPulse);
  }

  getPulseApi(slot: PulseApiSlot): PulseApiConfig | null {
    if (!this.db) return null;
    const row = this.db.prepare("SELECT * FROM pulse_apis WHERE slot = ?").get(slot) as PulseRow | undefined;
    return row ? mapPulse(row) : null;
  }

  createPulseApi(
    input: {
      slot: string;
      name: string;
      description?: string;
      method?: PulseApiConfig["method"];
      endpoint?: string;
      timeoutMs?: number;
      retries?: number;
      enabled?: boolean;
      mockEnabled?: boolean;
      mockJson?: string;
      mockStatus?: number | null;
      mockError?: string;
    },
    actor: string,
  ): PulseApiConfig {
    const slot = normalizeSlot(input.slot);
    if (!slot) {
      throw Object.assign(new Error("invalid api id"), { code: "BAD_REQUEST" });
    }
    if (this.getPulseApi(slot)) {
      throw Object.assign(new Error("api id already exists"), { code: "CONFLICT" });
    }
    const now = new Date().toISOString();
    this.runWrite(() => {
      this.requireDb()
        .prepare(
          `INSERT INTO pulse_apis (
            slot, method, endpoint, timeout_ms, retries, updated_at,
            display_name, description, mock_enabled, mock_json, mock_status, mock_error, enabled
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          slot,
          input.method ?? "POST",
          input.endpoint ?? "",
          input.timeoutMs ?? 5000,
          input.retries ?? 0,
          now,
          input.name.trim() || slot,
          input.description ?? "",
          input.mockEnabled ? 1 : 0,
          input.mockJson?.trim() || null,
          input.mockStatus ?? null,
          input.mockError?.trim() || null,
          input.enabled === false ? 0 : 1,
        );
      this.requireDb()
        .prepare("INSERT INTO audit_log (at, actor, action, detail) VALUES (?, ?, ?, ?)")
        .run(now, actor, "create_pulse_api", JSON.stringify({ slot }));
    });
    return this.getPulseApi(slot)!;
  }

  putPulseApi(slot: PulseApiSlot, patch: Partial<Omit<PulseApiConfig, "slot" | "updatedAt">>, actor: string): PulseApiConfig {
    const current = this.getPulseApi(slot);
    if (!current) {
      throw Object.assign(new Error("unknown pulse api"), { code: "NOT_FOUND" });
    }
    const now = new Date().toISOString();
    const next: PulseApiConfig = {
      ...current,
      ...patch,
      slot,
      name: patch.name !== undefined ? patch.name : current.name,
      description: patch.description !== undefined ? patch.description : current.description,
      mockJson: patch.mockJson !== undefined ? patch.mockJson : current.mockJson,
      mockError: patch.mockError !== undefined ? patch.mockError : current.mockError,
      mockStatus: patch.mockStatus !== undefined ? patch.mockStatus : current.mockStatus,
      mockEnabled: patch.mockEnabled !== undefined ? patch.mockEnabled : current.mockEnabled,
      enabled: patch.enabled !== undefined ? patch.enabled : current.enabled,
      updatedAt: now,
    };
    this.runWrite(() => {
      this.requireDb()
        .prepare(
          `UPDATE pulse_apis SET
            method=?, endpoint=?, timeout_ms=?, retries=?, updated_at=?,
            display_name=?, description=?, mock_enabled=?, mock_json=?, mock_status=?, mock_error=?, enabled=?
           WHERE slot=?`,
        )
        .run(
          next.method,
          next.endpoint,
          next.timeoutMs,
          next.retries,
          now,
          next.name,
          next.description,
          next.mockEnabled ? 1 : 0,
          next.mockJson || null,
          next.mockStatus,
          next.mockError || null,
          next.enabled ? 1 : 0,
          slot,
        );
      this.requireDb()
        .prepare("INSERT INTO audit_log (at, actor, action, detail) VALUES (?, ?, ?, ?)")
        .run(now, actor, "put_pulse_api", JSON.stringify({ slot }));
    });
    return this.getPulseApi(slot)!;
  }

  deletePulseApi(slot: PulseApiSlot, actor: string): void {
    if (!this.getPulseApi(slot)) {
      throw Object.assign(new Error("unknown pulse api"), { code: "NOT_FOUND" });
    }
    this.runWrite(() => {
      this.requireDb().prepare("DELETE FROM pulse_apis WHERE slot = ?").run(slot);
      this.requireDb()
        .prepare("INSERT INTO audit_log (at, actor, action, detail) VALUES (?, ?, ?, ?)")
        .run(new Date().toISOString(), actor, "delete_pulse_api", JSON.stringify({ slot }));
    });
  }

  upsertSession(session: CallSession): void {
    try {
      this.runWrite(() => {
        this.requireDb()
          .prepare(
            `INSERT INTO call_sessions (
              session_id, unique_id, channel, setup_id, interaction_id, caller_id, did, trunk,
              state, caller_type, ivr_pointer, customer_json, reject_reason, started_at, ended_at,
              pulse_session_id, agent_id, agent_extension, bridge_id, language, queue_position, expected_wait_sec,
              is_cli_already_exist, ivr_routing, is_priority, is_high_alert, recording_relative_path
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
              ended_at=excluded.ended_at,
              pulse_session_id=excluded.pulse_session_id,
              agent_id=excluded.agent_id,
              agent_extension=excluded.agent_extension,
              bridge_id=excluded.bridge_id,
              language=excluded.language,
              queue_position=excluded.queue_position,
              expected_wait_sec=excluded.expected_wait_sec,
              is_cli_already_exist=excluded.is_cli_already_exist,
              ivr_routing=excluded.ivr_routing,
              is_priority=excluded.is_priority,
              is_high_alert=excluded.is_high_alert,
              recording_relative_path=excluded.recording_relative_path`,
          )
          .run(
            session.internalId,
            session.uniqueId,
            session.channel,
            session.setupId,
            session.interactionId,
            session.callerId,
            session.did,
            session.trunk,
            session.state,
            session.callerType,
            session.currentMenu,
            session.customer == null ? null : JSON.stringify(session.customer),
            session.rejectReason,
            session.startedAt,
            session.endedAt,
            session.pulseSessionId,
            session.agentId,
            session.agentExtension,
            session.bridgeId,
            session.language,
            session.queuePosition,
            session.expectedWaitSec,
            sqlBool(session.isCliAlreadyExist),
            session.ivrRouting,
            sqlBool(session.isPriority),
            sqlBool(session.isHighAlert),
            session.recordingRelativePath || "",
          );
      });
    } catch {
      this.log.warn({ component: "sqlite", session: session.internalId }, "session persist failed — call stays in memory");
    }
  }

  listRecentSessions(limit = 50): CallSession[] {
    if (!this.db) return [];
    const rows = this.db
      .prepare("SELECT * FROM call_sessions ORDER BY started_at DESC LIMIT ?")
      .all(limit) as SessionRow[];
    return rows.map(mapSession);
  }

  sessionHistory(sinceIso: string): Array<{
    state: string;
    rejectReason: string | null;
    startedAt: string;
    endedAt: string | null;
    did: string;
    trunk: string;
  }> {
    if (!this.db) return [];
    const rows = this.db
      .prepare(
        "SELECT state, reject_reason, started_at, ended_at, did, trunk FROM call_sessions WHERE started_at >= ? ORDER BY started_at ASC",
      )
      .all(sinceIso) as Array<{
      state: string;
      reject_reason: string | null;
      started_at: string;
      ended_at: string | null;
      did: string | null;
      trunk: string | null;
    }>;
    return rows.map((r) => ({
      state: r.state,
      rejectReason: r.reject_reason,
      startedAt: r.started_at,
      endedAt: r.ended_at,
      did: r.did ?? "",
      trunk: r.trunk ?? "",
    }));
  }

  authenticateUser(username: string, password: string): AuthUser | null {
    if (!this.db) return null;
    const row = this.db.prepare("SELECT * FROM users WHERE username = ?").get(username.trim()) as
      | UserRow
      | undefined;
    if (!row) return null;
    if (!verifyPassword(password, row.password_hash)) return null;
    return mapUser(row);
  }

  getUserById(id: number): AuthUser | null {
    if (!this.db) return null;
    const row = this.db.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow | undefined;
    return row ? mapUser(row) : null;
  }

  createSession(userId: number, ttlHours = 12): string {
    const token = newSessionToken();
    const now = new Date();
    const expires = new Date(now.getTime() + ttlHours * 3600 * 1000).toISOString();
    this.runWrite(() => {
      this.requireDb()
        .prepare("INSERT INTO sessions (token, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)")
        .run(token, userId, expires, now.toISOString());
    });
    return token;
  }

  userForSession(token: string): AuthUser | null {
    if (!this.db || !token) return null;
    const row = this.db
      .prepare(
        `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.token = ? AND s.expires_at > ?`,
      )
      .get(token, new Date().toISOString()) as UserRow | undefined;
    return row ? mapUser(row) : null;
  }

  deleteSession(token: string): void {
    if (!token) return;
    try {
      this.runWrite(() => {
        this.requireDb().prepare("DELETE FROM sessions WHERE token = ?").run(token);
      });
    } catch {
      // ignore
    }
  }

  updatePassword(userId: number, currentPassword: string, nextPassword: string): boolean {
    if (!this.db) return false;
    const row = this.db.prepare("SELECT * FROM users WHERE id = ?").get(userId) as UserRow | undefined;
    if (!row || !verifyPassword(currentPassword, row.password_hash)) return false;
    if (nextPassword.length < 8) return false;
    const now = new Date().toISOString();
    this.runWrite(() => {
      this.requireDb()
        .prepare("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?")
        .run(hashPassword(nextPassword), now, userId);
      this.requireDb().prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
    });
    return true;
  }

  private ensureSuperadmin(): void {
    if (!this.db) return;
    const count = this.db.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number };
    if (count.n > 0) return;
    const username = this.env.SUPERADMIN_USER.trim() || "superadmin";
    const password = this.env.SUPERADMIN_PASSWORD;
    const now = new Date().toISOString();
    this.db
      .prepare(
        "INSERT INTO users (username, password_hash, role, created_at, updated_at) VALUES (?, ?, 'superadmin', ?, ?)",
      )
      .run(username, hashPassword(password), now, now);
    this.log.info({ component: "auth", username }, "seeded superadmin from env (changeable in UI/DB)");
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
    if (version < 3) {
      db.exec(MIGRATION_V3);
      db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', '3')").run();
      version = 3;
    }
    if (version < 4) {
      migratePulseApiColumns(db);
      db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', '4')").run();
      version = 4;
    }
    if (version < 5) {
      migratePulseApiColumns(db);
      db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', '5')").run();
      version = 5;
    }
    if (version < 6) {
      db.exec(MIGRATION_V6);
      try {
        db.exec("ALTER TABLE call_setups ADD COLUMN ivr_id INTEGER");
      } catch {
        // already present
      }
      db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', '6')").run();
      version = 6;
    }
    if (version < 7) {
      try {
        db.exec(MIGRATION_V7);
      } catch {
        try {
          db.exec("ALTER TABLE ivrs ADD COLUMN document TEXT NOT NULL DEFAULT '{}'");
        } catch {
          /* already present */
        }
        try {
          db.exec("ALTER TABLE ivrs ADD COLUMN entry_key TEXT NOT NULL DEFAULT ''");
        } catch {
          /* already present */
        }
        db.exec(`CREATE TABLE IF NOT EXISTS ivr_functions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL UNIQUE,
          description TEXT NOT NULL DEFAULT '',
          pulse_slot TEXT NOT NULL,
          param_hint TEXT NOT NULL DEFAULT '',
          enabled INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )`);
      }
      convertLegacyIvrs(db);
      db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', '7')").run();
      version = 7;
    }
    if (version < 8) {
      for (const stmt of MIGRATION_V8.split(";").map((s) => s.trim()).filter(Boolean)) {
        try {
          db.exec(`${stmt};`);
        } catch {
          /* column already present */
        }
      }
      db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', '8')").run();
      version = 8;
    }
    if (version < 9) {
      db.exec(MIGRATION_V9);
      db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', '9')").run();
      version = 9;
    }
    if (version < 10) {
      db.exec(MIGRATION_V10);
      db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', '10')").run();
      version = 10;
    }
    if (version < 11) {
      for (const stmt of MIGRATION_V11.split(";").map((s) => s.trim()).filter(Boolean)) {
        try {
          db.exec(`${stmt};`);
        } catch {
          /* column already present */
        }
      }
      db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', '11')").run();
      version = 11;
    }
    if (version < 12) {
      for (const stmt of MIGRATION_V12.split(";").map((s) => s.trim()).filter(Boolean)) {
        try {
          db.exec(`${stmt};`);
        } catch {
          /* column already present */
        }
      }
      db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', '12')").run();
    }
  }

  private ensureCallMgmtSeed(): void {
    if (!this.db) return;
    this.db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('telephony_desired', 'connect')").run();
    this.db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('telephony_retry_delay_ms', '5000')").run();
    this.db
      .prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('telephony_ami_connect_timeout_ms', '8000')")
      .run();
    this.db
      .prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('telephony_ari_connect_timeout_ms', '8000')")
      .run();
    const setting = (key: string): string | undefined => {
      const row = this.db!.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
      return row?.value;
    };
    const legacyDesired = setting("telephony_desired") === "disconnect" ? "disconnect" : "connect";
    const legacyRetry = setting("telephony_retry_delay_ms") ?? "5000";
    this.db
      .prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('telephony_ami_desired', ?)")
      .run(legacyDesired);
    this.db
      .prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('telephony_ari_desired', ?)")
      .run(legacyDesired);
    this.db
      .prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('telephony_ami_retry_delay_ms', ?)")
      .run(legacyRetry);
    this.db
      .prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('telephony_ari_retry_delay_ms', ?)")
      .run(legacyRetry);
    this.db
      .prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('iim_owned_ext_from', ?)")
      .run(String(DEFAULT_OWNED_EXT_FROM));
    this.db
      .prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('iim_owned_ext_to', ?)")
      .run(String(DEFAULT_OWNED_EXT_TO));
    if (setting("iim_owned_ext_from") === "300" && setting("iim_owned_ext_to") === "399") {
      this.db.prepare("UPDATE settings SET value = ? WHERE key = 'iim_owned_ext_from'").run(String(DEFAULT_OWNED_EXT_FROM));
      this.db.prepare("UPDATE settings SET value = ? WHERE key = 'iim_owned_ext_to'").run(String(DEFAULT_OWNED_EXT_TO));
    }
    this.db
      .prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('pulse_swagger_url', ?)")
      .run("https://petstore.swagger.io/");
    this.db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)").run(INSTANCE_ID_KEY, newInstanceId());
    this.db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)").run(INSTANCE_NAME_KEY, "IIM");
    this.db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)").run(INSTANCE_DESC_KEY, "");
    const instanceId = setting(INSTANCE_ID_KEY);
    if (!instanceId?.trim()) {
      this.db.prepare("UPDATE settings SET value = ? WHERE key = ?").run(newInstanceId(), INSTANCE_ID_KEY);
    }
    this.db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES (?, '')").run(PULSE_API_KEY_SETTING);
    const smtpSeed: Array<[string, string]> = [
      [SMTP_SETTING_KEYS.enabled, SMTP_DEFAULTS.enabled ? "1" : "0"],
      [SMTP_SETTING_KEYS.host, SMTP_DEFAULTS.host],
      [SMTP_SETTING_KEYS.port, String(SMTP_DEFAULTS.port)],
      [SMTP_SETTING_KEYS.security, SMTP_DEFAULTS.security],
      [SMTP_SETTING_KEYS.auth, SMTP_DEFAULTS.auth],
      [SMTP_SETTING_KEYS.user, SMTP_DEFAULTS.user],
      [SMTP_SETTING_KEYS.from, SMTP_DEFAULTS.from],
      [SMTP_SETTING_KEYS.fromName, SMTP_DEFAULTS.fromName],
      [SMTP_SETTING_KEYS.replyTo, SMTP_DEFAULTS.replyTo],
      [SMTP_SETTING_KEYS.helo, SMTP_DEFAULTS.helo],
      [SMTP_SETTING_KEYS.timeoutMs, String(SMTP_DEFAULTS.timeoutMs)],
      [SMTP_SETTING_KEYS.rejectUnauthorized, SMTP_DEFAULTS.rejectUnauthorized ? "1" : "0"],
      [SMTP_SETTING_KEYS.adminTo, SMTP_DEFAULTS.adminTo],
      [SMTP_SETTING_KEYS.businessTo, SMTP_DEFAULTS.businessTo],
      [SMTP_SETTING_KEYS.cooldownSec, String(SMTP_DEFAULTS.cooldownSec)],
    ];
    for (const [key, value] of smtpSeed) {
      this.db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)").run(key, value);
    }
    for (const [key, value] of Object.entries(MENU_DEFAULT_VALUES)) {
      this.db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)").run(key, value);
    }
    this.db
      .prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('voice_files_path', ?)")
      .run("/var/lib/asterisk/sounds/custom");
    this.seedPulseApisFromCatalog();
    const ivrCount = this.db.prepare("SELECT COUNT(*) AS n FROM ivrs").get() as { n: number };
    if (ivrCount.n === 0) {
      this.createIvr(PULSE_IVR_SEED, "seed");
    }
    this.ensureLabSampleIvr();
    this.ensureIvrAnswerSteps();
  }

  private seedPulseApisFromCatalog(): void {
    if (!this.db) return;
    const now = new Date().toISOString();
    for (const [from, to] of Object.entries(LEGACY_SLOT_REMAP)) {
      this.db.prepare("UPDATE ivr_functions SET pulse_slot = ? WHERE pulse_slot = ?").run(to, from);
    }
    const placeholders = LEGACY_PULSE_SLOTS.map(() => "?").join(",");
    this.db.prepare(`DELETE FROM pulse_apis WHERE slot IN (${placeholders})`).run(...LEGACY_PULSE_SLOTS);
    const ins = this.db.prepare(
      `INSERT OR IGNORE INTO pulse_apis (
        slot, method, endpoint, timeout_ms, retries, updated_at,
        display_name, description, mock_enabled, mock_json, mock_status, mock_error, enabled
      ) VALUES (?, 'POST', '', 5000, 0, ?, ?, ?, 1, ?, 200, NULL, 1)`,
    );
    const fillMock = this.db.prepare(
      `UPDATE pulse_apis SET mock_json = ?, mock_status = 200
       WHERE slot = ? AND (mock_json IS NULL OR mock_json = '')`,
    );
    const fillName = this.db.prepare(
      `UPDATE pulse_apis SET display_name = ? WHERE slot = ? AND (display_name IS NULL OR display_name = '')`,
    );
    const fillDesc = this.db.prepare(
      `UPDATE pulse_apis SET description = ? WHERE slot = ? AND (description IS NULL OR description = '')`,
    );
    const clearRelative = this.db.prepare(
      `UPDATE pulse_apis SET endpoint = ''
       WHERE slot = ? AND endpoint != '' AND endpoint NOT LIKE 'http://%' AND endpoint NOT LIKE 'https://%'`,
    );
    for (const s of PULSE_API_SEEDS) {
      const mockJson = JSON.stringify(s.mock, null, 2);
      ins.run(s.slot, now, s.name, s.description, mockJson);
      fillMock.run(mockJson, s.slot);
      fillName.run(s.name, s.slot);
      fillDesc.run(s.description, s.slot);
      clearRelative.run(s.slot);
    }
  }

  private ensureLabSampleIvr(): void {
    const ivrs = this.listIvrs();
    const named = ivrs.find((i) => i.name === LAB_SAMPLE_IVR_NAME);
    const lab = ivrs.find((i) => i.name === "Lab IVR");
    const target = named ?? lab;
    const alreadySample = (ivr: { menus: IvrMenu[]; name: string }) =>
      ivr.name === LAB_SAMPLE_IVR_NAME &&
      ivr.menus.some((m) => m.key === "4.1" || m.key === "Extension-Test");
    if (target) {
      if (!alreadySample(target)) {
        this.updateIvr(target.id, LAB_SAMPLE_IVR, "seed");
      }
    } else {
      this.createIvr(LAB_SAMPLE_IVR, "seed");
    }
    const ivr = this.listIvrs().find((i) => i.name === LAB_SAMPLE_IVR_NAME);
    if (!ivr) return;
    for (const setup of this.listSetups()) {
      if (setup.matchDid.trim() === "7777" && setup.ivrId !== ivr.id) {
        this.updateSetup(setup.id, { ivrId: ivr.id }, "seed");
      }
    }
  }

  private ensureIvrAnswerSteps(): void {
    for (const ivr of this.listIvrs()) {
      const hasAnswer = ivr.menus.some((m) => m.options.some((o) => o.action.toLowerCase() === "answer"));
      if (hasAnswer || !ivr.menus.length) continue;
      const entry = ivr.entryKey || ivr.menus[0]!.key;
      this.updateIvr(
        ivr.id,
        {
          name: ivr.name,
          enabled: ivr.enabled,
          entryKey: "answer",
          menus: [
            {
              key: "answer",
              name: "Answer",
              description: "Answer before prompts",
              menuFile: "none",
              inputTimeout: 0,
              maxNoInput: 0,
              isEntry: true,
              options: [
                { when: "none", action: "answer", success: `GOTO_MENU ${entry}`, fail: "hangup" },
                { when: "MaxNoInput", action: "answer", success: `GOTO_MENU ${entry}`, fail: "hangup" },
              ],
            },
            ...ivr.menus.map((m) => ({ ...m, isEntry: false })),
          ],
        },
        "seed",
      );
    }
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
  ivr_id?: number | null;
  post_call_survey_enabled?: number | null;
  post_call_survey_ivr_id?: number | null;
  created_at: string;
  updated_at: string;
};

type PulseRow = {
  slot: string;
  method: PulseApiConfig["method"];
  endpoint: string;
  timeout_ms: number;
  retries: number;
  updated_at: string;
  display_name?: string;
  description?: string;
  mock_enabled?: number;
  mock_json?: string | null;
  mock_status?: number | null;
  mock_error?: string | null;
  enabled?: number;
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
  pulse_session_id?: string | null;
  agent_id?: string | null;
  agent_extension?: string | null;
  bridge_id?: string | null;
  language?: number | null;
  queue_position?: number | null;
  expected_wait_sec?: number | null;
  is_cli_already_exist?: number | null;
  ivr_routing?: number | null;
  is_priority?: number | null;
  is_high_alert?: number | null;
  recording_relative_path?: string | null;
};

type IvrRow = {
  id: number;
  name: string;
  enabled: number;
  entry_menu_id: number | null;
  document?: string | null;
  entry_key?: string | null;
  created_at: string;
  updated_at: string;
};

type FnRow = {
  id: number;
  name: string;
  description: string;
  pulse_slot: string;
  param_hint: string;
  enabled: number;
  created_at: string;
  updated_at: string;
};

function mapFn(row: FnRow): IvrCustomFunction {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    pulseSlot: row.pulse_slot,
    paramHint: row.param_hint,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeFnName(raw: string): string {
  return raw.trim().replace(/\s+/g, "_");
}

function parseIvrDocument(raw: string | null | undefined, entryKey: string | null | undefined): {
  entryKey: string;
  menus: IvrMenu[];
} {
  if (!raw || raw === "{}") return { entryKey: entryKey ?? "", menus: [] };
  try {
    const parsed = JSON.parse(raw) as { entryKey?: string; menus?: IvrMenuDraft[] };
    const menus = Array.isArray(parsed.menus)
      ? parsed.menus.map((m, i) => normalizeMenu({ ...m, menuFile: m.menuFile || m.fileMenu }, i))
      : [];
    return { entryKey: parsed.entryKey || entryKey || menus[0]?.key || "", menus };
  } catch {
    return { entryKey: entryKey ?? "", menus: [] };
  }
}

function convertLegacyIvrs(db: DatabaseSync): void {
  const hasMenus = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='ivr_menus'").get() as
    | { name: string }
    | undefined;
  if (!hasMenus) return;
  const heads = db.prepare("SELECT * FROM ivrs").all() as IvrRow[];
  for (const row of heads) {
    const existing = parseIvrDocument(row.document, row.entry_key);
    if (existing.menus.length) continue;
    const menus = db
      .prepare("SELECT * FROM ivr_menus WHERE ivr_id = ? ORDER BY sort_order, id")
      .all(row.id) as Array<{
      id: number;
      name: string;
      prompt_sound: string;
      invalid_sound: string;
      timeout_sec: number;
      max_no_input: number;
      on_no_input: string;
      on_no_input_menu_id: number | null;
      on_max_no_input: string;
      on_max_no_input_menu_id: number | null;
      on_max_invalid: string;
      on_max_invalid_menu_id: number | null;
    }>;
    if (!menus.length) continue;
    const options = db
      .prepare(
        `SELECT o.* FROM ivr_options o JOIN ivr_menus m ON m.id = o.menu_id WHERE m.ivr_id = ? ORDER BY o.sort_order`,
      )
      .all(row.id) as Array<{ menu_id: number; digits: string; action: string; target_menu_id: number | null }>;
    const keyOf = (id: number) => `m${id}`;
    const converted: IvrMenu[] = menus.map((m) => {
      const opts = options.filter((o) => o.menu_id === m.id).map((o) => ({
        when: o.digits,
        action: o.action === "hangup" ? "hangup" : "goto",
        param: "",
        success: o.action === "hangup" ? "hangup" : o.target_menu_id ? `GOTO_MENU ${keyOf(o.target_menu_id)}` : "",
        fail: o.action === "hangup" ? "hangup" : o.target_menu_id ? `GOTO_MENU ${keyOf(o.target_menu_id)}` : "",
      }));
      opts.push({
        when: "none",
        action: m.on_no_input === "hangup" ? "hangup" : m.on_no_input === "goto" ? "goto" : "repeat",
        param: "",
        success:
          m.on_no_input === "hangup"
            ? "hangup"
            : m.on_no_input_menu_id
              ? `GOTO_MENU ${keyOf(m.on_no_input_menu_id)}`
              : "repeat",
        fail: "hangup",
      });
      opts.push({
        when: "MaxTries",
        action: m.on_max_no_input === "goto" ? "goto" : "hangup",
        param: "",
        success: m.on_max_no_input_menu_id ? `GOTO_MENU ${keyOf(m.on_max_no_input_menu_id)}` : "hangup",
        fail: "hangup",
      });
      return {
        key: keyOf(m.id),
        name: m.name,
        description: "",
        menuFile: m.prompt_sound || "",
        fileInvalid: m.invalid_sound || "",
        fileNoInput: "",
        inputsAcceptable: "",
        inputTimeout: m.timeout_sec || 5,
        maxNoInput: m.max_no_input || 3,
        maxInvalid: null,
        onMaxNoInput: m.on_max_no_input_menu_id ? `GOTO_MENU ${keyOf(m.on_max_no_input_menu_id)}` : "hangup",
        onMaxInvalid: m.on_max_invalid_menu_id ? `GOTO_MENU ${keyOf(m.on_max_invalid_menu_id)}` : "hangup",
        options: opts,
      };
    });
    const entry = menus.find((m) => m.id === row.entry_menu_id) ?? menus[0];
    let entryKey = entry ? keyOf(entry.id) : converted[0]!.key;
    const hasAnswer = converted.some((m) => m.options.some((o) => o.action.toLowerCase() === "answer"));
    if (!hasAnswer) {
      converted.unshift({
        key: "answer",
        name: "Answer",
        description: "Added on import — IIM no longer answers before the IVR",
        menuFile: "none",
        fileInvalid: "",
        fileNoInput: "",
        inputsAcceptable: "",
        inputTimeout: 0,
        maxNoInput: 0,
        maxInvalid: 0,
        onMaxNoInput: `GOTO_MENU ${entryKey}`,
        onMaxInvalid: "hangup",
        options: [
          { when: "none", action: "answer", param: "", success: `GOTO_MENU ${entryKey}`, fail: "hangup" },
          { when: "MaxNoInput", action: "answer", param: "", success: `GOTO_MENU ${entryKey}`, fail: "hangup" },
        ],
      });
      entryKey = "answer";
    }
    db.prepare("UPDATE ivrs SET document=?, entry_key=? WHERE id=?").run(
      JSON.stringify({ entryKey, menus: converted }),
      entryKey,
      row.id,
    );
  }
}

const PULSE_IVR_SEED: IvrSaveInput = {
  name: "PULSE starter",
  enabled: true,
  entryKey: "1",
  menus: [
    {
      key: "1",
      name: "Create interaction",
      fileMenu: "none",
      inputTimeout: 0,
      retries: 0,
      isEntry: true,
      options: [
        { when: "none", action: "proc_createinteraction", success: "GOTO_MENU 1.1", fail: "hangup" },
      ],
    },
    {
      key: "1.1",
      name: "Create session",
      fileMenu: "none",
      inputTimeout: 0,
      retries: 0,
      options: [{ when: "none", action: "proc_createsession", success: "GOTO_MENU 2", fail: "hangup" }],
    },
    {
      key: "2",
      name: "Answer",
      fileMenu: "none",
      inputTimeout: 0,
      retries: 0,
      options: [{ when: "none", action: "answer", success: "GOTO_MENU 3", fail: "hangup" }],
    },
    {
      key: "3",
      name: "Greeting",
      fileMenu: "hello-world A",
      inputTimeout: 0,
      retries: 0,
      options: [{ when: "none", action: "goto", success: "GOTO_MENU 4", fail: "GOTO_MENU 4" }],
    },
    {
      key: "4",
      name: "Main",
      fileMenu: "hello-world",
      fileInvalid: "invalid",
      inputTimeout: 5,
      retries: 3,
      options: [
        { when: "1", action: "repeat", success: "repeat", fail: "repeat" },
        { when: "2", action: "hangup", success: "hangup", fail: "hangup" },
        { when: "none", action: "repeat", success: "repeat", fail: "repeat" },
        { when: "MaxTries", action: "hangup", success: "hangup", fail: "hangup" },
      ],
    },
  ],
};

function mapSetup(row: SetupRow): CallSetup {
  return {
    id: row.id,
    name: row.name,
    enabled: row.enabled === 1,
    matchDid: row.match_did ?? "",
    matchTrunk: row.match_trunk ?? "",
    maxConcurrent: row.max_concurrent,
    ivrId: row.ivr_id ?? null,
    postCallSurveyEnabled: row.post_call_survey_enabled === 1,
    postCallSurveyIvrId: row.post_call_survey_ivr_id ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

type OutboundRow = {
  id: number;
  name: string;
  description: string;
  trunk: string;
  audience: string;
  enabled: number;
  post_call_survey_enabled?: number | null;
  post_call_survey_ivr_id?: number | null;
  created_at: string;
  updated_at: string;
};

function normalizeAudience(raw: unknown): OutboundRoute["audience"] {
  const v = String(raw ?? "").trim().toLowerCase();
  if (v === "robo" || v === "agents" || v === "both") return v;
  return "both";
}

function mapOutbound(row: OutboundRow): OutboundRoute {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? "",
    trunk: row.trunk,
    audience: normalizeAudience(row.audience),
    enabled: row.enabled === 1,
    postCallSurveyEnabled: row.post_call_survey_enabled === 1,
    postCallSurveyIvrId: row.post_call_survey_ivr_id ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapPulse(row: PulseRow): PulseApiConfig {
  return {
    slot: row.slot,
    name: row.display_name || row.slot,
    description: row.description ?? "",
    method: row.method,
    endpoint: row.endpoint,
    timeoutMs: row.timeout_ms,
    retries: row.retries,
    mockEnabled: row.mock_enabled === 1,
    mockJson: row.mock_json ?? "",
    mockStatus: row.mock_status ?? null,
    mockError: row.mock_error ?? "",
    enabled: row.enabled !== 0,
    updatedAt: row.updated_at,
  };
}

function normalizeSlot(raw: string): string {
  const slot = raw.trim();
  if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(slot)) return "";
  return slot;
}

function migratePulseApiColumns(db: DatabaseSync): void {
  const cols = db.prepare("PRAGMA table_info(pulse_apis)").all() as Array<{ name: string }>;
  const have = new Set(cols.map((c) => c.name));
  const add: Array<[string, string]> = [
    ["display_name", "TEXT NOT NULL DEFAULT ''"],
    ["description", "TEXT NOT NULL DEFAULT ''"],
    ["mock_enabled", "INTEGER NOT NULL DEFAULT 0"],
    ["mock_json", "TEXT"],
    ["mock_status", "INTEGER"],
    ["mock_error", "TEXT"],
    ["enabled", "INTEGER NOT NULL DEFAULT 1"],
  ];
  for (const [name, spec] of add) {
    if (!have.has(name)) db.exec(`ALTER TABLE pulse_apis ADD COLUMN ${name} ${spec}`);
  }
}

function requireSurveyIvr(enabled: boolean, ivrId: number | null): void {
  if (enabled && !effectiveSurveyIvrId(true, ivrId)) {
    throw Object.assign(new Error("post-call survey needs an IVR"), { code: "BAD_REQUEST" });
  }
}

function sqlBool(value: boolean | null | undefined): number | null {
  if (value == null) return null;
  return value ? 1 : 0;
}

function fromSqlBool(value: number | null | undefined): boolean | null {
  if (value == null) return null;
  return value === 1;
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
    internalId: row.session_id,
    uniqueId: row.unique_id ?? "",
    channel: row.channel ?? "",
    bridgeId: row.bridge_id ?? null,
    setupId: row.setup_id,
    interactionId: row.interaction_id,
    pulseSessionId: row.pulse_session_id ?? null,
    agentId: row.agent_id ?? null,
    agentExtension: row.agent_extension ?? null,
    callerId: row.caller_id ?? "",
    did: row.did ?? "",
    trunk: row.trunk ?? "",
    state: row.state,
    language: parseCallerLanguage(row.language ?? 0),
    currentMenu: row.ivr_pointer,
    queuePosition: row.queue_position ?? null,
    expectedWaitSec: row.expected_wait_sec ?? null,
    callerType: row.caller_type,
    customer,
    isCliAlreadyExist: fromSqlBool(row.is_cli_already_exist),
    ivrRouting: row.ivr_routing ?? null,
    isPriority: fromSqlBool(row.is_priority),
    isHighAlert: fromSqlBool(row.is_high_alert),
    recordingRelativePath: row.recording_relative_path ?? "",
    postCallSurveyIvrId: null,
    rejectReason: row.reject_reason,
    pulseClosed: false,
    startedAt: row.started_at,
    endedAt: row.ended_at,
  };
}

type UserRow = {
  id: number;
  username: string;
  password_hash: string;
  role: string;
  created_at: string;
  updated_at: string;
};

function normalizeHttpUrl(raw: string): string {
  const value = raw.trim();
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw Object.assign(new Error("URL must be http:// or https:// (host, port, and path are allowed)"), {
      code: "BAD_REQUEST",
    });
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw Object.assign(new Error("URL must be http:// or https://"), { code: "BAD_REQUEST" });
  }
  return parsed.toString();
}

function mapStation(row: StationRowDb): StationDirectory {
  return {
    extension: row.extension,
    displayName: row.display_name,
    agentId: row.agent_id,
    notes: row.notes,
    updatedAt: row.updated_at,
  };
}

type StationRowDb = {
  extension: string;
  display_name: string;
  agent_id: string;
  notes: string;
  updated_at: string;
};

function mapUser(row: UserRow): AuthUser {
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
