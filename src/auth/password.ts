import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const KEY_LEN = 64;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, KEY_LEN);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split(":");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return false;
  const salt = Buffer.from(parts[0], "hex");
  const expected = Buffer.from(parts[1], "hex");
  if (expected.length !== KEY_LEN) return false;
  const actual = scryptSync(password, salt, KEY_LEN);
  return timingSafeEqual(expected, actual);
}

export function newSessionToken(): string {
  return randomBytes(32).toString("hex");
}
