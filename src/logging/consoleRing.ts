import { Writable } from "node:stream";

export const CONSOLE_MAX_LINES = 250;
const MAX_LINE_CHARS = 2_048;
const MAX_CARRY = 4_096;
const MAX_SSE = 2;
const FLUSH_MS = 250;
const BATCH_MAX = 40;

export type ConsoleBatch = { t: "batch"; lines: string[]; dropped: number };

type Sub = {
  send: (batch: ConsoleBatch) => boolean;
  cursor: number;
  blocked: boolean;
};

export class ConsoleRing {
  private readonly lines: string[] = [];
  private seq = 0;
  private carry = "";
  private readonly subs = new Set<Sub>();
  private timer: ReturnType<typeof setInterval> | null = null;

  get subscriberCount(): number {
    return this.subs.size;
  }

  canSubscribe(): boolean {
    return this.subs.size < MAX_SSE;
  }

  snapshot(): string[] {
    return this.lines.slice();
  }

  subscribe(send: (batch: ConsoleBatch) => boolean): () => void {
    const sub: Sub = { send, cursor: this.seq, blocked: false };
    this.subs.add(sub);
    this.ensureTimer();
    return () => {
      this.subs.delete(sub);
      if (this.subs.size === 0) this.stopTimer();
    };
  }

  markWritable(send: (batch: ConsoleBatch) => boolean): void {
    for (const sub of this.subs) {
      if (sub.send === send) sub.blocked = false;
    }
  }

  pushChunk(chunk: string): void {
    this.carry += chunk;
    if (this.carry.length > MAX_CARRY) {
      this.addLine(this.carry.slice(0, MAX_LINE_CHARS));
      this.carry = "";
      return;
    }
    const parts = this.carry.split("\n");
    this.carry = parts.pop() ?? "";
    for (const part of parts) this.addLine(part);
  }

  private addLine(raw: string): void {
    if (!raw) return;
    const line = raw.length > MAX_LINE_CHARS ? `${raw.slice(0, MAX_LINE_CHARS)}…` : raw;
    this.seq += 1;
    this.lines.push(line);
    if (this.lines.length > CONSOLE_MAX_LINES) this.lines.splice(0, this.lines.length - CONSOLE_MAX_LINES);
  }

  private linesSince(cursor: number): { lines: string[]; dropped: number } {
    const startSeq = this.seq - this.lines.length;
    if (cursor <= startSeq) {
      return { lines: this.lines.slice(), dropped: Math.max(0, startSeq - cursor) };
    }
    const idx = cursor - startSeq;
    return { lines: this.lines.slice(idx), dropped: 0 };
  }

  private flush(): void {
    if (this.subs.size === 0) return;
    for (const sub of this.subs) {
      if (sub.blocked) continue;
      const next = this.linesSince(sub.cursor);
      sub.cursor = this.seq;
      if (!next.lines.length && !next.dropped) continue;
      let { lines, dropped } = next;
      if (lines.length > BATCH_MAX) {
        dropped += lines.length - BATCH_MAX;
        lines = lines.slice(-BATCH_MAX);
      }
      const ok = sub.send({ t: "batch", lines, dropped });
      if (!ok) sub.blocked = true;
    }
  }

  private ensureTimer(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.flush(), FLUSH_MS);
    this.timer.unref();
  }

  private stopTimer(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

export const consoleRing = new ConsoleRing();

export function consoleTeeStream(): Writable {
  return new Writable({
    decodeStrings: false,
    write(chunk, _enc, cb) {
      const text = typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
      try {
        consoleRing.pushChunk(text);
      } catch {
        // never throw from the log path
      }
      if (process.stdout.write(chunk)) cb();
      else process.stdout.once("drain", cb);
    },
  });
}
