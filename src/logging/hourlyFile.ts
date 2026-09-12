import { Writable } from "node:stream";
import fs from "node:fs";
import path from "node:path";

export type HourParts = { day: string; hour: string };

export function hourParts(at = new Date()): HourParts {
  const y = at.getFullYear();
  const m = String(at.getMonth() + 1).padStart(2, "0");
  const d = String(at.getDate()).padStart(2, "0");
  const h = String(at.getHours()).padStart(2, "0");
  return { day: `${y}${m}${d}`, hour: `${y}${m}${d}${h}` };
}

export function logFilePath(root: string, ext: string, at = new Date()): string {
  const { day, hour } = hourParts(at);
  const suffix = ext.startsWith(".") ? ext : `.${ext}`;
  return path.join(root, day, `${hour}${suffix}`);
}

export class HourlyLogStream extends Writable {
  private fd: number | null = null;
  private currentFile = "";
  private rolling = false;

  constructor(
    private readonly root: string,
    private readonly ext = ".log",
  ) {
    super({ decodeStrings: false, highWaterMark: 64 * 1024 });
  }

  currentPath(): string {
    return this.currentFile;
  }

  override _write(
    chunk: Buffer | string,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    const buf = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    try {
      this.ensureOpen();
      const fd = this.fd;
      if (fd == null) {
        callback(new Error("log file not open"));
        return;
      }
      fs.write(fd, buf, (err) => callback(err));
    } catch (err) {
      callback(err instanceof Error ? err : new Error(String(err)));
    }
  }

  override _final(callback: (error?: Error | null) => void): void {
    this.closeFd(callback);
  }

  override _destroy(error: Error | null, callback: (error?: Error | null) => void): void {
    this.closeFd((closeErr) => callback(error ?? closeErr));
  }

  private ensureOpen(): void {
    const next = logFilePath(this.root, this.ext);
    if (this.fd != null && next === this.currentFile) return;
    if (this.rolling) return;
    this.rolling = true;
    try {
      const dir = path.dirname(next);
      fs.mkdirSync(dir, { recursive: true });
      const newFd = fs.openSync(next, "a");
      const oldFd = this.fd;
      this.fd = newFd;
      this.currentFile = next;
      if (oldFd != null) {
        try {
          fs.closeSync(oldFd);
        } catch {
          // ignore close of previous hour
        }
      }
    } finally {
      this.rolling = false;
    }
  }

  private closeFd(callback: (error?: Error | null) => void): void {
    const fd = this.fd;
    this.fd = null;
    this.currentFile = "";
    if (fd == null) {
      callback();
      return;
    }
    fs.close(fd, callback);
  }
}
