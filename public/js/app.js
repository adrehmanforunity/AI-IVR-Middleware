async function api(path, opts = {}) {
  const res = await fetch(path, { credentials: "same-origin", ...opts });
  if (res.status === 401) {
    window.location.href = "/";
    throw new Error("unauthorized");
  }
  return res;
}

function hourGreet() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

function pill(state) {
  if (state === "connected") return `<span class="ok">${esc(state)}</span>`;
  if (state === "degraded" || state === "connecting") return `<span class="warn">${esc(state)}</span>`;
  return `<span class="bad">${esc(state)}</span>`;
}

function languageLabel(n) {
  return {
    0: "Urdu",
    1: "English",
    2: "Sindhi",
    3: "Pashto",
    4: "Arabic",
    5: "Other 5",
    6: "Other 6",
    7: "Other 7",
    8: "Other 8",
    9: "Other 9",
  }[n] || "Urdu";
}

function stageTag(state) {
  return `<span class="stage stage-${esc(state)}">${esc(state)}</span>`;
}

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/"/g, "&quot;");
}

function hostPct(n) {
  if (n == null || Number.isNaN(n)) return "—";
  return `${n}%`;
}

function hostClass(n, threshold) {
  return n != null && n >= threshold ? "bad" : "ok";
}

function kpiCard(title, value, iconName, hot, sub) {
  const tone = hot ? "bg-danger-lt text-danger" : "bg-primary-lt text-primary";
  return `<div class="col-sm-6 col-xl-2">
    <div class="card card-sm">
      <div class="card-body">
        <div class="row align-items-center">
          <div class="col-auto"><span class="avatar ${tone}">${window.iimIcon(iconName)}</span></div>
          <div class="col">
            <div class="subheader">${esc(title)}</div>
            <div class="h1 mb-0${hot ? " text-danger" : ""}">${value}</div>
            ${sub ? `<div class="text-secondary small">${esc(sub)}</div>` : ""}
          </div>
        </div>
      </div>
    </div>
  </div>`;
}

function kindLabel(kind) {
  return { fixed: "Local", removable: "Removable", network: "Network", optical: "Optical", unknown: "Volume" }[kind] || "Volume";
}

function osFamilyLabel(family) {
  return { windows: "Windows", linux: "Linux", darwin: "macOS", other: "Host" }[family] || "Host";
}

function diskCards(host, th) {
  const disks = host.disks || [];
  if (!disks.length) return '<p class="text-secondary mb-0">No readable volumes on this OS yet.</p>';
  return `<div class="row row-cards">${disks
    .map((d) => {
      const hot = d.usedPct >= th;
      const roles = (d.iimRoles || []).length ? ` · IIM: ${(d.iimRoles || []).join(", ")}` : "";
      const meta = [kindLabel(d.kind), d.fstype, d.device].filter(Boolean).join(" · ");
      return `<div class="col-md-6 col-xl-4">
        <div class="card ${hot ? "border-danger" : ""}">
          <div class="card-body">
            <div class="d-flex align-items-center mb-2">
              <span class="avatar ${hot ? "bg-danger-lt text-danger" : "bg-primary-lt text-primary"} me-2">${window.iimIcon("hard-drive")}</span>
              <div>
                <div class="fw-bold">${esc(d.label)}</div>
                <div class="text-secondary small">${esc(d.path)}${esc(roles)}</div>
              </div>
              <div class="ms-auto h2 mb-0 host-pct ${hostClass(d.usedPct, th)}">${hostPct(d.usedPct)}</div>
            </div>
            <div class="progress progress-sm mb-2">
              <div class="progress-bar${hot ? " bg-danger" : ""}" style="width:${Math.min(100, Math.max(2, d.usedPct))}%"></div>
            </div>
            <div class="text-secondary small">${esc(fmtBytes(d.totalBytes - d.freeBytes))} used of ${esc(fmtBytes(d.totalBytes))} · ${esc(fmtBytes(d.freeBytes))} free</div>
            <div class="text-secondary small">${esc(meta)}</div>
          </div>
        </div>
      </div>`;
    })
    .join("")}</div>`;
}

function fmtBytes(n) {
  if (n == null) return "—";
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} GB`;
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(0)} MB`;
  return `${Math.round(n / 1024)} KB`;
}

function barRow(label, value, max) {
  const pct = max > 0 ? Math.max(4, Math.round((value / max) * 100)) : 0;
  return `<div class="bar-row"><span class="bar-lab">${esc(label)}</span><div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div><span class="bar-n">${value}</span></div>`;
}

function trunkHistoryTable(rows) {
  if (!rows.length) return "";
  return `<table class="table"><thead><tr><th>Trunk (from calls)</th><th>24h</th><th>Busy</th></tr></thead><tbody>${rows
    .map((t) => `<tr><td>${esc(t.key)}</td><td>${t.total}</td><td>${t.aicb}</td></tr>`)
    .join("")}</tbody></table>`;
}

const LIVE_STAGES = ["ringing", "screened", "session", "ivr", "queued", "talking"];

async function bootUser() {
  const me = await (await api("/auth/me")).json();
  const initial = (me.username || "S").slice(0, 1).toUpperCase();
  document.getElementById("who").textContent = me.username;
  document.getElementById("avatar").textContent = initial;
  const hello = document.getElementById("hello-avatar");
  if (hello) hello.textContent = initial;
  document.getElementById("greet").textContent = `${hourGreet()}, ${me.username}!`;
}

async function refresh() {
  const dash = await (await api("/v1/reports/dashboard")).json();
  const live = dash.live || {};
  const hist = dash.history || {};
  const perf = dash.performance || {};
  const by = live.byState || {};

  document.getElementById("sample-banner").hidden = !dash.usingSample;
  document.getElementById("hist-title").innerHTML = `${window.iimIcon("chart-bar")} ${
    dash.usingSample ? "Sample report (24h illustration)" : "History (last 24 hours)"
  }`;

  const host = perf.host || {};
  const th = host.thresholdPct ?? 75;
  const disks = host.disks || [];
  const diskMax = Math.max(0, ...disks.map((d) => d.usedPct));
  const diskCrit = host.diskCriticalCount ?? disks.filter((d) => d.usedPct >= th).length;
  document.getElementById("kpis").innerHTML = [
    kpiCard("Live calls", String(live.activeCount ?? 0), "phone-call", false, "This process"),
    kpiCard("CPU", hostPct(host.cpuPct), "cpu", host.cpuPct >= th, `${host.cores ?? "—"} cores`),
    kpiCard("Memory", hostPct(host.memoryPct), "memory", host.memoryPct >= th, `${fmtBytes(host.memoryUsedBytes)} / ${fmtBytes(host.memoryTotalBytes)}`),
    kpiCard(
      "Disks",
      disks.length ? hostPct(diskMax) : "—",
      "hard-drive",
      diskMax >= th,
      disks.length ? `${disks.length} volume${disks.length === 1 ? "" : "s"}${diskCrit ? ` · ${diskCrit} critical` : ""}` : osFamilyLabel(host.osFamily),
    ),
    kpiCard("All channels busy", String(hist.aicb ?? 0), "alert-triangle", (hist.aicb ?? 0) > 0, "Last 24h"),
    kpiCard("Duplicate CLI blocked", String(hist.duplicateCli ?? 0), "circle-x", (hist.duplicateCli ?? 0) > 0, "Last 24h"),
    kpiCard("Critical now", String(perf.criticalNow ?? 0), "bell", (perf.criticalNow ?? 0) > 0, "Open issues"),
  ].join("");

  const load =
    host.osFamily === "windows"
      ? ""
      : host.loadAvg && host.loadAvg[0] > 0
        ? ` · load ${Number(host.loadAvg[0]).toFixed(2)}`
        : "";
  document.getElementById("host-metrics").innerHTML = `
    <div class="datagrid mb-3">
      <div class="datagrid-item"><div class="datagrid-title">Machine</div><div class="datagrid-content">${esc(host.hostname || "—")}</div></div>
      <div class="datagrid-item"><div class="datagrid-title">OS</div><div class="datagrid-content">${esc(osFamilyLabel(host.osFamily))} · ${esc(host.platform || "")} · ${esc(host.arch || "")}</div></div>
      <div class="datagrid-item"><div class="datagrid-title">CPU</div><div class="datagrid-content">${esc(host.cpuModel || "CPU")} · ${host.cores ?? "—"} cores${esc(load)}</div></div>
      <div class="datagrid-item"><div class="datagrid-title">IIM RSS</div><div class="datagrid-content">${esc(fmtBytes(host.processRssBytes))}</div></div>
    </div>
    ${host.critical ? `<div class="alert alert-warning">Host utilization at or above ${th}% — treated as critical.</div>` : ""}
    <div class="row row-cards mb-3">
      <div class="col-md-6">
        <div class="card">
          <div class="card-body">
            <div class="d-flex align-items-center mb-2">
              <span class="avatar bg-primary-lt text-primary me-2">${window.iimIcon("cpu")}</span>
              <div class="fw-bold">Processor</div>
              <div class="ms-auto h2 mb-0 host-pct ${hostClass(host.cpuPct, th)}">${hostPct(host.cpuPct)}</div>
            </div>
            <div class="progress progress-sm"><div class="progress-bar${host.cpuPct >= th ? " bg-danger" : ""}" style="width:${Math.min(100, Math.max(2, host.cpuPct || 0))}%"></div></div>
          </div>
        </div>
      </div>
      <div class="col-md-6">
        <div class="card">
          <div class="card-body">
            <div class="d-flex align-items-center mb-2">
              <span class="avatar bg-primary-lt text-primary me-2">${window.iimIcon("memory")}</span>
              <div>
                <div class="fw-bold">Memory</div>
                <div class="text-secondary small">${esc(fmtBytes(host.memoryUsedBytes))} / ${esc(fmtBytes(host.memoryTotalBytes))}</div>
              </div>
              <div class="ms-auto h2 mb-0 host-pct ${hostClass(host.memoryPct, th)}">${hostPct(host.memoryPct)}</div>
            </div>
            <div class="progress progress-sm"><div class="progress-bar${host.memoryPct >= th ? " bg-danger" : ""}" style="width:${Math.min(100, Math.max(2, host.memoryPct || 0))}%"></div></div>
          </div>
        </div>
      </div>
    </div>
    <h4 class="mb-2">Volumes</h4>
    <p class="text-secondary small">Windows: each drive letter. Linux/macOS: each real mounted partition (tmpfs/proc/docker overlays omitted). SQLite and log folders are tagged on the volume that holds them.</p>
    ${diskCards(host, th)}
  `;

  const liveMax = Math.max(1, ...LIVE_STAGES.map((s) => by[s] || 0));
  document.getElementById("funnel").innerHTML = LIVE_STAGES.map((s) => barRow(s, by[s] || 0, liveMax)).join("");

  const upH = Math.floor((perf.uptimeSeconds || 0) / 3600);
  const upM = Math.floor(((perf.uptimeSeconds || 0) % 3600) / 60);
  document.getElementById("perf").innerHTML = `
    <div class="perf-grid">
      <div><span class="muted">Process</span><div>${perf.processHealthy ? '<span class="ok">healthy</span>' : '<span class="bad">unhealthy</span>'}</div></div>
      <div><span class="muted">Uptime</span><div>${upH}h ${upM}m</div></div>
      <div><span class="muted">Unhandled errors</span><div>${perf.unhandledErrors ?? 0}</div></div>
      <div><span class="muted">SQLite</span><div>${perf.sqlite?.ok ? '<span class="ok">ok</span>' : '<span class="bad">down</span>'}</div></div>
      <div><span class="muted">AMI</span><div>${pill(perf.ami?.state)} · ${perf.ami?.reconnectCount ?? 0} reconnects</div></div>
      <div><span class="muted">ARI</span><div>${pill(perf.ari?.state)} · ${perf.ari?.reconnectCount ?? 0} reconnects</div></div>
      <div><span class="muted">ARI REST / WS</span><div>${pill(perf.ari?.restState)} / ${pill(perf.ari?.wsState)}</div></div>
      <div><span class="muted">Volumes</span><div>${host.diskCount ?? (host.disks || []).length} · ${host.diskCriticalCount ?? 0} critical</div></div>
    </div>`;

  const calls = live.calls || [];
  document.getElementById("live-calls").innerHTML = calls.length
    ? `<table class="table"><thead><tr><th>Stage</th><th>Caller</th><th>DID</th><th>Lang</th><th>Menu</th><th>Queue</th><th>Started</th></tr></thead><tbody>${calls
        .map(
          (c) => `<tr>
            <td>${stageTag(c.state)}</td>
            <td>${esc(c.callerId || "—")}<div class="muted">${esc((c.internalId || "").slice(0, 8))}</div></td>
            <td>${esc(c.did || "—")}</td>
            <td>${esc(languageLabel(c.language))}</td>
            <td>${esc(c.currentMenu || "—")}</td>
            <td>${c.queuePosition == null ? "—" : esc(String(c.queuePosition))}${
            c.expectedWaitSec == null ? "" : ` / ${esc(String(c.expectedWaitSec))}s`
          }</td>
            <td>${esc(c.startedAt || "")}</td>
          </tr>`,
        )
        .join("")}</tbody></table>`
    : "No live calls on this process.";

  const dids = hist.byDid || [];
  document.getElementById("by-did").innerHTML = dids.length
    ? `<table class="table"><thead><tr><th>DID</th><th>Live</th><th>24h</th><th>Ended</th><th>Rejected</th><th>Busy</th><th>Dup CLI</th><th>Avg</th></tr></thead><tbody>${dids
        .map(
          (d) => `<tr>
            <td><strong>${esc(d.key)}</strong></td>
            <td>${d.live ?? 0}</td>
            <td>${d.total}</td>
            <td>${d.ended}</td>
            <td>${d.rejected}</td>
            <td>${d.aicb}</td>
            <td>${d.duplicateCli ?? 0}</td>
            <td>${d.avgDurationSec == null ? "—" : `${d.avgDurationSec}s`}</td>
          </tr>`,
        )
        .join("")}</tbody></table>`
    : '<p class="muted">No DID traffic in this window.</p>';

  const trunkPack = dash.trunks || {};
  const trunkRows = trunkPack.items || [];
  document.getElementById("trunks").innerHTML = !trunkPack.ariOk
    ? '<p class="muted">ARI endpoint list unavailable — trunk live state cannot be shown. 24h volume still uses IIM sessions.</p>' +
      trunkHistoryTable(hist.byTrunk || [])
    : trunkRows.length
      ? `<table class="table"><thead><tr><th>Trunk</th><th>PBX</th><th>Live ch</th><th>Live calls</th><th>24h</th><th>Busy</th><th>Outbound</th></tr></thead><tbody>${trunkRows
          .map(
            (t) => `<tr>
              <td><strong>${esc(t.name)}</strong></td>
              <td>${pill(t.state === "online" ? "connected" : t.state === "offline" ? "disconnected" : t.state)}</td>
              <td>${t.liveChannels}</td>
              <td>${t.liveCalls}</td>
              <td>${t.volume24h}</td>
              <td>${t.aicb24h}</td>
              <td>${t.outboundRoute ? esc(t.outboundRoute) : "—"}</td>
            </tr>`,
          )
          .join("")}</tbody></table>`
      : '<p class="muted">No non-extension PJSIP endpoints (trunks) on Asterisk.</p>';

  const st = dash.stations || {};
  const sc = st.counts || {};
  const range = st.range || {};
  document.getElementById("stations-hint").innerHTML =
    `Range ${range.from ?? "—"}–${range.to ?? "—"} · ${st.ariOk ? "ARI snapshot ok" : "ARI snapshot missing"} · Detail on <a href="/stations">IIM Station monitor</a>.`;
  document.getElementById("stations-kpis").innerHTML = `
    <div class="perf-grid">
      <div><span class="muted">Idle</span><div>${sc.idle ?? 0}</div></div>
      <div><span class="muted">In use</span><div>${sc.inUse ?? 0}</div></div>
      <div><span class="muted">Unregistered</span><div>${sc.unregistered ?? 0}</div></div>
      <div><span class="muted">Not on PBX</span><div>${sc.missing ?? 0}</div></div>
    </div>`;

  const flaps = perf.linkFlaps || {};
  document.getElementById("disconnects").innerHTML = `
    <div class="perf-grid">
      <div><span class="muted">Completed (24h)</span><div>${hist.ended ?? 0}</div></div>
      <div><span class="muted">Rejected (24h)</span><div>${hist.rejected ?? 0}</div></div>
      <div><span class="muted">All channels busy (24h)</span><div>${hist.aicb ?? 0}</div></div>
      <div><span class="muted">Calls under ${hist.briefSec ?? 15}s</span><div>${hist.briefCalls ?? 0}</div></div>
      <div><span class="muted">Avg duration</span><div>${hist.avgDurationSec == null ? "—" : `${hist.avgDurationSec}s`}</div></div>
      <div><span class="muted">Routes at cap now</span><div>${live.setupsAtCap ?? 0}</div></div>
      <div><span class="muted">AMI reconnects</span><div>${flaps.ami ?? 0}</div></div>
      <div><span class="muted">ARI reconnects</span><div>${flaps.ari ?? 0}</div></div>
      <div><span class="muted">Unhandled errors</span><div>${perf.unhandledErrors ?? 0}</div></div>
      <div><span class="muted">Last process fault</span><div>${esc(perf.lastUnhandledAt || "none")}</div></div>
    </div>`;

  const hourly = hist.hourly || [];
  const hMax = Math.max(1, ...hourly.map((h) => h.total));
  document.getElementById("hourly").innerHTML = hourly.length
    ? hourly
        .map((h) => barRow(`${h.hour.slice(11, 16)}${h.aicb ? ` · ${h.aicb} busy` : ""}`, h.total, hMax))
        .join("")
    : '<p class="muted">No hourly points.</p>';

  const rejects = Object.entries(hist.byReject || {});
  const rMax = Math.max(1, ...rejects.map(([, n]) => n));
  document.getElementById("rejects").innerHTML = rejects.length
    ? rejects.map(([k, n]) => barRow(k, n, rMax)).join("")
    : '<p class="muted">No rejects in this window.</p>';

  const setups = live.setups || [];
  document.getElementById("setup-list").innerHTML = setups.length
    ? `<table class="table"><thead><tr><th>Setup</th><th>Match</th><th>Live / cap</th><th></th></tr></thead><tbody>${setups
        .map(
          (x) => `<tr>
            <td><strong>${esc(x.name)}</strong></td>
            <td>DID ${esc(x.matchDid || "any")} / trunk ${esc(x.matchTrunk || "any")}</td>
            <td>${x.activeCount}/${x.maxConcurrent}</td>
            <td>${x.enabled ? '<span class="tag on">ON</span>' : '<span class="tag off">DRAIN</span>'}</td>
          </tr>`,
        )
        .join("")}</tbody></table>`
    : `None yet. Add one on <a href="/setups">Inbound routing</a>.`;
}

bootUser()
  .then(() => refresh())
  .then(() => setInterval(() => refresh().catch(() => {}), 4000))
  .catch(() => {});
