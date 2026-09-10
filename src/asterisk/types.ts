export type ConnectionState =
  | "stopped"
  | "connecting"
  | "connected"
  | "degraded"
  | "disconnected";

export type LinkStatus = {
  state: ConnectionState;
  lastConnectedAt: string | null;
  lastError: string | null;
  reconnectCount: number;
  lastEventAt: string | null;
};

export function emptyLinkStatus(): LinkStatus {
  return {
    state: "stopped",
    lastConnectedAt: null,
    lastError: null,
    reconnectCount: 0,
    lastEventAt: null,
  };
}

export type AsteriskTarget = {
  host: string;
  amiPort: number;
  amiUser: string;
  amiPassword: string;
  ariBaseUrl: string;
  ariUser: string;
  ariPassword: string;
  stasisApp: string;
  updatedAt: string;
};

export const BACKOFF_MS = [1000, 2000, 5000, 15000, 30000] as const;

export function backoffDelay(attempt: number, baseMs = 1000): number {
  const stepped = Math.min(baseMs * 2 ** Math.min(attempt, 4), 30_000);
  const jitter = 0.8 + Math.random() * 0.4;
  return Math.round(stepped * jitter);
}
