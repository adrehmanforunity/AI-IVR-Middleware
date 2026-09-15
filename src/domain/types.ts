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
  /** All inbound channels busy — route concurrent cap reached. */
  | "aicb"
  | "pulse_reject"
  | "pulse_timeout"
  | "pulse_not_configured"
  | "pulse_error";

export type OutboundAudience = "robo" | "agents" | "both";

export type OutboundRoute = {
  id: number;
  name: string;
  description: string;
  trunk: string;
  audience: OutboundAudience;
  enabled: boolean;
  /** CSAT after the agent hangs up. Reuses the live Pulse interaction/session. */
  postCallSurveyEnabled: boolean;
  postCallSurveyIvrId: number | null;
  createdAt: string;
  updatedAt: string;
};

export type OutboundRouteInput = {
  name: string;
  description?: string;
  trunk: string;
  audience?: OutboundAudience;
  enabled?: boolean;
  postCallSurveyEnabled?: boolean;
  postCallSurveyIvrId?: number | null;
};

export type CallSetup = {
  id: number;
  name: string;
  enabled: boolean;
  matchDid: string;
  matchTrunk: string;
  maxConcurrent: number;
  ivrId: number | null;
  /** CSAT after the agent hangs up. Reuses the live Pulse interaction/session. */
  postCallSurveyEnabled: boolean;
  postCallSurveyIvrId: number | null;
  createdAt: string;
  updatedAt: string;
};

export type IvrOption = {
  when: string;
  action: string;
  param: string;
  success: string;
  fail: string;
};

export type IvrMenu = {
  key: string;
  name: string;
  description: string;
  /** Comma-separated sounds to play. `none` = play nothing, then take max-no-input. */
  menuFile: string;
  fileInvalid: string;
  fileNoInput: string;
  inputsAcceptable: string;
  /** Null = use system default (menu_max_input_timeout). */
  inputTimeout: number | null;
  maxNoInput: number | null;
  maxInvalid: number | null;
  onMaxNoInput: string;
  onMaxInvalid: string;
  options: IvrOption[];
};

export type Ivr = {
  id: number;
  name: string;
  enabled: boolean;
  entryKey: string;
  menus: IvrMenu[];
  createdAt: string;
  updatedAt: string;
};

export type IvrOptionDraft = {
  when: string;
  action: string;
  param?: string;
  success?: string;
  fail?: string;
};

export type IvrMenuDraft = {
  key: string;
  name: string;
  description?: string;
  menuFile?: string;
  fileMenu?: string;
  interrupt?: string;
  fileInvalid?: string;
  fileNoInput?: string;
  inputsAcceptable?: string;
  inputTimeout?: number | null;
  maxNoInput?: number | null;
  maxInvalid?: number | null;
  retries?: number | null;
  onMaxNoInput?: string;
  onMaxInvalid?: string;
  isEntry?: boolean;
  options?: IvrOptionDraft[];
};

export type IvrSaveInput = {
  name: string;
  enabled?: boolean;
  entryKey?: string;
  menus: IvrMenuDraft[];
};

export type IvrFunctionKind = "builtin" | "pulse";

export type IvrFunctionDef = {
  name: string;
  kind: IvrFunctionKind;
  source: "generic" | "custom";
  description: string;
  pulseSlot: string | null;
  paramHint: string;
  enabled: boolean;
};

export type IvrCustomFunction = {
  id: number;
  name: string;
  description: string;
  pulseSlot: string;
  paramHint: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type IvrCustomFunctionInput = {
  name: string;
  description?: string;
  pulseSlot: string;
  paramHint?: string;
  enabled?: boolean;
};

export type CallerLanguage = 0 | 1 | 2 | 3 | 4;

export type CallSession = {
  /** GUID created by IIM for this call (CallsInternalID). */
  internalId: string;
  /** Asterisk channel Uniqueid (ARI channel id). */
  uniqueId: string;
  channel: string;
  /** Asterisk bridge id when the caller is connected to an agent. */
  bridgeId: string | null;
  setupId: number | null;
  /** GUID from PULSE create-interaction. */
  interactionId: string | null;
  /** GUID from PULSE create-session. */
  pulseSessionId: string | null;
  /** Agent id from PULSE when a transfer is required. */
  agentId: string | null;
  /** PBX extension to dial so the agent can talk to the caller. */
  agentExtension: string | null;
  callerId: string;
  did: string;
  trunk: string;
  state: CallState;
  /** 0=Urdu (default), 1=English, 2=Sindhi, 3=Pashto, 4=Arabic. */
  language: CallerLanguage;
  currentMenu: string | null;
  queuePosition: number | null;
  expectedWaitSec: number | null;
  callerType: string | null;
  customer: unknown;
  /** From Create Interaction. */
  isCliAlreadyExist: boolean | null;
  /** From Create Interaction (Pulse IVR route id). */
  ivrRouting: number | null;
  /** From Create Session. */
  isPriority: boolean | null;
  /** From Create Session. */
  isHighAlert: boolean | null;
  /** Sent on Create Session and kept if Pulse echoes it. */
  recordingRelativePath: string;
  /** Survey IVR to run if the agent hangs up first (CSAT). Null if caller drop or survey off. */
  postCallSurveyIvrId: number | null;
  rejectReason: RejectReason | string | null;
  /** True after Close Session finished (success or gave up). In-memory only. */
  pulseClosed: boolean;
  startedAt: string;
  endedAt: string | null;
};

/**
 * Planned on CallSession (not stored yet).
 *
 * Why: every live/history row is inbound-from-Stasis today. That is not enough once
 * an IIM station (3001–3999) places a call, or IIM originates a campaign/IVR leg.
 * Without direction, dashboards, occupancy, PULSE interaction, and hangup ownership
 * treat agent-outbound and robo-outbound as if a customer had dialed in.
 *
 * What:
 * - `inbound` — customer → DID → Stasis (current path).
 * - `outbound` — agent station asks to dial out (we originate or attach that channel).
 * - `robo` — IIM originates the call and runs an IVR (no agent on the A-leg).
 *
 * Also needed later: who originated (station vs IIM), destination number, which IVR
 * for robo, and concurrency rules that are not the inbound DID setup table.
 */

export type PulseApiSlot = string;

export type PulseApiConfig = {
  slot: PulseApiSlot;
  name: string;
  description: string;
  method: "GET" | "POST" | "PUT" | "PATCH";
  endpoint: string;
  timeoutMs: number;
  retries: number;
  mockEnabled: boolean;
  mockJson: string;
  mockStatus: number | null;
  mockError: string;
  enabled: boolean;
  updatedAt: string;
};

export type TelephonyDesired = "connect" | "disconnect";

export type TelephonyLinkConfig = {
  desired: TelephonyDesired;
  retryDelayMs: number;
  connectTimeoutMs: number;
};

export type OwnedExtensionRange = {
  from: number;
  to: number;
};

export type StationDirectory = {
  extension: string;
  displayName: string;
  agentId: string;
  notes: string;
  updatedAt: string;
};

export type TelephonyConfig = {
  ami: TelephonyLinkConfig;
  ari: TelephonyLinkConfig;
  /** PBX stations this app uses (default 3001–3999). Not inbound DIDs. Other phones are ignored. */
  ownedExtensions: OwnedExtensionRange;
};
