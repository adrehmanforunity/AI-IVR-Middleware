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
  return { 0: "Urdu", 1: "English", 2: "Sindhi", 3: "Pashto", 4: "Arabic" }[n] || "Urdu";
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

function barRow(label, value, max) {
  const pct = max > 0 ? Math.max(4, Math.round((value / max) * 100)) : 0;
  return `<div class="bar-row"><span class="bar-lab">${esc(label)}</span><div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div><span class="bar-n">${value}</span></div>`;
}

const LIVE_STAGES = ["ringing", "screened", "session", "ivr", "queued", "talking"];

async function bootUser() {
  const me = await (await api("/auth/me")).json();
  const initial = (me.username || "S").slice(0, 1).toUpperCase();
  document.getElementById("who").textContent = me.username;
  document.getElementById("avatar").textContent = initial;
  document.getElementById("hello-avatar").textContent = initial;
  document.getElementById("greet").textContent = `${hourGreet()}, ${me.username}!`;
}

async function refresh() {
  const dash = await (await api("/v1/reports/dashboard")).json();
  const live = dash.live || {};
  const hist = dash.history || {};
  const perf = dash.performance || {};
  const by = live.byState || {};

  document.getElementById("sample-banner").hidden = !dash.usingSample;
  document.getElementById("hist-title").textContent = dash.usingSample
    ? "Sample report (24h illustration)"
    : "History (last 24 hours)";

  document.getElementById("kpis").innerHTML = [
    ["Live calls", String(live.activeCount ?? 0)],
    ["AMI", `${perf.telephony?.ami?.desired === "connect" ? "enabled" : "disabled"} · `],
    ["ARI", `${perf.telephony?.ari?.desired === "connect" ? "enabled" : "disabled"} · `],
    ["24h volume", String(hist.total ?? 0)],
    ["Accept %", `${hist.acceptRate ?? 0}%`],
    ["Avg duration", hist.avgDurationSec == null ? "—" : `${hist.avgDurationSec}s`],
  ]
    .map(([k, v]) => {
      if (k === "AMI") v = `${v}${pill(perf.ami?.state)}`;
      if (k === "ARI") v = `${v}${pill(perf.ari?.state)}`;
      return `<div class="card"><div class="k">${k}</div><div class="v">${v}</div></div>`;
    })
    .join("");

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
      <div><span class="muted">AMI retries</span><div>${perf.ami?.reconnectCount ?? 0}</div></div>
      <div><span class="muted">ARI retries</span><div>${perf.ari?.reconnectCount ?? 0}</div></div>
      <div><span class="muted">AMI REST/WS</span><div>${pill(perf.ari?.restState)} / ${pill(perf.ari?.wsState)}</div></div>
      <div><span class="muted">SQLite error</span><div>${esc(perf.sqlite?.lastError || "none")}</div></div>
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

  const hourly = hist.hourly || [];
  const hMax = Math.max(1, ...hourly.map((h) => h.total));
  document.getElementById("hourly").innerHTML = hourly.length
    ? hourly.map((h) => barRow(h.hour.slice(11, 16), h.total, hMax)).join("")
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
    : `No setups yet. Add one on <a href="/setups">Call setups</a>.`;
}

document.getElementById("logout").addEventListener("click", async () => {
  await fetch("/auth/logout", { method: "POST", credentials: "same-origin" });
  window.location.href = "/";
});

bootUser()
  .then(() => refresh())
  .then(() => setInterval(() => refresh().catch(() => {}), 4000))
  .catch(() => {});
