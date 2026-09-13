import fs from "node:fs";
import { crc32, deflateRawSync, gzipSync } from "node:zlib";

export const MAX_DOWNLOAD_BYTES = 180 * 1024 * 1024;
export const MAX_DOWNLOAD_FILES = 200;

function dosDateTime(d: Date): { time: number; date: number } {
  const y = Math.max(1980, d.getFullYear());
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const date = ((y - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

function u16(n: number): Buffer {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n & 0xffff);
  return b;
}

function u32(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n >>> 0);
  return b;
}

export function zipFiles(files: { id: string; data: Buffer; mtime: Date }[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.id.replace(/\\/g, "/"), "utf8");
    const { time, date } = dosDateTime(file.mtime);
    const crc = crc32(file.data) >>> 0;
    const deflated = deflateRawSync(file.data);
    const store = deflated.length >= file.data.length;
    const payload = store ? file.data : deflated;
    const method = store ? 0 : 8;
    const local = Buffer.concat([
      Buffer.from([0x50, 0x4b, 0x03, 0x04]),
      u16(20),
      u16(0),
      u16(method),
      u16(time),
      u16(date),
      u32(crc),
      u32(payload.length),
      u32(file.data.length),
      u16(name.length),
      u16(0),
      name,
      payload,
    ]);
    const central = Buffer.concat([
      Buffer.from([0x50, 0x4b, 0x01, 0x02]),
      u16(20),
      u16(20),
      u16(0),
      u16(method),
      u16(time),
      u16(date),
      u32(crc),
      u32(payload.length),
      u32(file.data.length),
      u16(name.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(offset),
      name,
    ]);
    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const eocd = Buffer.concat([
    Buffer.from([0x50, 0x4b, 0x05, 0x06]),
    u16(0),
    u16(0),
    u16(files.length),
    u16(files.length),
    u32(centralBuf.length),
    u32(offset),
    u16(0),
  ]);
  return Buffer.concat([...locals, centralBuf, eocd]);
}

function tarHeader(name: string, size: number, mtime: Date): Buffer {
  const buf = Buffer.alloc(512);
  buf.write(name, 0, Math.min(name.length, 99), "utf8");
  buf.write("0000644\0", 100, 8, "utf8");
  buf.write("0000000\0", 108, 8, "utf8");
  buf.write("0000000\0", 116, 8, "utf8");
  buf.write(`${size.toString(8).padStart(11, "0")}\0`, 124, 12, "utf8");
  const sec = Math.floor(mtime.getTime() / 1000);
  buf.write(`${sec.toString(8).padStart(11, "0")}\0`, 136, 12, "utf8");
  buf.write("        ", 148, 8, "utf8");
  buf[156] = 0x30;
  buf.write("ustar\0", 257, 6, "utf8");
  buf.write("00", 263, 2, "utf8");
  let sum = 0;
  for (const b of buf) sum += b;
  buf.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148, 8, "utf8");
  return buf;
}

export function tarFiles(files: { id: string; data: Buffer; mtime: Date }[]): Buffer {
  const parts: Buffer[] = [];
  for (const file of files) {
    const name = file.id.replace(/\\/g, "/");
    parts.push(tarHeader(name, file.data.length, file.mtime));
    parts.push(file.data);
    const pad = (512 - (file.data.length % 512)) % 512;
    if (pad) parts.push(Buffer.alloc(pad));
  }
  parts.push(Buffer.alloc(1024));
  return Buffer.concat(parts);
}

export function gzipBuffer(data: Buffer): Buffer {
  return gzipSync(data);
}

export function readSelected(
  files: { abs: string; id: string; mtime: Date }[],
): { id: string; data: Buffer; mtime: Date }[] {
  let total = 0;
  const out: { id: string; data: Buffer; mtime: Date }[] = [];
  for (const f of files) {
    const data = fs.readFileSync(f.abs);
    total += data.length;
    if (total > MAX_DOWNLOAD_BYTES) {
      throw Object.assign(new Error("selected logs are too large to download at once"), { code: "PAYLOAD_TOO_LARGE" });
    }
    out.push({ id: f.id, data, mtime: f.mtime });
  }
  return out;
}
