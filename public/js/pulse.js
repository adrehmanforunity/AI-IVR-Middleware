async function api(path, opts = {}) {
  const res = await fetch(path, { credentials: "same-origin", ...opts });
  if (res.status === 401) {
    window.location.href = "/";
    throw new Error("unauthorized");
  }
  return res;
}

let editing = null;

async function boot() {
  const me = await (await api("/auth/me")).json();
  document.getElementById("who").textContent = me.username;
  document.getElementById("avatar").textContent = (me.username || "S").slice(0, 1).toUpperCase();
  await refresh();
}

async function refresh() {
  const apis = await (await api("/v1/pulse/apis")).json();
  const el = document.getElementById("list");
  if (!apis.length) {
    el.textContent = "No PULSE APIs yet.";
    return;
  }
  el.innerHTML = `<table class="table">
    <thead><tr><th>Name</th><th>ID</th><th>Endpoint</th><th>Timeout</th><th>Retries</th><th>Status</th><th></th></tr></thead>
    <tbody>${apis
      .map(
        (a) => `<tr>
        <td><strong>${esc(a.name)}</strong><div class="muted">${esc(a.description || "")}</div></td>
        <td class="api-id">${esc(a.slot)}</td>
        <td>${esc(a.endpoint || "—")}</td>
        <td>${a.timeoutMs} ms</td>
        <td>${a.retries}</td>
        <td>
          ${a.enabled ? '<span class="tag on">ON</span>' : '<span class="tag off">OFF</span>'}
          ${a.mockEnabled ? '<span class="tag">MOCK</span>' : ""}
        </td>
        <td>
          <button class="btn ghost" type="button" data-toggle="${esc(a.slot)}" data-on="${a.enabled ? "1" : "0"}">${
          a.enabled ? "Disable" : "Enable"
        }</button>
          <button class="btn ghost" type="button" data-edit="${esc(a.slot)}">Edit</button>
          <button class="btn ghost" type="button" data-del="${esc(a.slot)}">Remove</button>
        </td>
      </tr>`,
      )
      .join("")}</tbody></table>`;

  el.querySelectorAll("[data-edit]").forEach((btn) => {
    btn.addEventListener("click", () => load(apis.find((x) => x.slot === btn.getAttribute("data-edit"))));
  });
  el.querySelectorAll("[data-del]").forEach((btn) => {
    btn.addEventListener("click", () => remove(btn.getAttribute("data-del")));
  });
  el.querySelectorAll("[data-toggle]").forEach((btn) => {
    btn.addEventListener("click", () => toggle(btn.getAttribute("data-toggle"), btn.getAttribute("data-on") !== "1"));
  });
}

function load(a) {
  editing = a.slot;
  document.getElementById("form-title").textContent = `Edit ${a.name}`;
  document.getElementById("slot").value = a.slot;
  document.getElementById("slot").disabled = true;
  document.getElementById("name").value = a.name;
  document.getElementById("description").value = a.description || "";
  document.getElementById("method").value = a.method;
  document.getElementById("endpoint").value = a.endpoint || "";
  document.getElementById("timeoutMs").value = a.timeoutMs;
  document.getElementById("retries").value = a.retries;
  document.getElementById("enabled").checked = a.enabled !== false;
  document.getElementById("mockEnabled").checked = !!a.mockEnabled;
  document.getElementById("mockStatus").value = a.mockStatus ?? "";
  document.getElementById("mockJson").value = a.mockJson || "";
  document.getElementById("mockError").value = a.mockError || "";
  document.getElementById("msg").textContent = "";
}

function resetForm() {
  editing = null;
  document.getElementById("form-title").textContent = "Add API";
  document.getElementById("form").reset();
  document.getElementById("slot").disabled = false;
  document.getElementById("timeoutMs").value = 5000;
  document.getElementById("retries").value = 0;
  document.getElementById("enabled").checked = true;
  document.getElementById("msg").textContent = "";
}

function bodyFromForm() {
  const mockStatusRaw = document.getElementById("mockStatus").value;
  return {
    name: document.getElementById("name").value.trim(),
    description: document.getElementById("description").value.trim(),
    method: document.getElementById("method").value,
    endpoint: document.getElementById("endpoint").value.trim(),
    timeoutMs: Number(document.getElementById("timeoutMs").value) || 5000,
    retries: Number(document.getElementById("retries").value) || 0,
    enabled: document.getElementById("enabled").checked,
    mockEnabled: document.getElementById("mockEnabled").checked,
    mockJson: document.getElementById("mockJson").value,
    mockStatus: mockStatusRaw === "" ? null : Number(mockStatusRaw),
    mockError: document.getElementById("mockError").value.trim(),
  };
}

document.getElementById("form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const msg = document.getElementById("msg");
  const slot = document.getElementById("slot").value.trim();
  const payload = bodyFromForm();
  if (payload.mockJson.trim()) {
    try {
      JSON.parse(payload.mockJson);
    } catch {
      msg.textContent = "Mock JSON is not valid JSON";
      return;
    }
  }
  const action = editing
    ? `Save changes to PULSE API "${payload.name}" (${editing})?`
    : `Add PULSE API "${payload.name}" (${slot})?`;
  if (!confirm(action)) return;
  let res;
  if (editing) {
    res = await api(`/v1/pulse/apis/${encodeURIComponent(editing)}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
  } else {
    res = await api("/v1/pulse/apis", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slot, ...payload }),
    });
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    msg.textContent = data.error || "Save failed";
    return;
  }
  msg.textContent = "Saved";
  resetForm();
  await refresh();
});

async function toggle(slot, enabled) {
  const verb = enabled ? "Enable" : "Disable";
  if (!confirm(`${verb} PULSE API "${slot}"?`)) return;
  const res = await api(`/v1/pulse/apis/${encodeURIComponent(slot)}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ enabled }),
  });
  if (!res.ok) {
    document.getElementById("msg").textContent = "Enable/disable failed";
    return;
  }
  await refresh();
}

async function remove(slot) {
  if (!confirm(`Remove PULSE API "${slot}"? This cannot be undone.`)) return;
  const res = await api(`/v1/pulse/apis/${encodeURIComponent(slot)}`, { method: "DELETE" });
  if (!res.ok) {
    document.getElementById("msg").textContent = "Delete failed";
    return;
  }
  if (editing === slot) resetForm();
  await refresh();
}

document.getElementById("reset").addEventListener("click", resetForm);
document.getElementById("logout").addEventListener("click", async () => {
  await fetch("/auth/logout", { method: "POST", credentials: "same-origin" });
  window.location.href = "/";
});

function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/"/g, "&quot;");
}

boot().catch(() => {});
