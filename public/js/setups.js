async function api(path, opts = {}) {
  const res = await fetch(path, { credentials: "same-origin", ...opts });
  if (res.status === 401) {
    window.location.href = "/";
    throw new Error("unauthorized");
  }
  return res;
}

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/"/g, "&quot;");
}

function statusTag(state) {
  const s = String(state || "unknown").toLowerCase();
  if (s === "online") return `<span class="tag on">${esc(state)}</span>`;
  if (s === "offline" || s === "unavailable" || s === "not on asterisk") return `<span class="tag off">${esc(state)}</span>`;
  return `<span class="tag">${esc(state)}</span>`;
}

function fillTrunkSelect(trunks, keep) {
  const sel = document.getElementById("matchTrunk");
  const current = keep ?? sel.value;
  const names = (trunks || []).map((t) => t.name);
  sel.innerHTML = `<option value="">Any trunk</option>` + names.map((n) => `<option value="${esc(n)}">${esc(n)}</option>`).join("");
  if (current && !names.includes(current)) {
    const extra = document.createElement("option");
    extra.value = current;
    extra.textContent = current;
    sel.appendChild(extra);
  }
  sel.value = current || "";
}

async function refreshTrunks() {
  const ast = document.getElementById("asterisk");
  const data = await (await api("/v1/asterisk/trunks")).json();
  if (!data.ok) {
    ast.textContent = "Could not read trunks from Asterisk. Check ARI on Telephony Setup. You can still leave Any trunk.";
    fillTrunkSelect([], document.getElementById("matchTrunk").value);
    return;
  }
  const trunks = data.trunks || [];
  fillTrunkSelect(trunks, document.getElementById("matchTrunk").value);
  if (!trunks.length) {
    ast.textContent = "No trunks found. Phone extensions (numbers) are not listed here. Leave Any trunk for lab calls.";
    return;
  }
  ast.innerHTML = `<table class="table">
    <thead><tr><th>Trunk</th><th>Status</th><th>Live channels</th><th></th></tr></thead>
    <tbody>${trunks
      .map(
        (t) => `<tr>
        <td><strong>${esc(t.name)}</strong></td>
        <td>${statusTag(t.state)}</td>
        <td>${t.channels}</td>
        <td><button class="btn ghost" type="button" data-use="${esc(t.name)}">Use this trunk</button></td>
      </tr>`,
      )
      .join("")}</tbody></table>`;
  ast.querySelectorAll("[data-use]").forEach((btn) => {
    btn.addEventListener("click", () => {
      fillTrunkSelect(trunks, btn.getAttribute("data-use") || "");
      document.getElementById("form-title").scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
}

async function boot() {
  const me = await (await api("/auth/me")).json();
  document.getElementById("who").textContent = me.username;
  document.getElementById("avatar").textContent = (me.username || "S").slice(0, 1).toUpperCase();
  const ivrs = await (await api("/v1/ivrs")).json();
  const sel = document.getElementById("ivrId");
  sel.innerHTML =
    `<option value="">None (answer and wait)</option>` +
    ivrs.map((i) => `<option value="${i.id}">${esc(i.name)}</option>`).join("");
  await Promise.all([refresh(), refreshTrunks()]);
}

async function refresh() {
  const rows = await (await api("/v1/setups")).json();
  const el = document.getElementById("list");
  if (!rows.length) {
    el.textContent = "None yet. Add a route below — for the 2098 → 7777 lab test use DID 7777 and Any trunk.";
    return;
  }
  el.innerHTML = `<table class="table">
    <thead><tr><th>Name</th><th>DID</th><th>Trunk</th><th>IVR</th><th>Live / cap</th><th>Status</th><th></th></tr></thead>
    <tbody>${rows
      .map(
        (x) => `<tr>
        <td><strong>${esc(x.name)}</strong></td>
        <td>${esc(x.matchDid || "any")}</td>
        <td>${esc(x.matchTrunk || "any")}</td>
        <td>${esc(x.ivrId ? `#${x.ivrId}` : "—")}</td>
        <td><button class="btn ghost" type="button" data-live="${x.id}">${x.activeCount}/${x.maxConcurrent}</button></td>
        <td>${x.enabled ? '<span class="tag on">ON</span>' : '<span class="tag off">DRAIN</span>'}</td>
        <td>
          <button class="btn ghost" type="button" data-live="${x.id}">Live calls</button>
          <button class="btn ghost" type="button" data-toggle="${x.id}" data-on="${x.enabled ? "1" : "0"}">${
          x.enabled ? "Disable" : "Enable"
        }</button>
          <button class="btn ghost" type="button" data-edit="${x.id}">Edit</button>
          <button class="btn ghost" type="button" data-del="${x.id}">Remove</button>
        </td>
      </tr>`,
      )
      .join("")}</tbody></table>`;

  el.querySelectorAll("[data-edit]").forEach((btn) => {
    btn.addEventListener("click", () => load(rows.find((x) => String(x.id) === btn.getAttribute("data-edit"))));
  });
  el.querySelectorAll("[data-del]").forEach((btn) => {
    btn.addEventListener("click", () => remove(btn.getAttribute("data-del"), rows));
  });
  el.querySelectorAll("[data-toggle]").forEach((btn) => {
    btn.addEventListener("click", () =>
      toggle(btn.getAttribute("data-toggle"), btn.getAttribute("data-on") !== "1", rows),
    );
  });
  el.querySelectorAll("[data-live]").forEach((btn) => {
    btn.addEventListener("click", () => openLive(btn.getAttribute("data-live"), rows));
  });
}

const LANG = { 0: "Urdu", 1: "English", 2: "Sindhi", 3: "Pashto", 4: "Arabic" };
let liveSetupId = null;
let liveTimer = null;

function languageLabel(n) {
  return LANG[n] ?? "Urdu";
}

function stageTag(state) {
  return `<span class="stage stage-${esc(state)}">${esc(state)}</span>`;
}

function sessionLabel(c) {
  const interaction = (c.interactionId || "").trim();
  const pulse = (c.pulseSessionId || "").trim();
  const internal = c.internalId || "";
  if (interaction || pulse) {
    return `${esc(interaction || "—")}<div class="muted">${esc(pulse || "no PULSE session")}</div>`;
  }
  return `—<div class="muted">${esc(internal.slice(0, 8) || "no session yet")}</div>`;
}

function liveIntervalMs() {
  const n = Number(document.getElementById("live-interval").value);
  return Math.max(3, Number.isFinite(n) ? Math.floor(n) : 3) * 1000;
}

function syncLivePoll() {
  stopLivePoll();
  if (liveSetupId == null || document.getElementById("live-panel").hidden) return;
  if (!document.getElementById("live-auto").checked) return;
  const ms = liveIntervalMs();
  document.getElementById("live-interval").value = String(ms / 1000);
  liveTimer = setInterval(() => renderLive().catch(() => {}), ms);
}

function stopLivePoll() {
  if (liveTimer) {
    clearInterval(liveTimer);
    liveTimer = null;
  }
}

function closeLive() {
  stopLivePoll();
  liveSetupId = null;
  document.getElementById("live-panel").hidden = true;
}

async function openLive(id, rows) {
  const row = rows.find((x) => String(x.id) === String(id));
  liveSetupId = Number(id);
  document.getElementById("live-panel").hidden = false;
  document.getElementById("live-title").textContent = `Live calls — ${row?.name || "route"} (DID ${row?.matchDid || "any"})`;
  document.getElementById("live-panel").scrollIntoView({ behavior: "smooth", block: "start" });
  await renderLive();
  syncLivePoll();
}

async function renderLive() {
  if (liveSetupId == null) return;
  const data = await (await api(`/v1/setups/${liveSetupId}/calls`)).json();
  const setup = data.setup || {};
  const calls = data.calls || [];
  document.getElementById("live-title").textContent =
    `Live calls — ${setup.name || "route"} (DID ${setup.matchDid || "any"}) · ${setup.activeCount ?? calls.length}/${setup.maxConcurrent ?? "—"}`;
  const el = document.getElementById("live-calls");
  if (!calls.length) {
    el.textContent = "No live calls on this DID right now.";
    return;
  }
  el.innerHTML = `<table class="table">
    <thead><tr><th>Stage</th><th>Caller ID</th><th>DID</th><th>Trunk</th><th>Interaction / session</th><th>Language</th><th>Menu</th><th>Started</th></tr></thead>
    <tbody>${calls
      .map(
        (c) => `<tr>
          <td>${stageTag(c.state)}</td>
          <td>${esc(c.callerId || "—")}</td>
          <td>${esc(c.did || "—")}</td>
          <td>${esc(c.trunk || "any")}</td>
          <td>${sessionLabel(c)}</td>
          <td>${esc(languageLabel(c.language))}</td>
          <td>${esc(c.currentMenu || "—")}</td>
          <td>${esc(c.startedAt || "")}</td>
        </tr>`,
      )
      .join("")}</tbody></table>`;
}

function load(x) {
  if (!x) return;
  document.getElementById("form-title").textContent = `Edit ${x.name}`;
  document.getElementById("setupId").value = x.id;
  document.getElementById("name").value = x.name;
  document.getElementById("matchDid").value = x.matchDid || "";
  fillTrunkSelect(
    [...document.getElementById("matchTrunk").options]
      .map((o) => o.value)
      .filter(Boolean)
      .map((name) => ({ name })),
    x.matchTrunk || "",
  );
  document.getElementById("maxConcurrent").value = x.maxConcurrent;
  document.getElementById("ivrId").value = x.ivrId || "";
  document.getElementById("enabled").checked = !!x.enabled;
  document.getElementById("msg").textContent = "";
}

function resetForm() {
  document.getElementById("form-title").textContent = "Add inbound route";
  document.getElementById("setupId").value = "";
  document.getElementById("form").reset();
  document.getElementById("matchTrunk").value = "";
  document.getElementById("maxConcurrent").value = 10;
  document.getElementById("enabled").checked = true;
  document.getElementById("msg").textContent = "";
}

function bodyFromForm() {
  return {
    name: document.getElementById("name").value.trim(),
    matchDid: document.getElementById("matchDid").value.trim(),
    matchTrunk: document.getElementById("matchTrunk").value.trim(),
    maxConcurrent: Number(document.getElementById("maxConcurrent").value) || 10,
    ivrId: document.getElementById("ivrId").value ? Number(document.getElementById("ivrId").value) : null,
    enabled: document.getElementById("enabled").checked,
  };
}

document.getElementById("form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const msg = document.getElementById("msg");
  const body = bodyFromForm();
  if (!body.matchDid && !body.matchTrunk) {
    msg.textContent = "Enter a DID and/or a trunk";
    return;
  }
  const id = document.getElementById("setupId").value;
  const question = id
    ? `Save changes to inbound route “${body.name}”?`
    : `Add inbound route “${body.name}” (DID ${body.matchDid || "any"} / trunk ${body.matchTrunk || "any"})?`;
  if (!confirm(question)) return;
  const res = await api(id ? `/v1/setups/${id}` : "/v1/setups", {
    method: id ? "PUT" : "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    msg.textContent = data.error || "Save failed";
    return;
  }
  msg.textContent = "Saved";
  resetForm();
  await refresh();
});

async function toggle(id, enable, rows) {
  const row = rows.find((x) => String(x.id) === String(id));
  const label = enable ? "Enable new calls on" : "Disable (drain) ";
  if (!confirm(`${label} “${row?.name || id}”?`)) return;
  const res = await api(`/v1/setups/${id}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ enabled: enable }),
  });
  if (!res.ok) {
    document.getElementById("msg").textContent = "Update failed";
    return;
  }
  await refresh();
}

async function remove(id, rows) {
  const row = rows.find((x) => String(x.id) === String(id));
  if (!confirm(`Remove inbound route “${row?.name || id}”?`)) return;
  const res = await api(`/v1/setups/${id}`, { method: "DELETE" });
  if (!res.ok) {
    document.getElementById("msg").textContent = "Remove failed";
    return;
  }
  resetForm();
  await refresh();
}

document.getElementById("reset").addEventListener("click", () => resetForm());
document.getElementById("refresh-trunks").addEventListener("click", () => refreshTrunks());
document.getElementById("live-close").addEventListener("click", () => closeLive());
document.getElementById("live-refresh").addEventListener("click", () => renderLive());
document.getElementById("live-auto").addEventListener("change", () => syncLivePoll());
document.getElementById("live-interval").addEventListener("change", () => {
  const n = Number(document.getElementById("live-interval").value);
  document.getElementById("live-interval").value = String(Math.max(3, Number.isFinite(n) ? Math.floor(n) : 3));
  syncLivePoll();
});
document.getElementById("logout").addEventListener("click", async () => {
  await fetch("/auth/logout", { method: "POST", credentials: "same-origin" });
  window.location.href = "/";
});

boot().catch(() => {});
