import type { CallerLanguage } from "../domain/types.js";
import { toAriSound } from "./document.js";

export const DEFAULT_VOICE_FILES_PATH = "/var/lib/asterisk/sounds/custom";
export const VOICE_PATH_SETTING = "voice_files_path";

/** Folder name under the voice root for each caller language. */
export const LANGUAGE_FOLDER: Record<CallerLanguage, string> = {
  0: "urdu",
  1: "english",
  2: "sindhi",
  3: "pashto",
  4: "arabic",
};

export function languageFolder(language: CallerLanguage | number | null | undefined): string {
  const n = language === 0 || language === 1 || language === 2 || language === 3 || language === 4 ? language : 0;
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
 * Menu files are stored as bare names (`BOK_GREETINGS`). Playback is
 * `sound:<custom>/<language>/<name>` on Asterisk, unless the value is already
 * a full ARI media URI or already under the custom prefix.
 */
export function resolveVoiceMedia(
  file: string,
  language: CallerLanguage | number | null | undefined,
  voiceRoot = DEFAULT_VOICE_FILES_PATH,
): string {
  const stripped = toAriSound(file);
  if (!stripped || /^none$/i.test(stripped)) return "";
  if (stripped.includes(":")) return stripped;
  const prefix = ariSoundsPrefix(voiceRoot);
  const norm = stripped.replace(/^\/+/, "");
  if (norm.toLowerCase().startsWith(`${prefix.toLowerCase()}/`)) {
    return `sound:${norm}`;
  }
  const folder = languageFolder(language);
  return `sound:${prefix}/${folder}/${norm}`;
}
