async function api(path, opts = {}) {
  const res = await fetch(path, { credentials: "same-origin", ...opts });
  if (res.status === 401) {
    window.location.href = "/";
    throw new Error("unauthorized");
  }
  return res;
}

function fill(cfg) {
  document.getElementById("enabled").checked = !!cfg.enabled;
  document.getElementById("host").value = cfg.host || "";
  document.getElementById("port").value = cfg.port || 587;
  document.getElementById("security").value = cfg.security || "starttls";
  document.getElementById("auth").value = cfg.auth || "login";
  document.getElementById("user").value = cfg.user || "";
  document.getElementById("password").value = "";
  document.getElementById("from").value = cfg.from || "";
  document.getElementById("fromName").value = cfg.fromName || "IIM";
  document.getElementById("replyTo").value = cfg.replyTo || "";
  document.getElementById("helo").value = cfg.helo || "";
  document.getElementById("timeoutMs").value = cfg.timeoutMs || 15000;
  document.getElementById("cooldownSec").value = cfg.cooldownSec || 600;
  document.getElementById("rejectUnauthorized").checked = cfg.rejectUnauthorized !== false;
  document.getElementById("adminTo").value = cfg.adminTo || "";
  document.getElementById("businessTo").value = cfg.businessTo || "";
  document.getElementById("pw-hint").textContent = cfg.passwordSet
    ? "A password is stored. Leave blank to keep it."
    : "No password stored yet.";
}

function bodyFromForm() {
  const password = document.getElementById("password").value;
  const body = {
    enabled: document.getElementById("enabled").checked,
    host: document.getElementById("host").value.trim(),
    port: Number(document.getElementById("port").value) || 587,
    security: document.getElementById("security").value,
    auth: document.getElementById("auth").value,
    user: document.getElementById("user").value.trim(),
    from: document.getElementById("from").value.trim(),
    fromName: document.getElementById("fromName").value.trim(),
    replyTo: document.getElementById("replyTo").value.trim(),
    helo: document.getElementById("helo").value.trim(),
    timeoutMs: Number(document.getElementById("timeoutMs").value) || 15000,
    cooldownSec: Math.max(60, Number(document.getElementById("cooldownSec").value) || 600),
    rejectUnauthorized: document.getElementById("rejectUnauthorized").checked,
    adminTo: document.getElementById("adminTo").value.trim(),
    businessTo: document.getElementById("businessTo").value.trim(),
  };
  if (password) body.password = password;
  return body;
}

function applyPreset(p) {
  document.getElementById("host").value = p.host;
  document.getElementById("port").value = p.port;
  document.getElementById("security").value = p.security;
  document.getElementById("auth").value = p.auth;
  document.getElementById("rejectUnauthorized").checked = p.rejectUnauthorized !== false;
  document.getElementById("msg").textContent = "Preset applied — set user, password, from, and recipients, then Save.";
}

async function boot() {
  const me = await (await api("/auth/me")).json();
  document.getElementById("who").textContent = me.username;
  document.getElementById("avatar").textContent = (me.username || "S").slice(0, 1).toUpperCase();
  const cfg = await (await api("/v1/smtp")).json();
  fill(cfg);
}

document.getElementById("form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const msg = document.getElementById("msg");
  if (!confirm("Save SMTP settings?")) return;
  const res = await api("/v1/smtp", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(bodyFromForm()),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    msg.textContent = data.error || "Save failed";
    return;
  }
  fill(data);
  msg.textContent = "Saved";
});

document.getElementById("test").addEventListener("click", async () => {
  const msg = document.getElementById("msg");
  if (!confirm("Send a test email to the saved admin/business addresses?")) return;
  const res = await api("/v1/smtp/test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  const data = await res.json().catch(() => ({}));
  msg.textContent = data.ok ? "Test sent" : data.error || "Test failed";
});

document.getElementById("preset-gmail-587").addEventListener("click", () =>
  applyPreset({ host: "smtp.gmail.com", port: 587, security: "starttls", auth: "login" }),
);
document.getElementById("preset-gmail-465").addEventListener("click", () =>
  applyPreset({ host: "smtp.gmail.com", port: 465, security: "tls", auth: "login" }),
);
document.getElementById("preset-m365").addEventListener("click", () =>
  applyPreset({ host: "smtp.office365.com", port: 587, security: "starttls", auth: "login" }),
);
document.getElementById("preset-local").addEventListener("click", () =>
  applyPreset({ host: "127.0.0.1", port: 25, security: "none", auth: "none", rejectUnauthorized: false }),
);

document.getElementById("logout").addEventListener("click", async () => {
  await fetch("/auth/logout", { method: "POST", credentials: "same-origin" });
  window.location.href = "/";
});

boot().catch(() => {});
