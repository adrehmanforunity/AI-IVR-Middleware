import type { IvrMenu, IvrMenuDraft, IvrOption, IvrSaveInput } from "../domain/types.js";

export type PromptSpec = {
  sound: string;
  interrupt: string;
};

export function normalizeSave(input: IvrSaveInput): { entryKey: string; menus: IvrMenu[] } {
  const menus = (input.menus ?? []).map((m, i) => normalizeMenu(m, i));
  if (!menus.length) throw Object.assign(new Error("at least one menu is required"), { code: "BAD_REQUEST" });
  const keys = new Set(menus.map((m) => m.key));
  if (keys.size !== menus.length) {
    throw Object.assign(new Error("menu keys must be unique"), { code: "BAD_REQUEST" });
  }
  const flagged = (input.menus ?? []).find((m) => m.isEntry)?.key?.trim();
  const entryKey = (input.entryKey || flagged || menus[0]!.key).trim();
  if (!keys.has(entryKey)) {
    throw Object.assign(new Error("entry menu key is missing"), { code: "BAD_REQUEST" });
  }
  return { entryKey, menus };
}

export function normalizeMenu(m: IvrMenuDraft, index: number): IvrMenu {
  const key = (m.key || String(index + 1)).trim();
  const parsed = parsePrompt(m.fileMenu ?? "");
  return {
    key,
    name: (m.name || key).trim() || `Menu ${index + 1}`,
    description: (m.description ?? "").trim(),
    fileMenu: (m.fileMenu ?? "").trim(),
    interrupt: (m.interrupt ?? parsed.interrupt).trim(),
    fileInvalid: (m.fileInvalid ?? "").trim(),
    inputTimeout: Math.max(0, Number(m.inputTimeout ?? 0) || 0),
    retries: Math.max(0, Number(m.retries ?? 0) || 0),
    options: (m.options ?? [])
      .map(normalizeOption)
      .filter((o) => o.when.length > 0),
  };
}

function normalizeOption(o: {
  when?: string;
  action?: string;
  param?: string;
  success?: string;
  fail?: string;
}): IvrOption {
  return {
    when: optionWhen(o.when ?? ""),
    action: (o.action ?? "").trim(),
    param: (o.param ?? "").trim(),
    success: (o.success ?? "").trim(),
    fail: (o.fail ?? "").trim(),
  };
}

export function optionWhen(raw: string): string {
  const s = raw.trim();
  if (!s) return "none";
  const lower = s.toLowerCase();
  if (lower === "none" || lower === "auto" || lower === "noinput" || lower === "no input") return "none";
  if (lower === "maxtries" || lower === "max tries" || lower === "max-tries") return "MaxTries";
  return s;
}

export function parsePrompt(fileMenu: string): PromptSpec {
  const raw = fileMenu.trim();
  if (!raw || /^none$/i.test(raw)) return { sound: "", interrupt: "" };
  const parts = raw.split(/\s+/);
  const file = parts[0] ?? "";
  const interrupt = parts.slice(1).join("");
  return { sound: toAriSound(file), interrupt };
}

export function toAriSound(file: string): string {
  return file
    .trim()
    .replace(/\.(wav|gsm|ulaw|alaw|sln|sln16)$/i, "")
    .replace(/\\/g, "/");
}

export function findOption(menu: IvrMenu, when: string): IvrOption | undefined {
  const want = optionWhen(when);
  return menu.options.find((o) => optionWhen(o.when) === want);
}

export function resolveMenuKey(raw: string, menus: IvrMenu[]): string | "hangup" | "repeat" | "" {
  const s = (raw ?? "").trim();
  if (!s) return "";
  const lower = s.toLowerCase();
  if (lower === "hangup" || lower === "hang up") return "hangup";
  if (lower === "repeat" || lower === "replay") return "repeat";
  let token = s.replace(/^GOTO_MENU\s+/i, "").replace(/^goto\s+/i, "").trim();
  if (!token) return "";
  if (token.toLowerCase() === "hangup") return "hangup";
  const exact = menus.find((m) => m.key === token);
  if (exact) return exact.key;
  const ci = menus.find((m) => m.key.toLowerCase() === token.toLowerCase());
  if (ci) return ci.key;
  const withPrefix = menus.find((m) => m.key.toLowerCase() === `ivr-menu-${token}`.toLowerCase());
  if (withPrefix) return withPrefix.key;
  const stripped = menus.find((m) => m.key.toLowerCase() === token.toLowerCase().replace(/^ivr-menu-/, ""));
  if (stripped) return stripped.key;
  const byName = menus.find((m) => m.name.toLowerCase() === token.toLowerCase());
  if (byName) return byName.key;
  return token;
}

export function parseAction(action: string, param: string): { name: string; arg: string } {
  const raw = (action ?? "").trim();
  if (!raw) return { name: "", arg: param.trim() };
  const goto = raw.match(/^GOTO_MENU\b(.*)$/i);
  if (goto) return { name: "goto", arg: (goto[1] || param).trim() };
  const parts = raw.split(/\s+/);
  const name = (parts[0] ?? "").trim();
  const fromAction = parts.slice(1).join(" ").trim();
  const arg = (param || fromAction).trim() || fromAction;
  return { name, arg };
}

export function interruptAllows(mask: string, digit: string): boolean {
  if (!digit) return false;
  if (!mask.trim()) return true;
  return mask.toUpperCase().includes(digit.toUpperCase());
}
