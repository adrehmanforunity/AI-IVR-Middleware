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

function fmtSize(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function fmtDay(day) {
  if (!/^\d{8}$/.test(day)) return day;
  return `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}`;
}

const KIND_LABEL = { app: "App", ami: "AMI", ari: "ARI" };

let files = [];

function visible() {
  const day = document.getElementById("filter-day").value;
  const kind = document.getElementById("filter-kind").value;
  return files.filter((f) => (!day || f.day === day) && (!kind || f.kind === kind));
}

function selectedIds() {
  return [...document.querySelectorAll("#rows input[type=checkbox]:checked")].map((el) => el.value);
}

function render() {
  const list = visible();
  const body = document.getElementById("rows");
  if (!list.length) {
    body.innerHTML = `<tr><td colspan="6" class="muted">No files match the filter.</td></tr>`;
    return;
  }
  body.innerHTML = list
    .map(
      (f) => `<tr>
        <td><input type="checkbox" value="${esc(f.id)}" /></td>
        <td>${esc(fmtDay(f.day))}</td>
        <td>${esc(f.hour)}:00</td>
        <td><span class="log-kind ${esc(f.kind)}">${esc(KIND_LABEL[f.kind] || f.kind)}</span></td>
        <td class="api-id">${esc(f.name)}</td>
        <td>${esc(fmtSize(f.size))}</td>
      </tr>`,
    )
    .join("");
}

async function load() {
  const msg = document.getElementById("msg");
  msg.textContent = "";
  const res = await api("/v1/logs");
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    document.getElementById("root-hint").textContent = data.error || "Could not list logs";
    files = [];
    render();
    return;
  }
  files = data.files || [];
  document.getElementById("root-hint").textContent =
    `${files.length} file(s) under ${data.root || "—"}${data.source === "temp" ? " (temp fallback)" : ""}.`;
  const days = [...new Set(files.map((f) => f.day))];
  const sel = document.getElementById("filter-day");
  const keep = sel.value;
  sel.innerHTML =
    `<option value="">All days</option>` +
    days.map((d) => `<option value="${esc(d)}">${esc(fmtDay(d))}</option>`).join("");
  if (keep && days.includes(keep)) sel.value = keep;
  render();
}

async function download() {
  const ids = selectedIds();
  const msg = document.getElementById("msg");
  if (!ids.length) {
    msg.textContent = "Select at least one file.";
    return;
  }
  const format = document.querySelector('input[name="fmt"]:checked')?.value || "zip";
  msg.textContent = "Preparing download…";
  const res = await api("/v1/logs/download", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ files: ids, format }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    msg.textContent = data.error || `Download failed (${res.status})`;
    return;
  }
  const blob = await res.blob();
  const cd = res.headers.get("content-disposition") || "";
  const m = /filename="([^"]+)"/.exec(cd);
  const name = m ? m[1] : format === "zip" ? "iim-logs.zip" : "iim-logs.gz";
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
  msg.textContent = `Saved ${name} (${ids.length} file${ids.length === 1 ? "" : "s"}).`;
}

document.getElementById("filter-day").addEventListener("change", render);
document.getElementById("filter-kind").addEventListener("change", render);
document.getElementById("sel-all").addEventListener("change", (e) => {
  const on = e.target.checked;
  document.querySelectorAll("#rows input[type=checkbox]").forEach((el) => {
    el.checked = on;
  });
});
document.getElementById("refresh").addEventListener("click", () => load());
document.getElementById("download").addEventListener("click", () => download().catch(() => {}));
document.getElementById("logout").addEventListener("click", async () => {
  await fetch("/auth/logout", { method: "POST", credentials: "same-origin" });
  window.location.href = "/";
});

(async () => {
  const me = await (await api("/auth/me")).json();
  document.getElementById("who").textContent = me.username;
  document.getElementById("avatar").textContent = (me.username || "S").slice(0, 1).toUpperCase();
  await load();
})().catch(() => {});
