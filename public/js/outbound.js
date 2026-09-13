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

function audienceLabel(v) {
  if (v === "robo") return "Robo only";
  if (v === "agents") return "Agents only";
  return "Robo and agents";
}

function statusTag(state) {
  const s = String(state || "unknown").toLowerCase();
  if (s === "online") return `<span class="tag on">${esc(state)}</span>`;
  if (s === "offline" || s === "unavailable" || s === "not on asterisk") return `<span class="tag off">${esc(state)}</span>`;
  return `<span class="tag">${esc(state)}</span>`;
}

async function boot() {
  const me = await (await api("/auth/me")).json();
  document.getElementById("who").textContent = me.username;
  document.getElementById("avatar").textContent = (me.username || "S").slice(0, 1).toUpperCase();
  await refresh();
}

async function refresh() {
  const data = await (await api("/v1/outbound-routes")).json();
  const rows = data.routes || [];
  const el = document.getElementById("list");
  if (!rows.length) {
    el.textContent = "None yet. Add a route below, or pick a trunk from the Asterisk list.";
  } else {
    el.innerHTML = `<table class="table">
      <thead><tr><th>Name</th><th>Description</th><th>Trunk</th><th>Trunk status</th><th>For</th><th>Status</th><th></th></tr></thead>
      <tbody>${rows
        .map(
          (x) => `<tr>
          <td><strong>${esc(x.name)}</strong></td>
          <td>${esc(x.description || "—")}</td>
          <td>${esc(x.trunk)}</td>
          <td>${statusTag(x.trunkStatus)}</td>
          <td>${esc(audienceLabel(x.audience))}</td>
          <td>${x.enabled ? '<span class="tag on">ON</span>' : '<span class="tag off">OFF</span>'}</td>
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

  const ast = document.getElementById("asterisk");
  if (!data.asteriskOk) {
    ast.textContent = "Could not read trunks from Asterisk. Check ARI on Telephony Setup.";
    return;
  }
  const trunks = data.asteriskTrunks || [];
  if (!trunks.length) {
    ast.textContent = "No trunks found. Phone extensions (numbers) are not listed here.";
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
      document.getElementById("trunk").value = btn.getAttribute("data-use") || "";
      document.getElementById("form-title").scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
}

function load(x) {
  if (!x) return;
  document.getElementById("form-title").textContent = `Edit ${x.name}`;
  document.getElementById("routeId").value = x.id;
  document.getElementById("name").value = x.name;
  document.getElementById("description").value = x.description || "";
  document.getElementById("trunk").value = x.trunk || "";
  document.getElementById("audience").value = x.audience || "both";
  document.getElementById("enabled").checked = !!x.enabled;
  document.getElementById("msg").textContent = "";
}

function resetForm() {
  document.getElementById("form-title").textContent = "Add outbound route";
  document.getElementById("routeId").value = "";
  document.getElementById("form").reset();
  document.getElementById("audience").value = "both";
  document.getElementById("enabled").checked = true;
  document.getElementById("msg").textContent = "";
}

function bodyFromForm() {
  return {
    name: document.getElementById("name").value.trim(),
    description: document.getElementById("description").value.trim(),
    trunk: document.getElementById("trunk").value.trim(),
    audience: document.getElementById("audience").value,
    enabled: document.getElementById("enabled").checked,
  };
}

document.getElementById("form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const msg = document.getElementById("msg");
  const body = bodyFromForm();
  if (!body.name || !body.trunk) {
    msg.textContent = "Name and trunk are required";
    return;
  }
  const id = document.getElementById("routeId").value;
  if (!confirm(id ? `Save outbound route “${body.name}”?` : `Add outbound route “${body.name}”?`)) return;
  const res = await api(id ? `/v1/outbound-routes/${id}` : "/v1/outbound-routes", {
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
  if (!confirm(`${enable ? "Enable" : "Disable"} “${row?.name || id}”?`)) return;
  const res = await api(`/v1/outbound-routes/${id}`, {
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
  if (!confirm(`Remove outbound route “${row?.name || id}”?`)) return;
  const res = await api(`/v1/outbound-routes/${id}`, { method: "DELETE" });
  if (!res.ok) {
    document.getElementById("msg").textContent = "Remove failed";
    return;
  }
  resetForm();
  await refresh();
}

document.getElementById("refresh-trunks").addEventListener("click", async () => {
  document.getElementById("asterisk").textContent = "Refreshing…";
  await refresh();
});
document.getElementById("reset").addEventListener("click", () => resetForm());
document.getElementById("logout").addEventListener("click", async () => {
  await fetch("/auth/logout", { method: "POST", credentials: "same-origin" });
  window.location.href = "/";
});

boot().catch(() => {});
