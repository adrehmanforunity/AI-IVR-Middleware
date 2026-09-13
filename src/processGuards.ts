import type { Logger } from "./logging/index.js";

export type ProcessHealth = {
  healthy: boolean;
  unhandledErrors: number;
  lastUnhandledAt: string | null;
  cooldownUntil: number | null;
};

const COOLDOWN_MS = 10_000;

export function installProcessGuards(
  log: Logger,
  health: ProcessHealth,
  onCritical?: (event: string, detail: Record<string, unknown>) => void,
): void {
  process.on("unhandledRejection", (reason) => {
    health.unhandledErrors += 1;
    health.lastUnhandledAt = new Date().toISOString();
    health.cooldownUntil = Date.now() + COOLDOWN_MS;
    health.healthy = false;
    log.error({ component: "process", err: reason }, "unhandledRejection — process stays up");
    onCritical?.("unhandled_rejection", { error: String(reason) });
    scheduleRecovery(health);
  });

  process.on("uncaughtException", (err) => {
    health.unhandledErrors += 1;
    health.lastUnhandledAt = new Date().toISOString();
    health.cooldownUntil = Date.now() + COOLDOWN_MS;
    health.healthy = false;
    log.error({ component: "process", err }, "uncaughtException — process stays up");
    onCritical?.("uncaught_exception", { error: err.message });
    scheduleRecovery(health);
  });
}

function scheduleRecovery(health: ProcessHealth): void {
  const until = health.cooldownUntil;
  if (until == null) return;
  const wait = Math.max(0, until - Date.now());
  setTimeout(() => {
    if (health.cooldownUntil != null && Date.now() >= health.cooldownUntil) {
      health.healthy = true;
      health.cooldownUntil = null;
    }
  }, wait).unref();
}

export function createProcessHealth(): ProcessHealth {
  return {
    healthy: true,
    unhandledErrors: 0,
    lastUnhandledAt: null,
    cooldownUntil: null,
  };
}
