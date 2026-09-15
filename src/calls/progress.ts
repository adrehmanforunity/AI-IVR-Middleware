import type { CallSession, CallerLanguage } from "../domain/types.js";

export const CALLER_LANGUAGE_NAME: Record<CallerLanguage, string> = {
  0: "Urdu",
  1: "English",
  2: "Sindhi",
  3: "Pashto",
  4: "Arabic",
};

export function parseCallerLanguage(raw: unknown, fallback: CallerLanguage = 0): CallerLanguage {
  const n = typeof raw === "number" ? raw : Number(String(raw ?? "").trim());
  if (n === 0 || n === 1 || n === 2 || n === 3 || n === 4) return n;
  const name = String(raw ?? "").trim().toLowerCase();
  if (name === "urdu") return 0;
  if (name === "english") return 1;
  if (name === "sindhi") return 2;
  if (name === "pashto" || name === "pushto") return 3;
  if (name === "arabic") return 4;
  return fallback;
}

export function newCallProgress(): Pick<
  CallSession,
  | "pulseSessionId"
  | "agentId"
  | "agentExtension"
  | "bridgeId"
  | "language"
  | "currentMenu"
  | "queuePosition"
  | "expectedWaitSec"
  | "isCliAlreadyExist"
  | "ivrRouting"
  | "isPriority"
  | "isHighAlert"
  | "recordingRelativePath"
  | "postCallSurveyIvrId"
> {
  return {
    pulseSessionId: null,
    agentId: null,
    agentExtension: null,
    bridgeId: null,
    language: 0,
    currentMenu: null,
    queuePosition: null,
    expectedWaitSec: null,
    isCliAlreadyExist: null,
    ivrRouting: null,
    isPriority: null,
    isHighAlert: null,
    recordingRelativePath: "",
    postCallSurveyIvrId: null,
  };
}

/** Fields for every call log line as the call progresses. */
export function callLogFields(session: CallSession): Record<string, unknown> {
  return {
    callsInternalId: session.internalId,
    callInteractionId: session.interactionId,
    callSessionId: session.pulseSessionId,
    callAgentId: session.agentId,
    callAgentExt: session.agentExtension,
    callBridgeId: session.bridgeId,
    asteriskUniqueId: session.uniqueId,
    callerLanguage: session.language,
    callerLanguageName: CALLER_LANGUAGE_NAME[session.language],
    callerCurrentMenu: session.currentMenu,
    callerQueuePosition: session.queuePosition,
    callerExpectedWaitSec: session.expectedWaitSec,
    callerType: session.callerType,
    state: session.state,
    callerId: session.callerId,
    did: session.did,
    trunk: session.trunk,
    isCliAlreadyExist: session.isCliAlreadyExist,
    ivrRouting: session.ivrRouting,
    isPriority: session.isPriority,
    isHighAlert: session.isHighAlert,
    recordingRelativePath: session.recordingRelativePath || undefined,
    postCallSurveyIvrId: session.postCallSurveyIvrId || undefined,
  };
}

export function applyPulseFacts(session: CallSession, data: Record<string, unknown>): void {
  const pick = (...keys: string[]): unknown => {
    for (const k of keys) {
      if (data[k] != null && data[k] !== "") return data[k];
    }
    return undefined;
  };

  const interaction = pick("interactionId", "callInteractionId", "InteractionId");
  if (typeof interaction === "string" && interaction.trim()) session.interactionId = interaction.trim();

  const pulseSession = pick("pulseSessionId", "sessionId", "callSessionId", "sessionGuid", "pulseSession");
  if (typeof pulseSession === "string" && pulseSession.trim()) session.pulseSessionId = pulseSession.trim();

  const agentId = pick("agentId", "callAgentId", "AgentId");
  if (typeof agentId === "string" && agentId.trim()) session.agentId = agentId.trim();

  const ext = pick("agentExtension", "callAgentExt", "extension", "agentExt");
  if (ext != null && String(ext).trim()) session.agentExtension = String(ext).trim();

  const bridge = pick("bridgeId", "callBridgeId", "asteriskBridgeId");
  if (typeof bridge === "string" && bridge.trim()) session.bridgeId = bridge.trim();

  const lang = pick("language", "callerLanguage", "languageId");
  if (lang !== undefined) session.language = parseCallerLanguage(lang, session.language);

  const menu = pick("currentMenu", "ivrPointer", "menu");
  if (typeof menu === "string" && menu.trim()) session.currentMenu = menu.trim();

  const pos = pick("queuePosition", "position", "queuePos");
  if (pos !== undefined) {
    const n = Number(pos);
    if (Number.isFinite(n)) session.queuePosition = n;
  }

  const wait = pick("expectedWaitSec", "estimatedWaitSec", "etaSeconds");
  if (wait !== undefined) {
    const n = Number(wait);
    if (Number.isFinite(n)) session.expectedWaitSec = n;
  }

  const callerType = pick("callerType", "CallerType");
  if (typeof callerType === "string") session.callerType = callerType;

  const cliExist = asBool(pick("isCliAlreadyExist", "IsCliAlreadyExist"));
  if (cliExist !== null) session.isCliAlreadyExist = cliExist;

  const routing = pick("ivrRouting", "IvrRouting");
  if (routing !== undefined) {
    const n = Number(routing);
    if (Number.isFinite(n)) session.ivrRouting = n;
  }

  const priority = asBool(pick("isPriority", "IsPriority"));
  if (priority !== null) session.isPriority = priority;

  const highAlert = asBool(pick("isHighAlert", "IsHighAlert"));
  if (highAlert !== null) session.isHighAlert = highAlert;

  const recPath = data.recordingRelativePath ?? data.RecordingRelativePath;
  if (typeof recPath === "string") session.recordingRelativePath = recPath;

  if (data.customer !== undefined) session.customer = data.customer;
}

function asBool(raw: unknown): boolean | null {
  if (raw === true || raw === 1 || raw === "1" || raw === "true") return true;
  if (raw === false || raw === 0 || raw === "0" || raw === "false") return false;
  return null;
}
