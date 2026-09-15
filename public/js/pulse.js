async function api(path, opts = {}) {
  const res = await fetch(path, { credentials: "same-origin", ...opts });
  if (res.status === 401) {
    window.location.href = "/";
    throw new Error("unauthorized");
  }
  return res;
}

const PAGE_SIZE = 25;
let editing = null;
let apis = [];
let page = 1;

async function boot() {
  const me = await (await api("/auth/me")).json();
  document.getElementById("who").textContent = me.username;
  document.getElementById("avatar").textContent = (me.username || "S").slice(0, 1).toUpperCase();
  await loadAuth();
  await refresh();
}

function setAuthHint(keySet) {
  const hint = document.getElementById("auth-hint");
  hint.innerHTML = keySet
    ? '<span class="tag on">KEY ON</span> Live Pulse calls send this key. Save a new value to replace it.'
    : '<span class="tag off">NO KEY</span> Live Pulse calls go with no auth headers.';
}

async function loadAuth() {
  const res = await api("/v1/pulse/auth");
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    document.getElementById("auth-hint").textContent = data.error || "Could not load key status";
    return;
  }
  setAuthHint(!!data.keySet);
  document.getElementById("pulseApiKey").value = "";
}

async function saveAuth(apiKey, confirmMsg) {
  if (confirmMsg && !confirm(confirmMsg)) return;
  const res = await api("/v1/pulse/auth", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ apiKey }),
  });
  const data = await res.json().catch(() => ({}));
  const msg = document.getElementById("auth-msg");
  if (!res.ok) {
    msg.textContent = data.error || "Save failed";
    return;
  }
  msg.textContent = data.keySet ? "Key saved" : "Key cleared";
  document.getElementById("pulseApiKey").value = "";
  setAuthHint(!!data.keySet);
}

document.getElementById("auth-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const apiKey = document.getElementById("pulseApiKey").value;
  if (!apiKey.trim()) {
    await saveAuth("", "Save an empty key? Live Pulse calls will send no auth headers.");
    return;
  }
  await saveAuth(apiKey, "Save this Pulse API key for all live Pulse calls?");
});

document.getElementById("auth-clear").addEventListener("click", async () => {
  await saveAuth("", "Clear the Pulse API key? Live Pulse calls will send no auth headers.");
});


function filtered() {
  const q = (document.getElementById("filter")?.value || "").trim().toLowerCase();
  if (!q) return apis;
  return apis.filter(
    (a) =>
      (a.name || "").toLowerCase().includes(q) ||
      (a.slot || "").toLowerCase().includes(q) ||
      (a.endpoint || "").toLowerCase().includes(q) ||
      (a.description || "").toLowerCase().includes(q),
  );
}

function renderPager(total, pages, current) {
  const pager = document.getElementById("pager");
  if (!pager) return;
  pager.hidden = false;
  pager.innerHTML = `
    <button class="btn btn-outline-secondary" type="button" id="page-prev" ${current <= 1 ? "disabled" : ""}>Previous</button>
    <span class="muted">Page ${current} of ${pages} · ${total} API${total === 1 ? "" : "s"} · ${PAGE_SIZE} per page</span>
    <button class="btn btn-outline-secondary" type="button" id="page-next" ${current >= pages ? "disabled" : ""}>Next</button>`;
  document.getElementById("page-prev").addEventListener("click", () => {
    if (page > 1) {
      page -= 1;
      render();
    }
  });
  document.getElementById("page-next").addEventListener("click", () => {
    if (page < pages) {
      page += 1;
      render();
    }
  });
}

function render() {
  const el = document.getElementById("list");
  const all = filtered();
  const pages = Math.max(1, Math.ceil(all.length / PAGE_SIZE) || 1);
  if (page > pages) page = pages;
  if (page < 1) page = 1;
  const start = (page - 1) * PAGE_SIZE;
  const list = all.slice(start, start + PAGE_SIZE);

  if (!apis.length) {
    el.textContent = "No PULSE APIs yet.";
    renderPager(0, 1, 1);
    return;
  }
  if (!all.length) {
    el.textContent = "No APIs match the filter.";
    renderPager(0, 1, 1);
    return;
  }

  el.innerHTML = `<div class="table-responsive"><table class="table pulse-table">
    <thead><tr>
      <th class="col-name">Name</th>
      <th class="col-id">ID</th>
      <th class="col-ep">Endpoint</th>
      <th class="col-status">Status</th>
      <th class="col-actions"></th>
    </tr></thead>
    <tbody>${list
      .map(
        (a) => `<tr>
        <td title="${esc(a.description || a.name)}"><strong class="cell-clip">${esc(a.name)}</strong></td>
        <td class="api-id"><span class="cell-clip">${esc(a.slot)}</span></td>
        <td class="api-id" title="${esc(a.endpoint || "")}"><span class="cell-clip">${esc(a.endpoint || "—")}</span></td>
        <td>
          ${a.enabled ? '<span class="tag on">ON</span>' : '<span class="tag off">OFF</span>'}
          ${a.mockEnabled ? '<span class="tag">MOCK</span>' : ""}
        </td>
        <td class="col-actions">
          <div class="btn-row">
            <button class="btn btn-outline-secondary" type="button" data-toggle="${esc(a.slot)}" data-on="${a.enabled ? "1" : "0"}">${
              a.enabled ? "Disable" : "Enable"
            }</button>
            <button class="btn btn-outline-secondary" type="button" data-edit="${esc(a.slot)}">Edit</button>
            <button class="btn btn-outline-secondary" type="button" data-del="${esc(a.slot)}">Remove</button>
          </div>
        </td>
      </tr>`,
      )
      .join("")}</tbody></table></div>`;

  el.querySelectorAll("[data-edit]").forEach((btn) => {
    btn.addEventListener("click", () => load(apis.find((x) => x.slot === btn.getAttribute("data-edit"))));
  });
  el.querySelectorAll("[data-del]").forEach((btn) => {
    btn.addEventListener("click", () => remove(btn.getAttribute("data-del")));
  });
  el.querySelectorAll("[data-toggle]").forEach((btn) => {
    btn.addEventListener("click", () => toggle(btn.getAttribute("data-toggle"), btn.getAttribute("data-on") !== "1"));
  });
  renderPager(all.length, pages, page);
}

async function refresh() {
  apis = await (await api("/v1/pulse/apis")).json();
  render();
}

function load(a) {
  if (!a) return;
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
  document.getElementById("form-title").scrollIntoView({ behavior: "smooth", block: "start" });
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
document.getElementById("filter").addEventListener("input", () => {
  page = 1;
  render();
});
document.getElementById("logout").addEventListener("click", async () => {
  await fetch("/auth/logout", { method: "POST", credentials: "same-origin" });
  window.location.href = "/";
});

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/"/g, "&quot;");
}

boot().catch(() => {});
