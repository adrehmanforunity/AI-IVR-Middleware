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

function statusTag(status) {
  const labels = {
    idle: "Idle",
    "in-use": "In use",
    unregistered: "Unregistered",
    "not-on-pbx": "Not on PBX",
    unknown: "Unknown",
  };
  const cls =
    status === "idle" ? "on" : status === "in-use" ? "" : status === "unregistered" || status === "not-on-pbx" ? "off" : "";
  return `<span class="tag ${cls}">${esc(labels[status] || status)}</span>`;
}

let filter = "all";
let page = 1;
const pageSize = 50;
let lastBoard = null;

async function boot() {
  const me = await (await api("/auth/me")).json();
  document.getElementById("who").textContent = me.username;
  document.getElementById("avatar").textContent = (me.username || "S").slice(0, 1).toUpperCase();
  document.querySelectorAll(".filter-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      filter = btn.getAttribute("data-filter");
      page = 1;
      document.querySelectorAll(".filter-btn").forEach((b) => b.classList.toggle("active", b === btn));
      void refresh();
    });
  });
  document.getElementById("logout").addEventListener("click", async () => {
    await fetch("/auth/logout", { method: "POST", credentials: "same-origin" });
    window.location.href = "/";
  });
  await refresh();
  setInterval(() => {
    if (document.hidden) return;
    void refresh();
  }, 5000);
}

async function refresh() {
  const qs = new URLSearchParams({ page: String(page), pageSize: String(pageSize), status: filter });
  const res = await api(`/v1/stations?${qs}`);
  const board = await res.json();
  lastBoard = board;
  if (board.page) page = board.page;
  render(board);
}

function pagedView(board) {
  const all = board.stations || [];
  const serverPaged = Number(board.pageSize) > 0 && Number(board.total) > all.length;
  if (serverPaged) {
    const pages = Math.max(1, Number(board.pages) || 1);
    return {
      rows: all,
      total: Number(board.total),
      pages,
      current: Number(board.page) || 1,
    };
  }
  const filtered = filter === "all" ? all : all.filter((s) => s.status === filter);
  const total = filtered.length;
  const pages = Math.max(1, Math.ceil(total / pageSize) || 1);
  if (page > pages) page = pages;
  if (page < 1) page = 1;
  const start = (page - 1) * pageSize;
  return { rows: filtered.slice(start, start + pageSize), total, pages, current: page };
}

function render(board) {
  document.getElementById("range-hint").innerHTML = `Owned range <strong>${esc(board.range.from)}–${esc(
    board.range.to,
  )}</strong> — change on <a href="/telephony">Telephony Setup</a>. ${
    board.ariOk ? "ARI snapshot cached ~4s." : "ARI not available — PBX registration unknown; live IIM calls still show."
  }${board.truncated ? " List capped." : ""}`;
  document.getElementById("refresh-hint").textContent = board.refreshedAt
    ? `Updated ${new Date(board.refreshedAt).toLocaleTimeString()}`
    : "";
  const c = board.counts || {};
  document.getElementById("kpis").innerHTML = [
    ["In range", board.listed ?? 0],
    ["Registered", c.online ?? 0],
    ["Idle", c.idle ?? 0],
    ["In use", c.inUse ?? 0],
    ["Unregistered", c.unregistered ?? 0],
  ]
    .map(([k, v]) => `<div class="col-sm-6 col-lg"><div class="card"><div class="card-body"><div class="subheader">${esc(k)}</div><div class="h1 mb-0">${v}</div></div></div></div>`)
    .join("");

  const view = pagedView(board);
  const rows = view.rows;
  const el = document.getElementById("list");
  if (!rows.length) {
    el.textContent = "No stations in this filter.";
  } else {
    el.innerHTML = `<table class="table">
    <thead><tr><th>Ext</th><th>User</th><th>Agent id</th><th>Status</th><th>Live</th><th></th></tr></thead>
    <tbody>${rows
      .map(
        (s) => `<tr>
      <td><strong>${esc(s.extension)}</strong></td>
      <td>${esc(s.displayName) || "<span class='muted'>—</span>"}
        ${s.notes ? `<div class="muted">${esc(s.notes)}</div>` : ""}</td>
      <td>${esc(s.agentId) || "<span class='muted'>—</span>"}</td>
      <td>${statusTag(s.status)}${s.channelCount ? ` <span class="muted">${s.channelCount} ch</span>` : ""}</td>
      <td>${
        s.live
          ? `${esc(s.live.state)} · ${esc(s.live.callerId) || "no CID"} → ${esc(s.live.did) || "—"}`
          : "<span class='muted'>—</span>"
      }</td>
      <td><button class="btn ghost" type="button" data-edit="${esc(s.extension)}">Edit</button></td>
    </tr>`,
      )
      .join("")}</tbody></table>`;
    el.querySelectorAll("[data-edit]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const ext = btn.getAttribute("data-edit");
        const row = rows.find((x) => x.extension === ext);
        if (row) openEdit(row);
      });
    });
  }
  renderPager(view);
}

function renderPager(view) {
  const pager = document.getElementById("pager");
  const pages = view.pages;
  const current = view.current;
  pager.hidden = false;
  pager.innerHTML = `
    <button class="btn ghost" type="button" id="page-prev" ${current <= 1 ? "disabled" : ""}>Previous</button>
    <span class="muted">Page ${current} of ${pages} · ${view.total} extensions · ${pageSize} per page</span>
    <button class="btn ghost" type="button" id="page-next" ${current >= pages ? "disabled" : ""}>Next</button>`;
  document.getElementById("page-prev").addEventListener("click", () => {
    if (page > 1) {
      page -= 1;
      void refresh();
    }
  });
  document.getElementById("page-next").addEventListener("click", () => {
    if (page < pages) {
      page += 1;
      void refresh();
    }
  });
}

function openEdit(row) {
  if (document.getElementById("st-modal")) return;
  document.body.insertAdjacentHTML(
    "beforeend",
    `<div class="modal-back" id="st-modal">
      <div class="modal-card">
        <h3>Station ${esc(row.extension)}</h3>
        <p class="muted">Stored in IIM (SQLite). Not written to Asterisk or PULSE.</p>
        <form id="st-form">
          <label for="st-name">Display name</label>
          <input id="st-name" value="${esc(row.displayName)}" autocomplete="off" />
          <label for="st-agent">Agent id</label>
          <input id="st-agent" value="${esc(row.agentId)}" autocomplete="off" placeholder="PULSE / HR id" />
          <label for="st-notes">Notes</label>
          <input id="st-notes" value="${esc(row.notes)}" autocomplete="off" />
          <p class="muted" id="st-msg"></p>
          <div class="modal-actions">
            <button class="btn ghost" type="button" id="st-cancel">Cancel</button>
            <button class="btn" type="submit">Save</button>
          </div>
        </form>
      </div>
    </div>`,
  );
  const wrap = document.getElementById("st-modal");
  const close = () => wrap.remove();
  wrap.addEventListener("click", (e) => {
    if (e.target === wrap) close();
  });
  document.getElementById("st-cancel").addEventListener("click", close);
  document.getElementById("st-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = document.getElementById("st-msg");
    const res = await api(`/v1/stations/${encodeURIComponent(row.extension)}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        displayName: document.getElementById("st-name").value,
        agentId: document.getElementById("st-agent").value,
        notes: document.getElementById("st-notes").value,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      msg.textContent = data.error || "Save failed";
      return;
    }
    close();
    await refresh();
  });
}

boot().catch(() => {});
