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
  const apis = await (await api("/v1/pulse/apis")).json();
  document.getElementById("pulseSlot").innerHTML = apis
    .map((a) => `<option value="${esc(a.slot)}">${esc(a.name)} (${esc(a.slot)})</option>`)
    .join("");
  await refresh();
}

async function refresh() {
  const catalog = await (await api("/v1/ivrs/functions")).json();
  const generic = catalog.filter((f) => f.source === "generic");
  const custom = await (await api("/v1/ivrs/functions/custom")).json();
  document.getElementById("generic").innerHTML = `<table class="table">
    <thead><tr><th>Name</th><th>Type</th><th>PULSE API</th><th>Description</th></tr></thead>
    <tbody>${generic
      .map(
        (f) => `<tr>
        <td class="api-id">${esc(f.name)}</td>
        <td>${esc(f.kind)}</td>
        <td>${esc(f.pulseSlot || "—")}</td>
        <td>${esc(f.description)}</td>
      </tr>`,
      )
      .join("")}</tbody></table>`;
  const el = document.getElementById("custom");
  if (!custom.length) {
    el.textContent = "No custom functions yet. Add one below for this customer.";
  } else {
    el.innerHTML = `<table class="table">
      <thead><tr><th>Name</th><th>PULSE API</th><th>Status</th><th></th></tr></thead>
      <tbody>${custom
        .map(
          (f) => `<tr>
          <td><strong>${esc(f.name)}</strong><div class="muted">${esc(f.description || "")}</div></td>
          <td class="api-id">${esc(f.pulseSlot)}</td>
          <td>${f.enabled ? '<span class="tag on">ON</span>' : '<span class="tag off">OFF</span>'}</td>
          <td>
            <button class="btn btn-outline-secondary" type="button" data-edit="${f.id}">Edit</button>
            <button class="btn btn-outline-secondary" type="button" data-del="${f.id}">Remove</button>
          </td>
        </tr>`,
        )
        .join("")}</tbody></table>`;
    el.querySelectorAll("[data-edit]").forEach((btn) => {
      btn.addEventListener("click", () => load(custom.find((x) => String(x.id) === btn.getAttribute("data-edit"))));
    });
    el.querySelectorAll("[data-del]").forEach((btn) => {
      btn.addEventListener("click", () => remove(btn.getAttribute("data-del"), custom));
    });
  }
}

function load(f) {
  if (!f) return;
  document.getElementById("form-title").textContent = `Edit ${f.name}`;
  document.getElementById("fnId").value = f.id;
  document.getElementById("name").value = f.name;
  document.getElementById("description").value = f.description || "";
  document.getElementById("pulseSlot").value = f.pulseSlot;
  document.getElementById("paramHint").value = f.paramHint || "";
  document.getElementById("enabled").checked = !!f.enabled;
  document.getElementById("msg").textContent = "";
}

function resetForm() {
  document.getElementById("form-title").textContent = "Add custom function";
  document.getElementById("fnId").value = "";
  document.getElementById("form").reset();
  document.getElementById("enabled").checked = true;
  document.getElementById("msg").textContent = "";
}

document.getElementById("form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const msg = document.getElementById("msg");
  const body = {
    name: document.getElementById("name").value.trim(),
    description: document.getElementById("description").value.trim(),
    pulseSlot: document.getElementById("pulseSlot").value,
    paramHint: document.getElementById("paramHint").value.trim(),
    enabled: document.getElementById("enabled").checked,
  };
  if (!body.name || !body.pulseSlot) {
    msg.textContent = "Name and PULSE API are required";
    return;
  }
  if (!confirm(`Save function “${body.name}”?`)) return;
  const id = document.getElementById("fnId").value;
  const res = await api(id ? `/v1/ivrs/functions/custom/${id}` : "/v1/ivrs/functions/custom", {
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

async function remove(id, rows) {
  const row = rows.find((x) => String(x.id) === String(id));
  if (!confirm(`Remove function “${row?.name || id}”?`)) return;
  const res = await api(`/v1/ivrs/functions/custom/${id}`, { method: "DELETE" });
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
