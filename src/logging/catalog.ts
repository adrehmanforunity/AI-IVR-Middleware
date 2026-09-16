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

export function logRoot(): { root: string; source: "configured" | "temp"; primaryRoot?: string; fallbackRoot?: string } | null {
  const t = getLogTarget();
  if (!t?.root) return null;
  return { root: t.root, source: t.source, primaryRoot: t.primaryRoot, fallbackRoot: t.fallbackRoot };
}

function searchRoots(): string[] {
  const t = getLogTarget();
  if (!t?.root) return [];
  const roots = [t.root, t.primaryRoot, t.fallbackRoot].filter(Boolean);
  return [...new Set(roots.map((r) => path.resolve(r)))];
}

export function listLogFiles(max = 400): LogFileInfo[] {
  const byId = new Map<string, LogFileInfo>();
  for (const root of searchRoots()) {
    let days: string[] = [];
    try {
      days = fs
        .readdirSync(root, { withFileTypes: true })
        .filter((d) => d.isDirectory() && /^\d{8}$/.test(d.name))
        .map((d) => d.name);
    } catch {
      continue;
    }
    for (const day of days) {
      const dir = path.join(root, day);
      let names: string[] = [];
      try {
        names = fs.readdirSync(dir);
      } catch {
        continue;
      }
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
        const row: LogFileInfo = {
          id,
          day: m[1]!,
          hour: m[2]!.slice(-2),
          kind: KIND[ext] ?? "app",
          name,
          size: st.size,
          mtime: st.mtime.toISOString(),
        };
        const prev = byId.get(id);
        if (!prev || prev.mtime < row.mtime) byId.set(id, row);
      }
    }
  }
  return [...byId.values()]
    .sort((a, b) => b.id.localeCompare(a.id))
    .slice(0, max);
}

export function resolveLogIds(ids: string[]): { abs: string; id: string; mtime: Date }[] {
  const roots = searchRoots();
  if (!roots.length) return [];
  const seen = new Set<string>();
  const out: { abs: string; id: string; mtime: Date }[] = [];
  for (const raw of ids) {
    const id = String(raw || "").replace(/\\/g, "/").trim();
    if (!LOG_ID_RE.test(id) || seen.has(id)) continue;
    seen.add(id);
    let best: { abs: string; id: string; mtime: Date } | null = null;
    for (const rootAbs of roots) {
      const abs = path.resolve(rootAbs, id);
      const rel = path.relative(rootAbs, abs);
      if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) continue;
      try {
        const st = fs.statSync(abs);
        if (!st.isFile()) continue;
        if (!best || st.mtime > best.mtime) best = { abs, id, mtime: st.mtime };
      } catch {
        // try next root
      }
    }
    if (best) out.push(best);
  }
  return out;
}
