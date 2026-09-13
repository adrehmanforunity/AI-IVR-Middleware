import fs from "node:fs";
import path from "node:path";
import { getLogTarget } from "./index.js";

export const LOG_ID_RE = /^(\d{8})\/(\d{10})\.(log|AMI|ARI)$/;

export type LogKindName = "app" | "ami" | "ari";

export type LogFileInfo = {
  id: string;
  day: string;
  hour: string;
  kind: LogKindName;
  name: string;
  size: number;
  mtime: string;
};

const KIND: Record<string, LogKindName> = {
  log: "app",
  AMI: "ami",
  ARI: "ari",
};

export function logRoot(): { root: string; source: "configured" | "temp" } | null {
  const t = getLogTarget();
  if (!t?.root) return null;
  return { root: t.root, source: t.source };
}

export function listLogFiles(max = 400): LogFileInfo[] {
  const target = logRoot();
  if (!target) return [];
  const out: LogFileInfo[] = [];
  let days: string[] = [];
  try {
    days = fs
      .readdirSync(target.root, { withFileTypes: true })
      .filter((d) => d.isDirectory() && /^\d{8}$/.test(d.name))
      .map((d) => d.name)
      .sort()
      .reverse();
  } catch {
    return [];
  }
  for (const day of days) {
    const dir = path.join(target.root, day);
    let names: string[] = [];
    try {
      names = fs.readdirSync(dir);
    } catch {
      continue;
    }
    names.sort().reverse();
    for (const name of names) {
      const id = `${day}/${name}`;
      const m = LOG_ID_RE.exec(id);
      if (!m) continue;
      const abs = path.join(dir, name);
      let st: fs.Stats;
      try {
        st = fs.statSync(abs);
      } catch {
        continue;
      }
      if (!st.isFile()) continue;
      const ext = m[3]!;
      out.push({
        id,
        day: m[1]!,
        hour: m[2]!.slice(-2),
        kind: KIND[ext] ?? "app",
        name,
        size: st.size,
        mtime: st.mtime.toISOString(),
      });
      if (out.length >= max) return out;
    }
  }
  return out;
}

export function resolveLogIds(ids: string[]): { abs: string; id: string; mtime: Date }[] {
  const target = logRoot();
  if (!target) return [];
  const rootAbs = path.resolve(target.root);
  const seen = new Set<string>();
  const out: { abs: string; id: string; mtime: Date }[] = [];
  for (const raw of ids) {
    const id = String(raw || "").replace(/\\/g, "/").trim();
    if (!LOG_ID_RE.test(id) || seen.has(id)) continue;
    seen.add(id);
    const abs = path.resolve(rootAbs, id);
    const rel = path.relative(rootAbs, abs);
    if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) continue;
    try {
      const st = fs.statSync(abs);
      if (!st.isFile()) continue;
      out.push({ abs, id, mtime: st.mtime });
    } catch {
      // skip missing
    }
  }
  return out;
}
