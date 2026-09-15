/**
 * Post-call survey is CSAT (customer satisfaction), not CSTA
 * (Computer-Supported Telecommunications Applications).
 *
 * Pulse already has the interaction + session from the live call.
 * Survey IVR must reuse those ids — never Create Interaction / Create Session again.
 * Run only when the agent ends the call. If the caller hangs up first, skip survey
 * and Close Session as usual.
 */
export function effectiveSurveyIvrId(enabled: boolean, ivrId: number | null | undefined): number | null {
  if (!enabled) return null;
  const id = Number(ivrId);
  return Number.isInteger(id) && id > 0 ? id : null;
}
