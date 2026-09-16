import type { CallerLanguage } from "../domain/types.js";

export const LANGUAGE_PULSE_QUEUE_SETTING = "language_pulse_queue";

export type LanguageDef = {
  id: CallerLanguage;
  code: string;
  name: string;
  folder: string;
  /** Default languageQueueId sent to Pulse Add Call Interaction (old mw: ur=1, en=2). */
  pulseDefault: number;
};

export const LANGUAGES: LanguageDef[] = [
  { id: 0, code: "ur", name: "Urdu", folder: "urdu", pulseDefault: 1 },
  { id: 1, code: "en", name: "English", folder: "english", pulseDefault: 2 },
  { id: 2, code: "sn", name: "Sindhi", folder: "sindhi", pulseDefault: 3 },
  { id: 3, code: "ps", name: "Pashto", folder: "pashto", pulseDefault: 4 },
  { id: 4, code: "ar", name: "Arabic", folder: "arabic", pulseDefault: 5 },
  { id: 5, code: "ot5", name: "Other 5", folder: "other5", pulseDefault: 6 },
  { id: 6, code: "ot6", name: "Other 6", folder: "other6", pulseDefault: 7 },
  { id: 7, code: "ot7", name: "Other 7", folder: "other7", pulseDefault: 8 },
  { id: 8, code: "ot8", name: "Other 8", folder: "other8", pulseDefault: 9 },
  { id: 9, code: "ot9", name: "Other 9", folder: "other9", pulseDefault: 10 },
];

export const CALLER_LANGUAGE_IDS = LANGUAGES.map((l) => l.id) as CallerLanguage[];

export const LANGUAGE_CODE = Object.fromEntries(LANGUAGES.map((l) => [l.id, l.code])) as Record<
  CallerLanguage,
  string
>;

export const LANGUAGE_FOLDER = Object.fromEntries(LANGUAGES.map((l) => [l.id, l.folder])) as Record<
  CallerLanguage,
  string
>;

export const CALLER_LANGUAGE_NAME = Object.fromEntries(LANGUAGES.map((l) => [l.id, l.name])) as Record<
  CallerLanguage,
  string
>;

export const DEFAULT_LANGUAGE_PULSE_QUEUE = Object.fromEntries(
  LANGUAGES.map((l) => [l.code, l.pulseDefault]),
) as Record<string, number>;

export function isCallerLanguage(n: number): n is CallerLanguage {
  return Number.isInteger(n) && n >= 0 && n <= 9;
}

export function languageByCode(code: string): LanguageDef | undefined {
  const key = code.trim().toLowerCase();
  return LANGUAGES.find((l) => l.code === key);
}

export function parseCallerLanguage(raw: unknown, fallback: CallerLanguage = 0): CallerLanguage {
  if (typeof raw === "number" && isCallerLanguage(raw)) return raw;
  const text = String(raw ?? "").trim().toLowerCase();
  if (!text) return fallback;
  const n = Number(text);
  if (isCallerLanguage(n)) return n;
  const byCode = languageByCode(text);
  if (byCode) return byCode.id;
  if (text === "urdu") return 0;
  if (text === "english") return 1;
  if (text === "sindhi" || text === "sd") return 2;
  if (text === "pashto" || text === "pushto") return 3;
  if (text === "arabic") return 4;
  const other = /^other\s*([5-9])$/.exec(text);
  if (other) return Number(other[1]) as CallerLanguage;
  return fallback;
}

export function parseLanguagePulseQueue(settings: Record<string, string | undefined>): Record<string, number> {
  const out = { ...DEFAULT_LANGUAGE_PULSE_QUEUE };
  const raw = settings[LANGUAGE_PULSE_QUEUE_SETTING];
  if (!raw?.trim()) return out;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object") return out;
    for (const lang of LANGUAGES) {
      const v = parsed[lang.code] ?? parsed[String(lang.id)];
      const n = Number(v);
      if (Number.isFinite(n) && n >= 0) out[lang.code] = n;
    }
  } catch {
    /* keep defaults */
  }
  return out;
}

export function pulseLanguageQueueId(
  settings: Record<string, string | undefined>,
  language: CallerLanguage,
): number {
  const map = parseLanguagePulseQueue(settings);
  return map[LANGUAGE_CODE[language]] ?? language + 1;
}

export function defaultLanguagePulseQueueJson(): string {
  return JSON.stringify(DEFAULT_LANGUAGE_PULSE_QUEUE);
}
