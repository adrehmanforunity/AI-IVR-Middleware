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
let selected = 0;

function blankOption(when) {
  return { when: when || "1", action: "goto", param: "", success: "", fail: "" };
}

function blankMenu() {
  const n = menus.length + 1;
  return {
    key: String(n),
    name: n === 1 ? "Start" : `Menu ${n}`,
    description: "",
    menuFile: n === 1 ? "none" : "",
    fileInvalid: "",
    fileNoInput: "",
    inputsAcceptable: "",
    inputTimeout: null,
    maxNoInput: null,
    maxInvalid: null,
    onMaxNoInput: "hangup",
    onMaxInvalid: "hangup",
    isEntry: menus.length === 0,
    options: n === 1 ? [blankOption("none")] : [blankOption("1"), blankOption("none")],
  };
}

function numVal(v) {
  return v === null || v === undefined || v === "" ? "" : String(v);
}

function menuSelect(selectedVal) {
  const opts = [
    `<option value="hangup" ${selectedVal === "hangup" ? "selected" : ""}>Hang up</option>`,
    `<option value="repeat" ${selectedVal === "repeat" ? "selected" : ""}>Repeat this menu</option>`,
  ];
  for (const m of menus) {
    const val = `GOTO_MENU ${m.key}`;
    const sel = selectedVal === val || selectedVal === m.key ? "selected" : "";
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

function openEditor() {
  document.getElementById("editor-panel").hidden = false;
  document.getElementById("editor-panel").scrollIntoView({ behavior: "smooth", block: "start" });
}

function closeEditor() {
  document.getElementById("editor-panel").hidden = true;
  document.getElementById("ivrId").value = "";
  document.getElementById("msg").textContent = "";
}

function renderNav() {
  const el = document.getElementById("step-nav");
  el.innerHTML = menus
    .map(
      (m, i) => `<button type="button" class="${i === selected ? "on" : ""}" data-sel="${i}">
        <span class="sk">${esc(m.key)}</span>
        ${m.isEntry ? '<span class="start"> START</span>' : ""}
        <span class="sn">${esc(m.name || m.key)}</span>
      </button>`,
    )
    .join("");
  el.querySelectorAll("[data-sel]").forEach((btn) => {
    btn.addEventListener("click", () => {
      selected = Number(btn.getAttribute("data-sel"));
      renderEditor();
    });
  });
}

function renderStep() {
  const el = document.getElementById("step-form");
  const i = selected;
  const m = menus[i];
  if (!m) {
    el.innerHTML = "";
    return;
  }
  const opts = (m.options || [])
    .map(
      (o, j) => `<tr>
        <td><input data-opt="${i}:${j}:when" value="${esc(o.when)}" placeholder="1  or  none" /></td>
        <td><select data-opt="${i}:${j}:action">${actionSelect(o.action)}</select></td>
        <td><input data-opt="${i}:${j}:param" value="${esc(o.param)}" placeholder="optional" /></td>
        <td><select data-opt="${i}:${j}:success">${menuSelect(o.success)}</select></td>
        <td><select data-opt="${i}:${j}:fail">${menuSelect(o.fail)}</select></td>
        <td><button class="btn btn-outline-secondary" type="button" data-del-opt="${i}:${j}">×</button></td>
      </tr>`,
    )
    .join("");
  el.innerHTML = `<div>
      <div class="row">
        <strong>Menu ${esc(m.key)}</strong>
        <label class="muted"><input type="radio" name="entry" data-entry="${i}" ${m.isEntry ? "checked" : ""} /> Start of call</label>
        <button class="btn btn-outline-secondary" type="button" data-del-menu="${i}">Remove menu</button>
      </div>
      <div class="form-grid" style="margin-top:10px">
        <div><label>Menu id</label><input data-m="${i}:key" value="${esc(m.key)}" /></div>
        <div><label>Menu name</label><input data-m="${i}:name" value="${esc(m.name)}" /></div>
        <div class="full"><label>What this menu is for</label><input data-m="${i}:description" value="${esc(m.description)}" /></div>
        <div class="full"><label>Prompt to play</label><input data-m="${i}:menuFile" value="${esc(m.menuFile || m.fileMenu || "")}" placeholder="none, or hugo-greeting" />
          <div class="hint">File name only (not custom/…). Path = IIM Setup voice folder + inbound Voice subfolder. Several prompts: comma-separated. none = play nothing.</div></div>
        <div><label>Wrong-key prompt</label><input data-m="${i}:fileInvalid" value="${esc(m.fileInvalid)}" placeholder="use system default" /></div>
        <div><label>No-key prompt</label><input data-m="${i}:fileNoInput" value="${esc(m.fileNoInput || "")}" placeholder="use system default" /></div>
        <div><label>Keys this menu accepts</label><input data-m="${i}:inputsAcceptable" value="${esc(m.inputsAcceptable || "")}" placeholder="use system default" /></div>
        <div><label>Seconds to wait for a key</label><input type="number" min="0" data-m="${i}:inputTimeout" value="${numVal(m.inputTimeout)}" placeholder="use system default" /></div>
        <div><label>Times they can stay silent</label><input type="number" min="0" data-m="${i}:maxNoInput" value="${numVal(m.maxNoInput)}" placeholder="use system default" /></div>
        <div><label>Times they can press a wrong key</label><input type="number" min="0" data-m="${i}:maxInvalid" value="${numVal(m.maxInvalid)}" placeholder="use system default" /></div>
        <div><label>Then, after too many silences</label><select data-m="${i}:onMaxNoInput">${menuSelect(m.onMaxNoInput || "hangup")}</select></div>
        <div><label>Then, after too many wrong keys</label><select data-m="${i}:onMaxInvalid">${menuSelect(m.onMaxInvalid || "hangup")}</select></div>
      </div>
      <p class="muted" style="margin-top:12px">For each key: what IIM does, then where the call goes.</p>
      <table class="table opt-table">
        <thead><tr><th>Caller presses</th><th>IIM does</th><th>Extra</th><th>If that worked</th><th>If that failed</th><th></th></tr></thead>
        <tbody>${opts}</tbody>
      </table>
      <button class="btn btn-outline-secondary" type="button" data-add-opt="${i}" style="margin-top:8px">Add key</button>
    </div>`;
  bindStep(el);
}

function renderEditor() {
  renderNav();
  renderStep();
}

function bindStep(el) {
  el.querySelectorAll("[data-m]").forEach((inp) => {
    inp.addEventListener("change", () => {
      const [idx, field] = inp.getAttribute("data-m").split(":");
      const m = menus[Number(idx)];
      if (!m) return;
      m[field] = inp.type === "number" ? (inp.value === "" ? null : Number(inp.value)) : inp.value;
      if (field === "name" || field === "key") renderNav();
    });
  });
  el.querySelectorAll("[data-opt]").forEach((inp) => {
    inp.addEventListener("change", () => {
      const [idx, j, field] = inp.getAttribute("data-opt").split(":");
      const o = menus[Number(idx)]?.options[Number(j)];
      if (o) o[field] = inp.value;
    });
  });
  el.querySelectorAll("[data-entry]").forEach((inp) => {
    inp.addEventListener("change", () => {
      const idx = Number(inp.getAttribute("data-entry"));
      menus.forEach((m, n) => {
        m.isEntry = n === idx;
      });
      renderNav();
    });
  });
  el.querySelectorAll("[data-add-opt]").forEach((btn) => {
    btn.addEventListener("click", () => {
      menus[Number(btn.getAttribute("data-add-opt"))].options.push(blankOption(""));
      renderStep();
    });
  });
  el.querySelectorAll("[data-del-opt]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const [idx, j] = btn.getAttribute("data-del-opt").split(":").map(Number);
      menus[idx].options.splice(j, 1);
      renderStep();
    });
  });
  el.querySelectorAll("[data-del-menu]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (menus.length < 2) return;
      const idx = Number(btn.getAttribute("data-del-menu"));
      menus.splice(idx, 1);
      if (!menus.some((m) => m.isEntry)) menus[0].isEntry = true;
      selected = Math.min(selected, menus.length - 1);
      renderEditor();
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
    menuFile: m.menuFile || m.fileMenu || "",
    fileInvalid: m.fileInvalid || "",
    fileNoInput: m.fileNoInput || "",
    inputsAcceptable: m.inputsAcceptable || m.interrupt || "",
    inputTimeout: m.inputTimeout ?? null,
    maxNoInput: m.maxNoInput ?? m.retries ?? null,
    maxInvalid: m.maxInvalid ?? null,
    onMaxNoInput: m.onMaxNoInput || "",
    onMaxInvalid: m.onMaxInvalid || "",
    isEntry: m.key === ivr.entryKey,
    options: (m.options || []).map((o) => ({
      when: o.when,
      action: o.action,
      param: o.param || "",
      success: o.success || "",
      fail: o.fail || "",
    })),
  }));
  selected = 0;
  renderEditor();
  document.getElementById("msg").textContent = "";
  openEditor();
}

function newIvr() {
  document.getElementById("form-title").textContent = "New IVR";
  document.getElementById("ivrId").value = "";
  document.getElementById("name").value = "";
  document.getElementById("enabled").checked = true;
  menus = [];
  menus.push(blankMenu());
  selected = 0;
  renderEditor();
  document.getElementById("msg").textContent = "";
  openEditor();
}

function openFlow(id) {
  if (!id) {
    document.getElementById("msg").textContent = "Save the IVR first, then open the flow.";
    return;
  }
  window.open(`/ivrs/flow?id=${encodeURIComponent(id)}`, "_blank", "noopener");
}

let lastAnalyzeFiles = [];

function roleLabel(role) {
  return { menu: "Menu", invalid: "Invalid", noInput: "No input", play: "Play" }[role] || role;
}

function showAnalyze(data) {
  lastAnalyzeFiles = (data.files || []).map((f) => f.placeAs);
  document.getElementById("analyze-title").textContent = `Analyze — ${data.name || "IVR"}`;
  document.getElementById("analyze-summary").textContent =
    `${data.uniqueCount} unique file${data.uniqueCount === 1 ? "" : "s"} across ${data.menuCount} menus. ` +
    `Place them on Asterisk (wav/gsm). Missing files play a beep. Voice root: ${data.voiceRoot}. ` +
    `{language} expands to ur, en, sd, ps, ar — keep the languages you actually use.`;
  const rows = (data.files || [])
    .map((f) => {
      const used = (f.usedBy || [])
        .map((u) => `${esc(u.menuKey)} ${esc(roleLabel(u.role))}`)
        .join(", ");
      const lang = f.languageCode ? ` · ${esc(f.languageCode)}` : "";
      return `<tr>
        <td><code>${esc(f.placeAs.split("/").pop() || "")}</code>${lang}</td>
        <td><code>${esc(f.ariMedia)}</code></td>
        <td><code>${esc(f.placeAs)}</code></td>
        <td>${used}</td>
      </tr>`;
    })
    .join("");
  document.getElementById("analyze-body").innerHTML = rows
    ? `<table class="table"><thead><tr><th>File name</th><th>ARI (what IIM plays)</th><th>Place on Asterisk</th><th>Used by</th></tr></thead><tbody>${rows}</tbody></table>`
    : '<p class="muted">No voice files — this IVR only has silent / none menus.</p>';
  document.getElementById("analyze-modal").hidden = false;
}

async function analyzeSaved(id) {
  const res = await api(`/v1/ivrs/${id}/analyze`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    document.getElementById("msg").textContent = data.error || "Analyze failed";
    return;
  }
  showAnalyze(data);
}

async function analyzeEditor() {
  const msg = document.getElementById("msg");
  const body = collect();
  if (!body.menus?.length) {
    msg.textContent = "Add at least one menu, then Analyze.";
    return;
  }
  const res = await api("/v1/ivrs/analyze", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    msg.textContent = data.error || "Analyze failed";
    return;
  }
  showAnalyze(data);
}

async function refresh() {
  const rows = await (await api("/v1/ivrs")).json();
  const el = document.getElementById("list");
  if (!rows.length) {
    el.textContent = "No IVRs yet. Click New IVR, then pick it on Inbound routing so a DID can start it.";
    return rows;
  }
  el.innerHTML = `<table class="table">
    <thead><tr><th>Name</th><th>Menus</th><th>Start</th><th>Status</th><th></th></tr></thead>
    <tbody>${rows
      .map((x) => {
        const entry = x.menus.find((m) => m.key === x.entryKey);
        return `<tr>
        <td><strong>${esc(x.name)}</strong></td>
        <td>${x.menus.length}</td>
        <td>${esc(entry ? `${entry.key} · ${entry.name}` : x.entryKey || "—")}</td>
        <td>${x.enabled ? '<span class="tag on">ON</span>' : '<span class="tag off">OFF</span>'}</td>
        <td>
          <div class="btn-row">
          <button class="btn btn-outline-secondary" type="button" data-edit="${x.id}">Edit</button>
          <button class="btn btn-outline-secondary" type="button" data-analyze="${x.id}">Analyze</button>
          <button class="btn btn-outline-secondary" type="button" data-flow="${x.id}">Flow</button>
          <button class="btn btn-outline-secondary" type="button" data-del="${x.id}">Remove</button>
          </div>
        </td>
      </tr>`;
      })
      .join("")}</tbody></table>`;
  el.querySelectorAll("[data-edit]").forEach((btn) => {
    btn.addEventListener("click", () => load(rows.find((x) => String(x.id) === btn.getAttribute("data-edit"))));
  });
  el.querySelectorAll("[data-analyze]").forEach((btn) => {
    btn.addEventListener("click", () => analyzeSaved(btn.getAttribute("data-analyze")));
  });
  el.querySelectorAll("[data-flow]").forEach((btn) => {
    btn.addEventListener("click", () => openFlow(btn.getAttribute("data-flow")));
  });
  el.querySelectorAll("[data-del]").forEach((btn) => {
    btn.addEventListener("click", () => remove(btn.getAttribute("data-del"), rows));
  });
  return rows;
}

async function remove(id, rows) {
  const row = rows.find((x) => String(x.id) === String(id));
  if (!confirm(`Remove IVR “${row?.name || id}”?`)) return;
  const res = await api(`/v1/ivrs/${id}`, { method: "DELETE" });
  if (!res.ok) {
    document.getElementById("msg").textContent = "Remove failed";
    return;
  }
  closeEditor();
  await refresh();
}

async function boot() {
  const me = await (await api("/auth/me")).json();
  document.getElementById("who").textContent = me.username;
  document.getElementById("avatar").textContent = (me.username || "S").slice(0, 1).toUpperCase();
  functions = await (await api("/v1/ivrs/functions")).json();
  const rows = await refresh();
  const editId = new URLSearchParams(location.search).get("edit");
  if (editId) load(rows.find((x) => String(x.id) === String(editId)));
}

document.getElementById("form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const msg = document.getElementById("msg");
  const body = collect();
  if (!body.name || !body.menus.length) {
    msg.textContent = "Name and at least one menu are required";
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
  document.getElementById("ivrId").value = data.id;
  document.getElementById("form-title").textContent = `Edit ${data.name}`;
  await refresh();
});

document.getElementById("export-json").addEventListener("click", () => {
  const body = collect();
  if (!body.name) {
    document.getElementById("msg").textContent = "Name the IVR before export.";
    return;
  }
  const blob = new Blob([JSON.stringify(body, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${body.name.replace(/[^\w.-]+/g, "_")}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});

document.getElementById("import-json").addEventListener("click", () => {
  document.getElementById("import-file").click();
});

document.getElementById("import-file").addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  e.target.value = "";
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    const doc = parsed.menus
      ? parsed
      : { name: parsed.name || file.name.replace(/\.json$/i, ""), enabled: true, menus: parsed };
    if (!Array.isArray(doc.menus) && doc.menus && typeof doc.menus === "object") {
      doc.menus = Object.entries(doc.menus).map(([key, m]) => ({
        key: String(key).replace(/^IVR-Menu-/i, ""),
        ...m,
        menuFile: m.menuFile || m.fileMenu || "",
        options: Array.isArray(m.options)
          ? m.options
          : Object.entries(m.options || {}).map(([when, o]) => ({ when, ...o })),
      }));
    }
    if (!doc.menus?.length) throw new Error("JSON has no menus");
    load({
      id: "",
      name: doc.name || "Imported IVR",
      enabled: doc.enabled !== false,
      entryKey: doc.entryKey || doc.menus[0].key,
      menus: doc.menus,
    });
    document.getElementById("ivrId").value = "";
    document.getElementById("form-title").textContent = "Imported IVR (save to keep)";
    document.getElementById("msg").textContent = "Imported — save to store it.";
  } catch (err) {
    document.getElementById("msg").textContent = err instanceof Error ? err.message : "Import failed";
  }
});

document.getElementById("add-menu").addEventListener("click", () => {
  menus.push(blankMenu());
  selected = menus.length - 1;
  renderEditor();
});
document.getElementById("new-ivr").addEventListener("click", () => newIvr());
document.getElementById("close-editor").addEventListener("click", () => closeEditor());
document.getElementById("open-flow").addEventListener("click", () => openFlow(document.getElementById("ivrId").value));
document.getElementById("analyze-ivr").addEventListener("click", () => analyzeEditor());
document.getElementById("analyze-close").addEventListener("click", () => {
  document.getElementById("analyze-modal").hidden = true;
});
document.getElementById("analyze-copy").addEventListener("click", async () => {
  const text = lastAnalyzeFiles.join("\n");
  try {
    await navigator.clipboard.writeText(text);
    document.getElementById("analyze-summary").textContent = `Copied ${lastAnalyzeFiles.length} paths.`;
  } catch {
    document.getElementById("analyze-summary").textContent = "Copy failed — select the table instead.";
  }
});
document.getElementById("logout").addEventListener("click", async () => {
  await fetch("/auth/logout", { method: "POST", credentials: "same-origin" });
  window.location.href = "/";
});

boot().catch(() => {});
