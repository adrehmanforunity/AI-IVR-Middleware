import { Writable } from "node:stream";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type HourParts = { day: string; hour: string };

export type LogPlace = {
  primaryRoot: string;
  fallbackRoot: string;
  activeRoot: string;
  source: "configured" | "temp";
};

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

export function osFallbackLogRoot(): string {
  return path.join(os.tmpdir(), "iim-logs");
}

/** Create the directory and prove we can write a file (Windows W_OK is not enough). */
export function probeWritableDir(dir: string): boolean {
  const probe = path.join(dir, `.iim-write-${process.pid}-${Date.now()}`);
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(probe, "ok");
    fs.unlinkSync(probe);
    return true;
  } catch {
    try {
      fs.unlinkSync(probe);
    } catch {
      // ignore
    }
    return false;
  }
}

export function pickLogPlace(configured: string): LogPlace {
  const wanted = path.resolve((configured || "./logs").trim() || "./logs");
  const fallbackRoot = osFallbackLogRoot();
  if (probeWritableDir(wanted)) {
    return { primaryRoot: wanted, fallbackRoot, activeRoot: wanted, source: "configured" };
  }
  if (probeWritableDir(fallbackRoot)) {
    return { primaryRoot: wanted, fallbackRoot, activeRoot: fallbackRoot, source: "temp" };
  }
  return { primaryRoot: wanted, fallbackRoot, activeRoot: fallbackRoot, source: "temp" };
}

export class HourlyLogStream extends Writable {
  private fd: number | null = null;
  private currentFile = "";

  constructor(
    private readonly place: LogPlace,
    private readonly ext = ".log",
    private readonly onRootChange?: () => void,
  ) {
    super({ decodeStrings: false, highWaterMark: 64 * 1024 });
  }

  currentPath(): string {
    return this.currentFile;
  }

  /** Create today's date folder and hour file before the first event. */
  prime(): void {
    try {
      this.ensureOpen();
    } catch (err) {
      this.failover(err);
      try {
        this.ensureOpen();
      } catch (err2) {
        process.stderr.write(
          `iim ${this.ext} log open failed: ${err2 instanceof Error ? err2.message : String(err2)}\n`,
        );
      }
    }
  }

  override _write(
    chunk: Buffer | string,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    const buf = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    try {
      this.writeAll(buf);
    } catch (err) {
      this.failover(err);
      try {
        this.writeAll(buf);
      } catch (err2) {
        process.stderr.write(
          `iim ${this.ext} log write dropped: ${err2 instanceof Error ? err2.message : String(err2)}\n`,
        );
      }
    }
    callback();
  }

  override _final(callback: (error?: Error | null) => void): void {
    this.closeFd(callback);
  }

  override _destroy(error: Error | null, callback: (error?: Error | null) => void): void {
    this.closeFd((closeErr) => callback(error ?? closeErr));
  }

  private writeAll(buf: Buffer): void {
    this.ensureOpen();
    const fd = this.fd;
    if (fd == null) throw new Error("log file not open");
    fs.writeSync(fd, buf);
  }

  private ensureOpen(): void {
    const next = logFilePath(this.place.activeRoot, this.ext);
    if (this.fd != null && next === this.currentFile && fs.existsSync(next)) return;
    if (this.fd != null) this.abandonFd();
    this.openPath(next);
  }

  private failover(err: unknown): void {
    process.stderr.write(
      `iim ${this.ext} log write failed at ${this.currentFile || this.place.activeRoot}: ${
        err instanceof Error ? err.message : String(err)
      }\n`,
    );
    this.abandonFd();
    if (this.place.activeRoot === this.place.fallbackRoot) return;
    if (!probeWritableDir(this.place.fallbackRoot)) {
      process.stderr.write(`iim fallback log dir not writable: ${this.place.fallbackRoot}\n`);
      return;
    }
    this.place.activeRoot = this.place.fallbackRoot;
    this.place.source = "temp";
    process.stderr.write(`iim logging switched to ${this.place.activeRoot}\n`);
    this.onRootChange?.();
  }

  private abandonFd(): void {
    if (this.fd == null) {
      this.currentFile = "";
      return;
    }
    try {
      fs.closeSync(this.fd);
    } catch {
      // ignore
    }
    this.fd = null;
    this.currentFile = "";
  }

  private openPath(next: string): void {
    fs.mkdirSync(path.dirname(next), { recursive: true });
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
