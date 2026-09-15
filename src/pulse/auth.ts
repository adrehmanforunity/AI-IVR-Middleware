export const PULSE_API_KEY_SETTING = "pulse_api_key";

export function pulseAuthHeaders(apiKey: string): Record<string, string> {
  const key = apiKey.trim();
  if (!key) return {};
  return { "X-API-KEY": key, Authorization: key };
}
