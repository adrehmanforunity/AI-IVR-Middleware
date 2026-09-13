import { randomUUID } from "node:crypto";
import type { ConfigStore } from "../db/sqlite.js";
import type { CallSession, CallSetup, RejectReason } from "../domain/types.js";
import { newCallProgress } from "./progress.js";

export type SetupLive = CallSetup & {
  activeCount: number;
  draining: boolean;
};

export class CallRegistry {
  private readonly byUnique = new Map<string, CallSession>();
  private readonly byInternal = new Map<string, CallSession>();

  constructor(private readonly store: ConfigStore) {}

  listActive(): CallSession[] {
    return [...this.byInternal.values()].filter((s) => s.state !== "ended" && s.state !== "rejected");
  }

  getByUnique(uniqueId: string): CallSession | undefined {
    return this.byUnique.get(uniqueId);
  }

  setupsWithCounts(): SetupLive[] {
    const counts = new Map<number, number>();
    for (const s of this.listActive()) {
      if (s.setupId == null) continue;
      counts.set(s.setupId, (counts.get(s.setupId) ?? 0) + 1);
    }
    return this.store.listSetups().map((setup) => ({
      ...setup,
      activeCount: counts.get(setup.id) ?? 0,
      draining: !setup.enabled,
    }));
  }

  activeOnSetup(setupId: number): number {
    let n = 0;
    for (const s of this.listActive()) {
      if (s.setupId === setupId) n += 1;
    }
    return n;
  }

  tryReserve(input: {
    uniqueId: string;
    channel: string;
    callerId: string;
    did: string;
    trunk: string;
    setup: CallSetup;
  }): { session: CallSession; reason?: undefined } | { session: null; reason: RejectReason } {
    if (this.byUnique.has(input.uniqueId)) {
      return { session: this.byUnique.get(input.uniqueId)!, reason: undefined };
    }
    if (!input.setup.enabled) {
      return { session: null, reason: "maintenance" };
    }
    if (this.activeOnSetup(input.setup.id) >= input.setup.maxConcurrent) {
      return { session: null, reason: "aicb" };
    }
    const now = new Date().toISOString();
    const session: CallSession = {
      internalId: randomUUID(),
      uniqueId: input.uniqueId,
      channel: input.channel,
      setupId: input.setup.id,
      interactionId: null,
      callerId: input.callerId,
      did: input.did,
      trunk: input.trunk,
      state: "ringing",
      callerType: null,
      customer: null,
      rejectReason: null,
      startedAt: now,
      endedAt: null,
      ...newCallProgress(),
    };
    this.byUnique.set(session.uniqueId, session);
    this.byInternal.set(session.internalId, session);
    this.store.upsertSession(session);
    return { session };
  }

  occupyingOnSetup(setupId: number): CallSession[] {
    return this.listActive().filter((s) => s.setupId === setupId);
  }

  /** Persist a rejected attempt without occupying a live slot. */
  recordRejected(input: {
    uniqueId: string;
    channel: string;
    callerId: string;
    did: string;
    trunk: string;
    setup: CallSetup;
    reason: RejectReason;
  }): CallSession {
    const now = new Date().toISOString();
    const session: CallSession = {
      internalId: randomUUID(),
      uniqueId: input.uniqueId,
      channel: input.channel,
      setupId: input.setup.id,
      interactionId: null,
      callerId: input.callerId,
      did: input.did,
      trunk: input.trunk,
      state: "rejected",
      callerType: null,
      customer: null,
      rejectReason: input.reason,
      startedAt: now,
      endedAt: now,
      ...newCallProgress(),
    };
    this.store.upsertSession(session);
    return session;
  }

  update(session: CallSession): void {
    this.byUnique.set(session.uniqueId, session);
    this.byInternal.set(session.internalId, session);
    this.store.upsertSession(session);
  }

  end(uniqueId: string, reason?: RejectReason | string | null, rejected = false): CallSession | null {
    const session = this.byUnique.get(uniqueId);
    if (!session) return null;
    if (session.state === "ended" || session.state === "rejected") return session;
    session.state = rejected || reason ? "rejected" : "ended";
    if (reason) session.rejectReason = reason;
    session.endedAt = new Date().toISOString();
    this.store.upsertSession(session);
    this.byUnique.delete(uniqueId);
    this.byInternal.delete(session.internalId);
    return session;
  }
}
