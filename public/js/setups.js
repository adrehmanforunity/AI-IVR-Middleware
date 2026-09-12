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

async function boot() {
  const me = await (await api("/auth/me")).json();
  document.getElementById("who").textContent = me.username;
  document.getElementById("avatar").textContent = (me.username || "S").slice(0, 1).toUpperCase();
  const ivrs = await (await api("/v1/ivrs")).json();
  const sel = document.getElementById("ivrId");
  sel.innerHTML =
    `<option value="">None (answer and wait)</option>` +
    ivrs.map((i) => `<option value="${i.id}">${esc(i.name)}</option>`).join("");
  await refresh();
}

async function refresh() {
  const rows = await (await api("/v1/setups")).json();
  const el = document.getElementById("list");
  if (!rows.length) {
    el.textContent = "No setups yet. Add one below — for the 2098 → 7777 lab test use DID 7777 and leave trunk empty.";
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
        <td>${x.activeCount}/${x.maxConcurrent}</td>
        <td>${x.enabled ? '<span class="tag on">ON</span>' : '<span class="tag off">DRAIN</span>'}</td>
        <td>
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
}

function load(x) {
  if (!x) return;
  document.getElementById("form-title").textContent = `Edit ${x.name}`;
  document.getElementById("setupId").value = x.id;
  document.getElementById("name").value = x.name;
  document.getElementById("matchDid").value = x.matchDid || "";
  document.getElementById("matchTrunk").value = x.matchTrunk || "";
  document.getElementById("maxConcurrent").value = x.maxConcurrent;
  document.getElementById("ivrId").value = x.ivrId || "";
  document.getElementById("enabled").checked = !!x.enabled;
  document.getElementById("msg").textContent = "";
}

function resetForm() {
  document.getElementById("form-title").textContent = "Add setup";
  document.getElementById("setupId").value = "";
  document.getElementById("form").reset();
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
    ? `Save changes to setup “${body.name}”?`
    : `Add setup “${body.name}” (DID ${body.matchDid || "any"} / trunk ${body.matchTrunk || "any"})?`;
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
  if (!confirm(`Remove setup “${row?.name || id}”?`)) return;
  const res = await api(`/v1/setups/${id}`, { method: "DELETE" });
  if (!res.ok) {
    document.getElementById("msg").textContent = "Remove failed";
    return;
  }
  resetForm();
  await refresh();
}

document.getElementById("reset").addEventListener("click", () => resetForm());
document.getElementById("logout").addEventListener("click", async () => {
  await fetch("/auth/logout", { method: "POST", credentials: "same-origin" });
  window.location.href = "/";
});

boot().catch(() => {});
