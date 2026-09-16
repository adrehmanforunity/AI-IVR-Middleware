import type { CallerLanguage, Ivr, IvrMenu, IvrSaveInput } from "../domain/types.js";
import { normalizeSave, parseAction } from "./document.js";
import { parseMenuFiles, resolveMenu } from "./menuDefaults.js";
import { CALLER_LANGUAGE_IDS } from "./languages.js";
import {
  DEFAULT_VOICE_FILES_PATH,
  LANGUAGE_CODE,
  LANGUAGE_FOLDER,
  VOICE_PATH_SETTING,
  isPlayablePrompt,
  resolveVoiceMedia,
} from "./voice.js";

export type VoiceNeed = {
  written: string;
  role: "menu" | "invalid" | "noInput" | "play";
  languageDependent: boolean;
  language: CallerLanguage | null;
  languageCode: string | null;
  languageFolder: string | null;
  ariMedia: string;
  /** Path on Asterisk under the configured voice root, plus .wav for placement. */
  placeAs: string;
  menuKey: string;
  menuName: string;
};

export type IvrVoiceAnalysis = {
  name: string;
  entryKey: string;
  menuCount: number;
  voiceRoot: string;
  voiceFolder: string;
  uniqueCount: number;
  files: Array<{
    ariMedia: string;
    placeAs: string;
    languageDependent: boolean;
    languageCode: string | null;
    usedBy: Array<{ menuKey: string; menuName: string; role: VoiceNeed["role"]; written: string }>;
  }>;
  needs: VoiceNeed[];
};

const LANGS = CALLER_LANGUAGE_IDS;

export function analyzeIvrVoices(
  input: Ivr | IvrSaveInput,
  settings: Record<string, string> = {},
  voiceFolder = "",
): IvrVoiceAnalysis {
  const name = (input.name ?? "").trim() || "IVR";
  const { entryKey, menus } = "id" in input && typeof input.id === "number"
    ? { entryKey: input.entryKey, menus: input.menus }
    : normalizeSave(input as IvrSaveInput);
  const voiceRoot = (settings[VOICE_PATH_SETTING] ?? "").trim() || DEFAULT_VOICE_FILES_PATH;
  const needs: VoiceNeed[] = [];

  for (const menu of menus) {
    const parsed = parseMenuFiles(menu.menuFile);
    if (!parsed.none) {
      for (const file of parsed.files) addPrompt(needs, menu, file, "menu", voiceRoot, voiceFolder);
    }
    const rt = resolveMenu(menu, settings);
    if (rt.inputTimeout > 0) {
      if (isPlayablePrompt(rt.fileInvalid)) addPrompt(needs, menu, rt.fileInvalid, "invalid", voiceRoot, voiceFolder);
      if (isPlayablePrompt(rt.fileNoInput)) addPrompt(needs, menu, rt.fileNoInput, "noInput", voiceRoot, voiceFolder);
    }
    for (const opt of menu.options) {
      const { name: fn, arg } = parseAction(opt.action, opt.param);
      if (fn.toLowerCase() === "play" && isPlayablePrompt(arg)) {
        addPrompt(needs, menu, arg, "play", voiceRoot, voiceFolder);
      }
    }
  }

  const grouped = new Map<string, IvrVoiceAnalysis["files"][number]>();
  for (const n of needs) {
    const slot = grouped.get(n.ariMedia) ?? {
      ariMedia: n.ariMedia,
      placeAs: n.placeAs,
      languageDependent: n.languageDependent,
      languageCode: n.languageCode,
      usedBy: [],
    };
    slot.usedBy.push({ menuKey: n.menuKey, menuName: n.menuName, role: n.role, written: n.written });
    grouped.set(n.ariMedia, slot);
  }

  const files = [...grouped.values()].sort((a, b) => a.ariMedia.localeCompare(b.ariMedia));
  return {
    name,
    entryKey,
    menuCount: menus.length,
    voiceRoot,
    voiceFolder: voiceFolder.trim(),
    uniqueCount: files.length,
    files,
    needs,
  };
}

function addPrompt(
  needs: VoiceNeed[],
  menu: IvrMenu,
  written: string,
  role: VoiceNeed["role"],
  voiceRoot: string,
  voiceFolder: string,
): void {
  const raw = written.trim();
  if (!isPlayablePrompt(raw)) return;
  if (raw.includes("{language}")) {
    for (const lang of LANGS) {
      needs.push(oneNeed(menu, raw, role, voiceRoot, voiceFolder, lang));
    }
    return;
  }
  needs.push(oneNeed(menu, raw, role, voiceRoot, voiceFolder, null));
}

function oneNeed(
  menu: IvrMenu,
  written: string,
  role: VoiceNeed["role"],
  voiceRoot: string,
  voiceFolder: string,
  language: CallerLanguage | null,
): VoiceNeed {
  const ariMedia = resolveVoiceMedia(written, language ?? 0, voiceRoot, voiceFolder);
  return {
    written,
    role,
    languageDependent: language !== null,
    language: language,
    languageCode: language === null ? null : LANGUAGE_CODE[language],
    languageFolder: language === null ? null : LANGUAGE_FOLDER[language],
    ariMedia,
    placeAs: placeAsWav(ariMedia, voiceRoot),
    menuKey: menu.key,
    menuName: menu.name,
  };
}

function placeAsWav(ariMedia: string, voiceRoot: string): string {
  const rel = ariMedia.replace(/^sound:/i, "").replace(/^\/+/, "");
  const root = voiceRoot.replace(/\\/g, "/").replace(/\/+$/, "");
  const soundsIdx = root.toLowerCase().lastIndexOf("/sounds");
  const soundsRoot = soundsIdx >= 0 ? root.slice(0, soundsIdx + "/sounds".length) : root.replace(/\/custom$/i, "");
  const underSounds = `${soundsRoot}/${rel}`.replace(/\/+/g, "/");
  return `${underSounds}.wav`;
}
