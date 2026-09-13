async function api(path, opts = {}) {
  const res = await fetch(path, { credentials: "same-origin", ...opts });
  if (res.status === 401) {
    window.location.href = "/";
    throw new Error("unauthorized");
  }
  return res;
}

function pill(state) {
  if (state === "connected") return `<span class="ok">${esc(state)}</span>`;
  if (state === "degraded" || state === "connecting") return `<span class="warn">${esc(state)}</span>`;
  return `<span class="bad">${esc(state)}</span>`;
}

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/"/g, "&quot;");
}

function parseAri(url) {
  try {
    const u = new URL(url.includes("://") ? url : `http://${url}`);
    const path = (u.pathname || "/").replace(/\/+$/, "") || "/ari";
    return {
      scheme: u.protocol === "https:" ? "https" : "http",
      host: u.hostname || "127.0.0.1",
      port: u.port || (u.protocol === "https:" ? "443" : "8088"),
      path: path === "" || path === "/" ? "/ari" : path,
    };
  } catch {
    return { scheme: "http", host: "127.0.0.1", port: "8088", path: "/ari" };
  }
}

function buildAriBase() {
  const scheme = document.getElementById("ariScheme").value;
  const host = document.getElementById("ariHost").value.trim() || "127.0.0.1";
  const port = document.getElementById("ariPort").value.trim() || "8088";
  let path = document.getElementById("ariPath").value.trim() || "/ari";
  if (!path.startsWith("/")) path = `/${path}`;
  path = path.replace(/\/+$/, "") || "/ari";
  return `${scheme}://${host}:${port}${path}`;
}

function fillDefaults() {
  const host = document.getElementById("host").value.trim() || "127.0.0.1";
  document.getElementById("host").value = host;
  document.getElementById("amiPort").value = 5038;
  document.getElementById("amiUser").value = "iim";
  document.getElementById("amiConnectTimeoutMs").value = 8000;
  document.getElementById("amiRetryDelayMs").value = 5000;
  document.getElementById("ariScheme").value = "http";
  document.getElementById("ariHost").value = host;
  document.getElementById("ariPort").value = 8088;
  document.getElementById("ariPath").value = "/ari";
  document.getElementById("ariUser").value = "iim";
  document.getElementById("stasisApp").value = "iim-ivr";
  document.getElementById("ariConnectTimeoutMs").value = 8000;
  document.getElementById("ariRetryDelayMs").value = 5000;
  document.getElementById("ownedFrom").value = 3001;
  document.getElementById("ownedTo").value = 3999;
  document.getElementById("pulse-swagger-url").value = "https://petstore.swagger.io/";
}

let logSource = "ami";

async function boot() {
  const me = await (await api("/auth/me")).json();
  document.getElementById("who").textContent = me.username;
  document.getElementById("avatar").textContent = (me.username || "S").slice(0, 1).toUpperCase();
  await refreshAll(true);
}

async function refreshAll(fillForm) {
  const [statusRes, cfgRes, eventsRes, settingsRes] = await Promise.all([
    api("/v1/status"),
    api("/v1/config/asterisk"),
    api("/v1/telephony/events"),
    api("/v1/config/settings"),
  ]);
  const s = await statusRes.json();
  const cfg = await cfgRes.json();
  const events = await eventsRes.json();
  const settings = await settingsRes.json();
  renderStatus(s);
  if (fillForm) fillFrom(cfg, s.telephony, settings);
  renderEvents(events.events || []);
}

function renderStatus(s) {
  const tel = s.telephony || {};
  const amiOn = tel.ami?.desired === "connect";
  const ariOn = tel.ari?.desired === "connect";
  document.getElementById("cards").innerHTML = [
    ["AMI switch", amiOn ? "enabled" : "disabled"],
    ["AMI", s.ami?.state ?? "—"],
    ["ARI switch", ariOn ? "enabled" : "disabled"],
    ["ARI", s.ari?.state ?? "—"],
    ["ARI REST", s.ari?.restState ?? "—"],
    ["ARI WS", s.ari?.wsState ?? "—"],
    ["IIM stations", `${s.telephony?.ownedExtensions?.from ?? 3001}–${s.telephony?.ownedExtensions?.to ?? 3999}`],
  ]
    .map(([k, v]) => {
      const valued = k === "AMI switch" || k === "ARI switch" || k === "IIM stations" ? v : pill(v);
      return `<div class="card"><div class="k">${k}</div><div class="v">${valued}</div></div>`;
    })
    .join("");

  document.getElementById("ami-hint").textContent =
    `${amiOn ? "Enabled — auto-reconnect" : "Disabled"} · sockets ${tel.ami?.running ? "running" : "stopped"} · timeout ${tel.ami?.connectTimeoutMs ?? "—"} ms · retry ${tel.ami?.retryDelayMs ?? "—"} ms.` +
    (s.ami?.nextRetryAt ? ` Next try ${s.ami.nextRetryAt}.` : "") +
    (s.ami?.lastError ? ` Last error: ${s.ami.lastError}.` : "") +
    ` Last event ${s.ami?.lastEventAt || "never"}.`;
  document.getElementById("ari-hint").textContent =
    `${ariOn ? "Enabled — auto-reconnect" : "Disabled"} · sockets ${tel.ari?.running ? "running" : "stopped"} · timeout ${tel.ari?.connectTimeoutMs ?? "—"} ms · retry ${tel.ari?.retryDelayMs ?? "—"} ms.` +
    (s.ari?.nextRetryAt ? ` Next try ${s.ari.nextRetryAt}.` : "") +
    (s.ari?.lastError ? ` Last error: ${s.ari.lastError}.` : "") +
    ` Last event ${s.ari?.lastEventAt || "never"}.`;
}

function fillFrom(cfg, tel, settings) {
  document.getElementById("host").value = cfg.host || "127.0.0.1";
  document.getElementById("amiPort").value = cfg.amiPort || 5038;
  document.getElementById("amiUser").value = cfg.amiUser || "iim";
  document.getElementById("amiPassword").value = "";
  document.getElementById("amiConnectTimeoutMs").value = tel?.ami?.connectTimeoutMs || 8000;
  document.getElementById("amiRetryDelayMs").value = tel?.ami?.retryDelayMs || 5000;
  const ari = parseAri(cfg.ariBaseUrl || "http://127.0.0.1:8088/ari");
  document.getElementById("ariScheme").value = ari.scheme;
  document.getElementById("ariHost").value = ari.host;
  document.getElementById("ariPort").value = ari.port;
  document.getElementById("ariPath").value = ari.path;
  document.getElementById("ariUser").value = cfg.ariUser || "iim";
  document.getElementById("ariPassword").value = "";
  document.getElementById("stasisApp").value = cfg.stasisApp || "iim-ivr";
  document.getElementById("ariConnectTimeoutMs").value = tel?.ari?.connectTimeoutMs || 8000;
  document.getElementById("ariRetryDelayMs").value = tel?.ari?.retryDelayMs || 5000;
  document.getElementById("ownedFrom").value = tel?.ownedExtensions?.from ?? 3001;
  document.getElementById("ownedTo").value = tel?.ownedExtensions?.to ?? 3999;
  document.getElementById("pulse-swagger-url").value =
    settings?.pulse_swagger_url || "https://petstore.swagger.io/";
  document.getElementById("menu_max_no_input").value = settings?.menu_max_no_input || "3";
  document.getElementById("menu_max_invalid").value = settings?.menu_max_invalid || "3";
  document.getElementById("menu_file_invalid").value = settings?.menu_file_invalid || "invalid";
  document.getElementById("menu_file_no_input").value = settings?.menu_file_no_input || "oninput";
  document.getElementById("menu_max_input_timeout").value = settings?.menu_max_input_timeout || "5";
  document.getElementById("menu_inputs_acceptable").value = settings?.menu_inputs_acceptable || "*#1234567890";
  document.getElementById("voice_files_path").value =
    settings?.voice_files_path || "/var/lib/asterisk/sounds/custom";
  const ownedHint = document.getElementById("owned-hint");
  if (ownedHint) {
    ownedHint.textContent = `Stations ${document.getElementById("ownedFrom").value}–${document.getElementById("ownedTo").value} belong to IIM. Inbound numbers are set on Inbound routing, not this range.`;
  }
  document.getElementById("ami-pw-hint").textContent = cfg.amiPasswordFromEnv
    ? "Runtime password is overridden by AMI_PASSWORD in .env"
    : cfg.amiPasswordSet
      ? "A password is stored. Leave blank to keep it."
      : "No AMI password stored yet.";
  document.getElementById("ari-pw-hint").textContent = cfg.ariPasswordFromEnv
    ? "Runtime password is overridden by ARI_PASSWORD in .env"
    : cfg.ariPasswordSet
      ? "A password is stored. Leave blank to keep it."
      : "No ARI password stored yet.";
}

function renderEvents(rows) {
  const el = document.getElementById("events");
  if (!rows.length) {
    el.textContent = "No events yet in this process.";
    return;
  }
  el.innerHTML = rows
    .slice(0, 80)
    .map((e) => {
      const cls = e.level === "info" ? "ok" : "warn";
      return `<div><span class="muted">${esc(e.at)}</span> <span class="${cls}">${esc(e.source)}</span> ${esc(e.message)}</div>`;
    })
    .join("");
}

async function loadLog() {
  const res = await api(`/v1/telephony/logs?source=${encodeURIComponent(logSource)}`);
  const data = await res.json();
  document.getElementById("log-path").textContent = data.missing
    ? `No ${logSource} log for this hour yet (${data.path || "—"})`
    : data.path || "";
  document.getElementById("log-text").textContent = data.text || "(empty)";
  document.getElementById("log-text").scrollTop = document.getElementById("log-text").scrollHeight;
}

function timingsBody() {
  return {
    ami: {
      retryDelayMs: Number(document.getElementById("amiRetryDelayMs").value) || 5000,
      connectTimeoutMs: Number(document.getElementById("amiConnectTimeoutMs").value) || 8000,
    },
    ari: {
      retryDelayMs: Number(document.getElementById("ariRetryDelayMs").value) || 5000,
      connectTimeoutMs: Number(document.getElementById("ariConnectTimeoutMs").value) || 8000,
    },
    ownedExtensions: {
      from: Number(document.getElementById("ownedFrom").value) || 3001,
      to: Number(document.getElementById("ownedTo").value) || 3999,
    },
  };
}

function asteriskBody() {
  const body = {
    host: document.getElementById("host").value.trim(),
    amiPort: Number(document.getElementById("amiPort").value) || 5038,
    amiUser: document.getElementById("amiUser").value.trim(),
    ariBaseUrl: buildAriBase(),
    ariUser: document.getElementById("ariUser").value.trim(),
    stasisApp: document.getElementById("stasisApp").value.trim(),
  };
  const amiPw = document.getElementById("amiPassword").value;
  const ariPw = document.getElementById("ariPassword").value;
  if (amiPw) body.amiPassword = amiPw;
  if (ariPw) body.ariPassword = ariPw;
  return body;
}

document.getElementById("tel-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const msg = document.getElementById("save-msg");
  if (!confirm("Save AMI/ARI settings, IIM extension range, voice folder, IVR menu defaults, and PULSE Swagger URL?")) return;
  const cfgRes = await api("/v1/config/asterisk", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(asteriskBody()),
  });
  const telRes = await api("/v1/telephony", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(timingsBody()),
  });
  const swaggerRes = await api("/v1/config/settings", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      key: "pulse_swagger_url",
      value: document.getElementById("pulse-swagger-url").value.trim(),
    }),
  });
  const menuKeys = [
    "menu_max_no_input",
    "menu_max_invalid",
    "menu_file_invalid",
    "menu_file_no_input",
    "menu_max_input_timeout",
    "menu_inputs_acceptable",
    "voice_files_path",
  ];
  let menuOk = true;
  for (const key of menuKeys) {
    const res = await api("/v1/config/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key, value: document.getElementById(key).value.trim() }),
    });
    if (!res.ok) menuOk = false;
  }
  const swagger = await swaggerRes.json().catch(() => ({}));
  if (!cfgRes.ok || !telRes.ok || !swaggerRes.ok || !menuOk) {
    const errCfg = cfgRes.ok ? {} : await cfgRes.json().catch(() => ({}));
    const errTel = telRes.ok ? {} : await telRes.json().catch(() => ({}));
    msg.textContent = swagger.error || errCfg.error || errTel.error || "Save failed";
    return;
  }
  const link = document.getElementById("pulse-swagger");
  if (link && swagger.pulse_swagger_url) link.href = swagger.pulse_swagger_url;
  msg.textContent = "Saved";
  document.getElementById("amiPassword").value = "";
  document.getElementById("ariPassword").value = "";
  const status = await (await api("/v1/status")).json();
  const amiOn = status.telephony?.ami?.desired === "connect";
  const ariOn = status.telephony?.ari?.desired === "connect";
  if (amiOn && confirm("Settings saved. Reconnect AMI now with the new values?")) {
    await api("/v1/telephony/ami/reconnect", { method: "POST" });
  }
  if (ariOn && confirm("Reconnect ARI now with the new values?")) {
    await api("/v1/telephony/ari/reconnect", { method: "POST" });
  }
  await refreshAll(true);
  await loadLog();
});

async function linkAction(link, action, question) {
  if (!confirm(question)) return;
  const res = await api(`/v1/telephony/${link}/${action}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  document.getElementById("save-msg").textContent = res.ok ? `${link.toUpperCase()} ${action}` : `${action} failed`;
  await refreshAll(false);
  await loadLog();
}

document.getElementById("ami-enable").addEventListener("click", () =>
  linkAction("ami", "connect", "Enable AMI and connect? IIM will retry AMI if Asterisk is down. ARI is not changed."),
);
document.getElementById("ami-disable").addEventListener("click", () =>
  linkAction(
    "ami",
    "disconnect",
    "Disable AMI? The AMI socket will drop and will not retry until you enable AMI again. ARI is not changed.",
  ),
);
document.getElementById("ami-reconnect").addEventListener("click", () =>
  linkAction("ami", "reconnect", "Reconnect AMI now using the saved AMI settings?"),
);
document.getElementById("ari-enable").addEventListener("click", () =>
  linkAction(
    "ari",
    "connect",
    "Enable ARI and connect REST + WebSocket? IIM will retry ARI if Asterisk is down. AMI is not changed.",
  ),
);
document.getElementById("ari-disable").addEventListener("click", () =>
  linkAction(
    "ari",
    "disconnect",
    "Disable ARI? REST and WebSocket will drop and will not retry until you enable ARI again. AMI is not changed.",
  ),
);
document.getElementById("ari-reconnect").addEventListener("click", () =>
  linkAction("ari", "reconnect", "Reconnect ARI now using the saved ARI settings?"),
);

document.getElementById("fill-defaults").addEventListener("click", () => {
  if (!confirm("Replace the form with AMI/ARI defaults (127.0.0.1, AMI 5038, ARI 8088/ari, user iim, app iim-ivr)?")) {
    return;
  }
  fillDefaults();
});

document.querySelectorAll("[data-log]").forEach((btn) => {
  btn.addEventListener("click", async () => {
    logSource = btn.getAttribute("data-log");
    await loadLog();
  });
});
document.getElementById("log-refresh").addEventListener("click", () => loadLog());

document.getElementById("logout").addEventListener("click", async () => {
  await fetch("/auth/logout", { method: "POST", credentials: "same-origin" });
  window.location.href = "/";
});

setInterval(() => {
  refreshAll(false).catch(() => {});
  loadLog().catch(() => {});
}, 4000);

boot()
  .then(() => loadLog())
  .catch(() => {});
