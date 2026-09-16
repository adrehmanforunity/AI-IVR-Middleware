import type { CallerLanguage } from "../domain/types.js";
import { toAriSound } from "./document.js";
import { isCallerLanguage, LANGUAGE_CODE, LANGUAGE_FOLDER } from "./languages.js";

export { LANGUAGE_CODE, LANGUAGE_FOLDER } from "./languages.js";

export const DEFAULT_VOICE_FILES_PATH = "/var/lib/asterisk/sounds/custom";
export const VOICE_PATH_SETTING = "voice_files_path";

export function languageCode(language: CallerLanguage | number | null | undefined): string {
  const n = typeof language === "number" && isCallerLanguage(language) ? language : 0;
  return LANGUAGE_CODE[n];
}

export function applyLanguageToken(file: string, language: CallerLanguage | number | null | undefined): string {
  if (!file.includes("{language}")) return file;
  return file.split("{language}").join(languageCode(language));
}

export function languageFolder(language: CallerLanguage | number | null | undefined): string {
  const n = typeof language === "number" && isCallerLanguage(language) ? language : 0;
  return LANGUAGE_FOLDER[n];
}

/** Path relative to Asterisk `sounds/` for ARI `sound:` playback. */
export function ariSoundsPrefix(voiceRoot: string): string {
  const norm = String(voiceRoot || DEFAULT_VOICE_FILES_PATH)
    .trim()
    .replace(/\\/g, "/")
    .replace(/\/+$/, "");
  const marker = "/sounds/";
  const idx = norm.toLowerCase().lastIndexOf(marker);
  if (idx >= 0) return norm.slice(idx + marker.length);
  const last = norm.split("/").filter(Boolean).pop();
  return last || "custom";
}

/**
 * Menu files are the prompt name only (`hugo-greeting`, `hugo-main-menu_{language}`).
 * Asterisk path = IIM Setup voice root (`…/sounds/custom`) + optional inbound folder + that name.
 * Bare names with no inbound folder and no `{language}` still use `custom/<urdu|english>/…` (lab BOK).
 */
export function resolveVoiceMedia(
  file: string,
  language: CallerLanguage | number | null | undefined,
  voiceRoot = DEFAULT_VOICE_FILES_PATH,
  voiceFolder = "",
): string {
  const original = String(file ?? "");
  const hadLanguageToken = original.includes("{language}");
  const stripped = applyLanguageToken(toAriSound(original), language);
  if (!isPlayablePrompt(stripped)) return "";
  if (stripped.includes(":")) return stripped;
  const prefix = ariSoundsPrefix(voiceRoot);
  let relative = stripped.replace(/^\/+/, "");
  const head = `${prefix.toLowerCase()}/`;
  if (relative.toLowerCase().startsWith(head)) {
    relative = relative.slice(prefix.length + 1);
  }
  const pack = sanitizeVoiceFolder(voiceFolder);
  if (pack) {
    return `sound:${prefix}/${pack}/${relative}`;
  }
  if (hadLanguageToken || relative.includes("/")) {
    return `sound:${prefix}/${relative}`;
  }
  return `sound:${prefix}/${languageFolder(language)}/${relative}`;
}

/** One folder name under `custom/` (no slashes). Empty = default. */
export function sanitizeVoiceFolder(raw: string | null | undefined): string {
  const part = String(raw ?? "")
    .trim()
    .replace(/\\/g, "/")
    .split("/")
    .filter(Boolean)[0] ?? "";
  if (!part || part === "." || part === "..") return "";
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(part)) return "";
  return part;
}

/** Empty, `none`, or a JS `undefined`/`null` string — do not send to Asterisk. */
export function isPlayablePrompt(file: string | null | undefined): boolean {
  const s = String(file ?? "").trim();
  if (!s || /^none$/i.test(s)) return false;
  if (/^(undefined|null)$/i.test(s)) return false;
  return true;
}
