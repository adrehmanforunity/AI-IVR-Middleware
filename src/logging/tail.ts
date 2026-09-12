import fs from "node:fs";
import { getLogTarget } from "./index.js";
import { logFilePath } from "./hourlyFile.js";

export type LogKind = "app" | "ami" | "ari";

const EXT: Record<LogKind, string> = {
  app: ".log",
  ami: ".AMI",
  ari: ".ARI",
};

export function tailLog(kind: LogKind, maxBytes = 48_000): { path: string | null; text: string; missing: boolean } {
  const target = getLogTarget();
  if (!target?.root) {
    return { path: null, text: "", missing: true };
  }
  const file = logFilePath(target.root, EXT[kind]);
  try {
    const st = fs.statSync(file);
    const size = st.size;
    const start = Math.max(0, size - maxBytes);
    const len = size - start;
    if (len <= 0) return { path: file, text: "", missing: false };
    const fd = fs.openSync(file, "r");
    try {
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, start);
      let text = buf.toString("utf8");
      if (start > 0) {
        const nl = text.indexOf("\n");
        if (nl >= 0) text = text.slice(nl + 1);
      }
      return { path: file, text, missing: false };
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return { path: file, text: "", missing: true };
  }
}
