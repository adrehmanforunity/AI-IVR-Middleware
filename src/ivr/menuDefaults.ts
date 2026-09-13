export const MENU_DEFAULT_KEYS = {
  maxNoInput: "menu_max_no_input",
  maxInvalid: "menu_max_invalid",
  fileInvalid: "menu_file_invalid",
  fileNoInput: "menu_file_no_input",
  inputTimeout: "menu_max_input_timeout",
  inputsAcceptable: "menu_inputs_acceptable",
} as const;

export const MENU_DEFAULT_VALUES: Record<(typeof MENU_DEFAULT_KEYS)[keyof typeof MENU_DEFAULT_KEYS], string> = {
  menu_max_no_input: "3",
  menu_max_invalid: "3",
  menu_file_invalid: "invalid",
  menu_file_no_input: "oninput",
  menu_max_input_timeout: "5",
  menu_inputs_acceptable: "*#1234567890",
};

export type MenuRuntime = {
  files: string[];
  none: boolean;
  fileInvalid: string;
  fileNoInput: string;
  inputTimeout: number;
  inputsAcceptable: string;
  maxNoInput: number;
  maxInvalid: number;
  onMaxNoInput: string;
  onMaxInvalid: string;
};

function setting(settings: Record<string, string>, key: string): string {
  const v = (settings[key] ?? MENU_DEFAULT_VALUES[key as keyof typeof MENU_DEFAULT_VALUES] ?? "").trim();
  return v;
}

function asInt(raw: string, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

export function isNoneMenuFile(raw: string | undefined | null): boolean {
  return /^none$/i.test(String(raw ?? "").trim());
}

export function parseMenuFiles(raw: string | undefined | null): { files: string[]; none: boolean } {
  if (isNoneMenuFile(raw)) return { files: [], none: true };
  const files = String(raw)
    .split(/[,;]+/)
    .map((part) => part.trim().split(/\s+/)[0] ?? "")
    .map((file) =>
      file
        .replace(/\.(wav|gsm|ulaw|alaw|sln|sln16)$/i, "")
        .replace(/\\/g, "/"),
    )
    .filter(Boolean);
  return { files, none: false };
}

export function soundOrDefault(raw: string | undefined | null, fallback: string): string {
  const s = String(raw ?? "").trim();
  if (!s || /^default$/i.test(s) || /^none$/i.test(s)) return fallback;
  return s.replace(/\.(wav|gsm|ulaw|alaw|sln|sln16)$/i, "").replace(/\\/g, "/");
}

export function resolveMenu(
  menu: {
    menuFile?: string;
    fileMenu?: string;
    fileInvalid?: string;
    fileNoInput?: string;
    inputTimeout?: number | null;
    inputsAcceptable?: string;
    interrupt?: string;
    maxNoInput?: number | null;
    maxInvalid?: number | null;
    retries?: number | null;
    onMaxNoInput?: string;
    onMaxInvalid?: string;
  },
  settings: Record<string, string>,
): MenuRuntime {
  const parsed = parseMenuFiles(menu.menuFile || menu.fileMenu);
  const timeoutDefault = asInt(setting(settings, MENU_DEFAULT_KEYS.inputTimeout), 5);
  const maxNoDefault = asInt(setting(settings, MENU_DEFAULT_KEYS.maxNoInput), 3);
  const maxInvDefault = asInt(setting(settings, MENU_DEFAULT_KEYS.maxInvalid), 3);
  const mask =
    (menu.inputsAcceptable || menu.interrupt || "").trim() ||
    setting(settings, MENU_DEFAULT_KEYS.inputsAcceptable);
  const timeout =
    menu.inputTimeout === null || menu.inputTimeout === undefined
      ? timeoutDefault
      : Math.max(0, Number(menu.inputTimeout) || 0);
  const maxNoInput =
    menu.maxNoInput === null || menu.maxNoInput === undefined
      ? menu.retries === null || menu.retries === undefined
        ? maxNoDefault
        : Math.max(0, Number(menu.retries) || 0)
      : Math.max(0, Number(menu.maxNoInput) || 0);
  const maxInvalid =
    menu.maxInvalid === null || menu.maxInvalid === undefined
      ? maxInvDefault
      : Math.max(0, Number(menu.maxInvalid) || 0);
  return {
    files: parsed.files,
    none: parsed.none,
    fileInvalid: soundOrDefault(menu.fileInvalid, setting(settings, MENU_DEFAULT_KEYS.fileInvalid)),
    fileNoInput: soundOrDefault(menu.fileNoInput, setting(settings, MENU_DEFAULT_KEYS.fileNoInput)),
    inputTimeout: parsed.none ? 0 : timeout,
    inputsAcceptable: mask,
    maxNoInput,
    maxInvalid,
    onMaxNoInput: (menu.onMaxNoInput ?? "").trim() || "hangup",
    onMaxInvalid: (menu.onMaxInvalid ?? "").trim() || "hangup",
  };
}
