export type CallState =
  | "ringing"
  | "screened"
  | "session"
  | "ivr"
  | "queued"
  | "talking"
  | "ended"
  | "rejected";

export type RejectReason =
  | "unknown_setup"
  | "maintenance"
  | "busy"
  | "pulse_reject"
  | "pulse_timeout"
  | "pulse_not_configured"
  | "pulse_error";

export type CallSetup = {
  id: number;
  name: string;
  enabled: boolean;
  matchDid: string;
  matchTrunk: string;
  maxConcurrent: number;
  createdAt: string;
  updatedAt: string;
};

export type CallSession = {
  sessionId: string;
  uniqueId: string;
  channel: string;
  setupId: number | null;
  interactionId: string | null;
  callerId: string;
  did: string;
  trunk: string;
  state: CallState;
  callerType: string | null;
  ivrPointer: string | null;
  customer: unknown;
  rejectReason: RejectReason | string | null;
  startedAt: string;
  endedAt: string | null;
};

export type PulseApiSlot = "preAnswer" | "startSession";

export type PulseApiConfig = {
  slot: PulseApiSlot;
  method: "GET" | "POST" | "PUT" | "PATCH";
  endpoint: string;
  timeoutMs: number;
  retries: number;
  updatedAt: string;
};

export type TelephonyDesired = "connect" | "disconnect";

export type TelephonyConfig = {
  desired: TelephonyDesired;
  retryDelayMs: number;
};
