import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const HOST_CRITICAL_PCT = 75;

export type DiskKind = "fixed" | "removable" | "network" | "optical" | "unknown";

export type DiskSample = {
  label: string;
  path: string;
  device: string;
  fstype: string;
  kind: DiskKind;
  usedPct: number;
  totalBytes: number;
  freeBytes: number;
  iimRoles: string[];
};

export type HostOver = {
  resource: "cpu" | "memory" | "disk";
  pct: number;
  detail: string;
};

export type HostSnapshot = {
  at: string;
  hostname: string;
  platform: string;
  osFamily: "windows" | "linux" | "darwin" | "other";
  arch: string;
  cpuModel: string;
  cores: number;
  loadAvg: number[];
  cpuPct: number | null;
  memoryPct: number;
  memoryUsedBytes: number;
  memoryTotalBytes: number;
  processRssBytes: number;
  disks: DiskSample[];
  diskCount: number;
  diskCriticalCount: number;
  thresholdPct: number;
  over: HostOver[];
  critical: boolean;
};

type CpuTick = { idle: number; total: number };

type MountHint = {
  device: string;
  mount: string;
  fstype: string;
  kind: DiskKind;
  volumeName: string;
};

const SKIP_FS = new Set([
  "proc",
  "sysfs",
  "devtmpfs",
  "devpts",
  "tmpfs",
  "cgroup",
  "cgroup2",
  "pstore",
  "bpf",
  "securityfs",
  "debugfs",
  "tracefs",
  "fusectl",
  "mqueue",
  "hugetlbfs",
  "configfs",
  "overlay",
  "squashfs",
  "autofs",
  "rpc_pipefs",
  "binfmt_misc",
  "nsfs",
  "efivarfs",
  "ramfs",
  "none",
  "map",
  "devfs",
  "fuse.gvfsd-fuse",
]);

const SKIP_MOUNT_PREFIX = ["/proc", "/sys", "/dev", "/run", "/snap", "/var/lib/docker", "/var/lib/containers"];

export class HostSampler {
  private lastCpu: CpuTick | null = null;
  private cpuPct: number | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private kick: ReturnType<typeof setTimeout> | null = null;
  private mountCache: { at: number; mounts: MountHint[] } | null = null;

  constructor(private readonly iimPaths: Array<{ label: string; path: string }>) {}

  start(): void {
    this.stop();
    this.sampleCpu();
    this.kick = setTimeout(() => this.sampleCpu(), 1000);
    this.kick.unref();
    this.timer = setInterval(() => this.sampleCpu(), 5000);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.kick) clearTimeout(this.kick);
    this.timer = null;
    this.kick = null;
  }

  snapshot(): HostSnapshot {
    const total = os.totalmem();
    const free = os.freemem();
    const used = Math.max(0, total - free);
    const memoryPct = total > 0 ? round1((used / total) * 100) : 0;
    const disks = this.readDisks();
    const over: HostOver[] = [];
    if (this.cpuPct != null && this.cpuPct >= HOST_CRITICAL_PCT) {
      over.push({ resource: "cpu", pct: this.cpuPct, detail: `host CPU ${this.cpuPct}%` });
    }
    if (memoryPct >= HOST_CRITICAL_PCT) {
      over.push({ resource: "memory", pct: memoryPct, detail: `host memory ${memoryPct}%` });
    }
    for (const d of disks) {
      if (d.usedPct >= HOST_CRITICAL_PCT) {
        over.push({ resource: "disk", pct: d.usedPct, detail: `${d.label} ${d.usedPct}% (${d.path})` });
      }
    }
    const plat = os.platform();
    const cpus = os.cpus();
    return {
      at: new Date().toISOString(),
      hostname: os.hostname(),
      platform: `${plat} ${os.release()}`,
      osFamily: plat === "win32" ? "windows" : plat === "linux" ? "linux" : plat === "darwin" ? "darwin" : "other",
      arch: os.arch(),
      cpuModel: cpus[0]?.model?.trim() || "CPU",
      cores: cpus.length,
      loadAvg: os.loadavg(),
      cpuPct: this.cpuPct,
      memoryPct,
      memoryUsedBytes: used,
      memoryTotalBytes: total,
      processRssBytes: process.memoryUsage().rss,
      disks,
      diskCount: disks.length,
      diskCriticalCount: disks.filter((d) => d.usedPct >= HOST_CRITICAL_PCT).length,
      thresholdPct: HOST_CRITICAL_PCT,
      over,
      critical: over.length > 0,
    };
  }

  private sampleCpu(): void {
    const now = cpuTick();
    if (this.lastCpu) {
      const idle = now.idle - this.lastCpu.idle;
      const total = now.total - this.lastCpu.total;
      this.cpuPct = total > 0 ? round1(((total - idle) / total) * 100) : 0;
    }
    this.lastCpu = now;
  }

  private listMounts(): MountHint[] {
    const now = Date.now();
    if (this.mountCache && now - this.mountCache.at < 30_000) return this.mountCache.mounts;
    const mounts = discoverMounts();
    this.mountCache = { at: now, mounts };
    return mounts;
  }

  private readDisks(): DiskSample[] {
    const byKey = new Map<string, DiskSample>();
    for (const hint of this.listMounts()) {
      const sample = probeMount(hint);
      if (!sample) continue;
      const key = `${sample.device}|${sample.path}`;
      if (!byKey.has(key)) byKey.set(key, sample);
    }

    for (const role of this.iimPaths) {
      const probe = existingDir(role.path);
      if (!probe) continue;
      const match = [...byKey.values()].find((d) => pathIsOnMount(probe, d.path));
      if (match) {
        if (!match.iimRoles.includes(role.label)) match.iimRoles.push(role.label);
        continue;
      }
      const extra = probeMount({
        device: "",
        mount: probe,
        fstype: "",
        kind: "unknown",
        volumeName: role.label,
      });
      if (extra) {
        extra.iimRoles.push(role.label);
        extra.label = extra.label || role.label;
        byKey.set(`${extra.device}|${extra.path}`, extra);
      }
    }

    return [...byKey.values()].sort((a, b) => a.path.localeCompare(b.path, undefined, { sensitivity: "base" }));
  }
}

function discoverMounts(): MountHint[] {
  const plat = os.platform();
  if (plat === "win32") return listWindowsMounts();
  if (plat === "linux") return listLinuxMounts();
  return listPosixDfMounts();
}

function listWindowsMounts(): MountHint[] {
  const letters = new Map<string, MountHint>();
  for (let code = 67; code <= 90; code++) {
    const letter = String.fromCharCode(code);
    const mount = `${letter}:\\`;
    try {
      if (!fs.existsSync(mount)) continue;
    } catch {
      continue;
    }
    letters.set(letter, {
      device: mount,
      mount,
      fstype: "",
      kind: "unknown",
      volumeName: "",
    });
  }

  for (const row of windowsLogicalDisks()) {
    const id = String(row.DeviceID || "").replace(/\\+$/, "");
    const letter = id.replace(":", "").toUpperCase();
    if (!letter) continue;
    const mount = `${letter}:\\`;
    const kind = windowsDriveKind(Number(row.DriveType));
    letters.set(letter, {
      device: String(row.DeviceID || mount),
      mount,
      fstype: String(row.FileSystem || ""),
      kind,
      volumeName: String(row.VolumeName || "").trim(),
    });
  }

  return [...letters.values()].filter((m) => m.kind !== "optical" || volumeHasCapacity(m.mount));
}

type WinDiskRow = {
  DeviceID?: string;
  DriveType?: number;
  FileSystem?: string;
  VolumeName?: string;
};

function windowsLogicalDisks(): WinDiskRow[] {
  try {
    const raw = execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "Get-CimInstance -ClassName Win32_LogicalDisk | Select-Object DeviceID,DriveType,FileSystem,VolumeName | ConvertTo-Json -Compress",
      ],
      { encoding: "utf8", timeout: 8000, windowsHide: true },
    ).trim();
    if (!raw) return [];
    const parsed = JSON.parse(raw) as WinDiskRow | WinDiskRow[];
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
  }
}

function windowsDriveKind(driveType: number): DiskKind {
  if (driveType === 2) return "removable";
  if (driveType === 3) return "fixed";
  if (driveType === 4) return "network";
  if (driveType === 5) return "optical";
  return "unknown";
}

function listLinuxMounts(): MountHint[] {
  let text = "";
  try {
    text = fs.readFileSync("/proc/mounts", "utf8");
  } catch {
    try {
      text = fs.readFileSync("/etc/mtab", "utf8");
    } catch {
      return listPosixDfMounts();
    }
  }
  const out: MountHint[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const parts = line.split(" ");
    const deviceRaw = parts[0];
    const mountRaw = parts[1];
    const fstype = parts[2];
    if (!deviceRaw || !mountRaw || !fstype) continue;
    const device = unescapeMount(deviceRaw);
    const mount = unescapeMount(mountRaw);
    if (SKIP_FS.has(fstype)) continue;
    if (skipUnixMount(mount)) continue;
    out.push({ device, mount, fstype, kind: kindFromFs(fstype, device), volumeName: "" });
  }
  return dedupeUnixMounts(out);
}

function listPosixDfMounts(): MountHint[] {
  try {
    const text = execFileSync("df", ["-P"], { encoding: "utf8", timeout: 8000 }).trim();
    const lines = text.split("\n").slice(1);
    const out: MountHint[] = [];
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 6) continue;
      const device = parts[0] ?? "";
      const mount = parts.slice(5).join(" ");
      if (device === "map" || device === "devfs" || skipUnixMount(mount)) continue;
      out.push({ device, mount, fstype: "", kind: kindFromFs("", device), volumeName: "" });
    }
    return dedupeUnixMounts(out);
  } catch {
    return [{ device: "", mount: "/", fstype: "", kind: "fixed", volumeName: "" }];
  }
}

function skipUnixMount(mount: string): boolean {
  if (mount === "/") return false;
  return SKIP_MOUNT_PREFIX.some((p) => mount === p || mount.startsWith(`${p}/`));
}

function kindFromFs(fstype: string, device: string): DiskKind {
  const fsName = fstype.toLowerCase();
  if (fsName.includes("nfs") || fsName === "cifs" || fsName === "smb" || fsName === "smbfs") return "network";
  if (device.startsWith("//") || device.includes(":")) {
    if (device.startsWith("//")) return "network";
  }
  return "fixed";
}

function dedupeUnixMounts(mounts: MountHint[]): MountHint[] {
  const byDev = new Map<string, MountHint>();
  for (const m of mounts) {
    const key = m.device || m.mount;
    const existing = byDev.get(key);
    if (!existing || m.mount.length < existing.mount.length) byDev.set(key, m);
  }
  return [...byDev.values()];
}

function unescapeMount(s: string): string {
  return s
    .replace(/\\040/g, " ")
    .replace(/\\011/g, "\t")
    .replace(/\\012/g, "\n")
    .replace(/\\134/g, "\\");
}

function existingDir(raw: string): string | null {
  try {
    const abs = path.resolve(raw);
    const probe = fs.existsSync(abs) ? abs : path.dirname(abs);
    return fs.existsSync(probe) ? probe : null;
  } catch {
    return null;
  }
}

function volumeHasCapacity(mount: string): boolean {
  try {
    const fsStat = fs.statfsSync(mount);
    return Number(fsStat.blocks) * Number(fsStat.bsize) > 0;
  } catch {
    return false;
  }
}

function probeMount(hint: MountHint): DiskSample | null {
  try {
    if (!fs.existsSync(hint.mount)) return null;
    const fsStat = fs.statfsSync(hint.mount);
    const total = Number(fsStat.blocks) * Number(fsStat.bsize);
    const free = Number(fsStat.bavail) * Number(fsStat.bsize);
    if (!(total > 0)) return null;
    const usedPct = round1(((total - free) / total) * 100);
    return {
      label: diskLabel(hint),
      path: hint.mount,
      device: hint.device,
      fstype: hint.fstype,
      kind: hint.kind,
      usedPct,
      totalBytes: total,
      freeBytes: free,
      iimRoles: [],
    };
  } catch {
    return null;
  }
}

function diskLabel(hint: MountHint): string {
  if (process.platform === "win32") {
    const letter = hint.mount.replace(/\\+$/, "");
    return hint.volumeName ? `${letter} ${hint.volumeName}` : letter;
  }
  if (hint.mount === "/") return "Root /";
  return hint.mount;
}

function pathIsOnMount(absPath: string, mount: string): boolean {
  const normPath = path.resolve(absPath);
  const normMount = path.resolve(mount);
  if (process.platform === "win32") {
    return path.parse(normPath).root.toUpperCase() === path.parse(normMount).root.toUpperCase();
  }
  if (normPath === normMount) return true;
  const prefix = normMount.endsWith(path.sep) ? normMount : `${normMount}${path.sep}`;
  return normPath.startsWith(prefix);
}

function cpuTick(): CpuTick {
  let idle = 0;
  let total = 0;
  for (const cpu of os.cpus()) {
    idle += cpu.times.idle;
    total += cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.idle + cpu.times.irq;
  }
  return { idle, total };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function formatBytes(n: number): string {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} GB`;
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(0)} MB`;
  return `${Math.round(n / 1024)} KB`;
}
