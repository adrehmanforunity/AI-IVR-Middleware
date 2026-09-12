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

let menus = [];
let functions = [];

function blankOption(when) {
  return { when: when || "1", action: "goto", param: "", success: "", fail: "" };
}

function blankMenu() {
  const n = menus.length + 1;
  const key = String(n);
  return {
    key,
    name: n === 1 ? "Start" : `Step ${n}`,
    description: "",
    fileMenu: n === 1 ? "none" : "hello-world",
    interrupt: "",
    fileInvalid: "",
    inputTimeout: n === 1 ? 0 : 5,
    retries: n === 1 ? 0 : 3,
    isEntry: menus.length === 0,
    options:
      n === 1
        ? [blankOption("none")]
        : [blankOption("1"), blankOption("none"), { when: "MaxTries", action: "hangup", param: "", success: "hangup", fail: "hangup" }],
  };
}

async function boot() {
  const me = await (await api("/auth/me")).json();
  document.getElementById("who").textContent = me.username;
  document.getElementById("avatar").textContent = (me.username || "S").slice(0, 1).toUpperCase();
  functions = await (await api("/v1/ivrs/functions")).json();
  resetForm();
  await refresh();
}

async function refresh() {
  const rows = await (await api("/v1/ivrs")).json();
  const el = document.getElementById("list");
  if (!rows.length) {
    el.textContent = "No IVRs yet. Add one below, then attach it on Call setups.";
    return;
  }
  el.innerHTML = `<table class="table">
    <thead><tr><th>Name</th><th>Steps</th><th>Start</th><th>Status</th><th></th></tr></thead>
    <tbody>${rows
      .map((x) => {
        const entry = x.menus.find((m) => m.key === x.entryKey);
        return `<tr>
        <td><strong>${esc(x.name)}</strong></td>
        <td>${x.menus.length}</td>
        <td>${esc(entry ? `${entry.key} · ${entry.name}` : x.entryKey || "—")}</td>
        <td>${x.enabled ? '<span class="tag on">ON</span>' : '<span class="tag off">OFF</span>'}</td>
        <td>
          <button class="btn ghost" type="button" data-edit="${x.id}">Edit</button>
          <button class="btn ghost" type="button" data-del="${x.id}">Remove</button>
        </td>
      </tr>`;
      })
      .join("")}</tbody></table>`;
  el.querySelectorAll("[data-edit]").forEach((btn) => {
    btn.addEventListener("click", () => load(rows.find((x) => String(x.id) === btn.getAttribute("data-edit"))));
  });
  el.querySelectorAll("[data-del]").forEach((btn) => {
    btn.addEventListener("click", () => remove(btn.getAttribute("data-del"), rows));
  });
}

function menuSelect(selected) {
  const opts = [
    `<option value="hangup" ${selected === "hangup" ? "selected" : ""}>Hang up</option>`,
    `<option value="repeat" ${selected === "repeat" ? "selected" : ""}>Repeat this step</option>`,
  ];
  for (const m of menus) {
    const val = `GOTO_MENU ${m.key}`;
    const sel = selected === val || selected === m.key ? "selected" : "";
    opts.push(`<option value="${esc(val)}" ${sel}>Go to ${esc(m.key)} — ${esc(m.name)}</option>`);
  }
  return opts.join("");
}

function actionSelect(value) {
  const groups = [
    { label: "Generic", items: functions.filter((f) => f.source === "generic") },
    { label: "Custom", items: functions.filter((f) => f.source === "custom") },
  ];
  let html = "";
  for (const g of groups) {
    if (!g.items.length) continue;
    html += `<optgroup label="${esc(g.label)}">`;
    for (const f of g.items) {
      const sel = f.name.toLowerCase() === String(value || "").toLowerCase() ? "selected" : "";
      html += `<option value="${esc(f.name)}" ${sel}>${esc(f.name)}</option>`;
    }
    html += "</optgroup>";
  }
  return html;
}

function renderMenus() {
  const el = document.getElementById("menus");
  el.innerHTML = menus
    .map((m, i) => {
      const opts = (m.options || [])
        .map(
          (o, j) => `<tr>
            <td><input data-opt="${i}:${j}:when" value="${esc(o.when)}" placeholder="1 / none / MaxTries" /></td>
            <td><select data-opt="${i}:${j}:action">${actionSelect(o.action)}</select></td>
            <td><input data-opt="${i}:${j}:param" value="${esc(o.param)}" placeholder="optional" /></td>
            <td><select data-opt="${i}:${j}:success">${menuSelect(o.success)}</select></td>
            <td><select data-opt="${i}:${j}:fail">${menuSelect(o.fail)}</select></td>
            <td><button class="btn ghost" type="button" data-del-opt="${i}:${j}">×</button></td>
          </tr>`,
        )
        .join("");
      return `<div class="panel" style="margin-top:16px;background:#f8fbff">
        <div class="row">
          <strong>Step ${esc(m.key)}</strong>
          <label class="muted"><input type="radio" name="entry" data-entry="${i}" ${m.isEntry ? "checked" : ""} /> Start here</label>
          <button class="btn ghost" type="button" data-del-menu="${i}">Remove step</button>
        </div>
        <div class="form-grid" style="margin-top:10px">
          <div><label>Key</label><input data-m="${i}:key" value="${esc(m.key)}" /></div>
          <div><label>Name</label><input data-m="${i}:name" value="${esc(m.name)}" /></div>
          <div class="full"><label>Description</label><input data-m="${i}:description" value="${esc(m.description)}" /></div>
          <div><label>Play</label><input data-m="${i}:fileMenu" value="${esc(m.fileMenu)}" placeholder="none or hello-world A" />
            <div class="hint">none = no file. Optional barge-in keys after the name (A = never barge from the phone).</div></div>
          <div><label>Interrupt keys</label><input data-m="${i}:interrupt" value="${esc(m.interrupt)}" placeholder="optional *#0123456789" /></div>
          <div><label>Invalid sound</label><input data-m="${i}:fileInvalid" value="${esc(m.fileInvalid)}" /></div>
          <div><label>Wait for input (sec)</label><input type="number" min="0" data-m="${i}:inputTimeout" value="${m.inputTimeout}" />
            <div class="hint">0 = run Auto / No input as soon as play finishes (or immediately if nothing to play).</div></div>
          <div><label>Retries</label><input type="number" min="0" data-m="${i}:retries" value="${m.retries}" />
            <div class="hint">0 = this step once. 3 = three no-input/invalid cycles then Max tries.</div></div>
        </div>
        <p class="muted" style="margin-top:12px">When → Do → Then if OK / Then if failed</p>
        <table class="table opt-table">
          <thead><tr><th>When</th><th>Do</th><th>Param</th><th>Then if OK</th><th>Then if failed</th><th></th></tr></thead>
          <tbody>${opts}</tbody>
        </table>
        <button class="btn ghost" type="button" data-add-opt="${i}" style="margin-top:8px">Add row</button>
      </div>`;
    })
    .join("");

  el.querySelectorAll("[data-m]").forEach((inp) => {
    inp.addEventListener("change", () => {
      const [i, field] = inp.getAttribute("data-m").split(":");
      const m = menus[Number(i)];
      if (!m) return;
      m[field] = inp.type === "number" ? Number(inp.value) : inp.value;
      if (field === "name" || field === "key") renderMenus();
    });
  });
  el.querySelectorAll("[data-opt]").forEach((inp) => {
    inp.addEventListener("change", () => {
      const [i, j, field] = inp.getAttribute("data-opt").split(":");
      const o = menus[Number(i)]?.options[Number(j)];
      if (o) o[field] = inp.value;
    });
  });
  el.querySelectorAll("[data-entry]").forEach((inp) => {
    inp.addEventListener("change", () => {
      const idx = Number(inp.getAttribute("data-entry"));
      menus.forEach((m, i) => {
        m.isEntry = i === idx;
      });
    });
  });
  el.querySelectorAll("[data-add-opt]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const i = Number(btn.getAttribute("data-add-opt"));
      menus[i].options.push(blankOption(""));
      renderMenus();
    });
  });
  el.querySelectorAll("[data-del-opt]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const [i, j] = btn.getAttribute("data-del-opt").split(":").map(Number);
      menus[i].options.splice(j, 1);
      renderMenus();
    });
  });
  el.querySelectorAll("[data-del-menu]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const i = Number(btn.getAttribute("data-del-menu"));
      if (menus.length < 2) return;
      menus.splice(i, 1);
      if (!menus.some((m) => m.isEntry)) menus[0].isEntry = true;
      renderMenus();
    });
  });
}

function collect() {
  return {
    name: document.getElementById("name").value.trim(),
    enabled: document.getElementById("enabled").checked,
    entryKey: (menus.find((m) => m.isEntry) || menus[0]).key,
    menus,
  };
}

function load(ivr) {
  if (!ivr) return;
  document.getElementById("form-title").textContent = `Edit ${ivr.name}`;
  document.getElementById("ivrId").value = ivr.id;
  document.getElementById("name").value = ivr.name;
  document.getElementById("enabled").checked = !!ivr.enabled;
  menus = (ivr.menus || []).map((m) => ({
    key: m.key,
    name: m.name,
    description: m.description || "",
    fileMenu: m.fileMenu || "",
    interrupt: m.interrupt || "",
    fileInvalid: m.fileInvalid || "",
    inputTimeout: m.inputTimeout ?? 0,
    retries: m.retries ?? 0,
    isEntry: m.key === ivr.entryKey,
    options: (m.options || []).map((o) => ({
      when: o.when,
      action: o.action,
      param: o.param || "",
      success: o.success || "",
      fail: o.fail || "",
    })),
  }));
  renderMenus();
  document.getElementById("msg").textContent = "";
}

function resetForm() {
  document.getElementById("form-title").textContent = "Add IVR";
  document.getElementById("ivrId").value = "";
  document.getElementById("name").value = "";
  document.getElementById("enabled").checked = true;
  menus = [];
  menus.push(blankMenu());
  renderMenus();
  document.getElementById("msg").textContent = "";
}

document.getElementById("form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const msg = document.getElementById("msg");
  const body = collect();
  if (!body.name || !body.menus.length) {
    msg.textContent = "Name and at least one step are required";
    return;
  }
  if (!confirm(`Save IVR “${body.name}”?`)) return;
  const id = document.getElementById("ivrId").value;
  const res = await api(id ? `/v1/ivrs/${id}` : "/v1/ivrs", {
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
  if (!confirm(`Remove IVR “${row?.name || id}”?`)) return;
  const res = await api(`/v1/ivrs/${id}`, { method: "DELETE" });
  if (!res.ok) {
    document.getElementById("msg").textContent = "Remove failed";
    return;
  }
  resetForm();
  await refresh();
}

document.getElementById("add-menu").addEventListener("click", () => {
  menus.push(blankMenu());
  renderMenus();
});
document.getElementById("reset").addEventListener("click", () => resetForm());
document.getElementById("logout").addEventListener("click", async () => {
  await fetch("/auth/logout", { method: "POST", credentials: "same-origin" });
  window.location.href = "/";
});

boot().catch(() => {});
