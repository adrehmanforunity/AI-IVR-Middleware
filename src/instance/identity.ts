import { randomUUID } from "node:crypto";

export const INSTANCE_ID_KEY = "iim_instance_id";
export const INSTANCE_NAME_KEY = "iim_instance_name";
export const INSTANCE_DESC_KEY = "iim_instance_description";

export type IimInstance = {
  id: string;
  name: string;
  description: string;
};

export function newInstanceId(): string {
  return randomUUID();
}

export function parseInstance(settings: Record<string, string>): IimInstance {
  const id = (settings[INSTANCE_ID_KEY] ?? "").trim();
  const name = (settings[INSTANCE_NAME_KEY] ?? "").trim();
  return {
    id,
    name: name || "IIM",
    description: (settings[INSTANCE_DESC_KEY] ?? "").trim(),
  };
}

export function normalizeInstanceId(raw: string): string {
  const value = raw.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{1,63}$/.test(value)) return "";
  return value;
}

export function normalizeInstanceName(raw: string): string {
  return raw.trim().slice(0, 80);
}

export function normalizeInstanceDescription(raw: string): string {
  return raw.trim().slice(0, 500);
}
