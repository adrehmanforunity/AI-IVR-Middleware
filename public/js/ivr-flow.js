async function api(path) {
  const res = await fetch(path, { credentials: "same-origin" });
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

function playLine(m) {
  const f = String(m.menuFile || m.fileMenu || "").trim();
  if (!f || /^none$/i.test(f.split(/[,;]/)[0] || "")) return "none";
  return f;
}

function friendlyWhen(when) {
  const w = String(when || "").trim();
  const l = w.toLowerCase();
  if (l === "none" || l === "auto" || l === "noinput" || l === "no input") return "No key";
  if (l === "maxtries" || l === "max tries") return "Max tries";
  if (/^\d+$/.test(w) || w === "*" || w === "#") return w;
  return w || "Go";
}

function menuByToken(menus, raw) {
  const token = String(raw || "")
    .replace(/^GOTO_MENU\s+/i, "")
    .replace(/^goto\s+/i, "")
    .trim();
  if (!token) return null;
  return (
    menus.find((m) => String(m.key) === token) ||
    menus.find((m) => String(m.key).toLowerCase() === `ivr-menu-${token}`.toLowerCase()) ||
    menus.find((m) => String(m.key).toLowerCase() === token.toLowerCase().replace(/^ivr-menu-/, "")) ||
    menus.find((m) => m.name.toLowerCase() === token.toLowerCase()) ||
    null
  );
}

function destOf(raw, action, menus) {
  const a = String(action || "").trim();
  const s = String(raw || "").trim();
  const la = a.toLowerCase();
  const ls = s.toLowerCase();
  if (la === "repeat" || la === "replay" || ls === "repeat" || ls === "replay") return { id: "repeat" };
  if (la === "hangup" || la === "hang up" || ls === "hangup" || ls === "hang up") return { id: "hangup" };
  const token = s || (/^GOTO_MENU\b/i.test(a) ? a : "");
  if (!token) return { id: "hangup" };
  const m = menuByToken(menus, token);
  return m ? { id: String(m.key) } : { id: "hangup" };
}

function buildGraph(ivr) {
  const menus = ivr.menus || [];
  const entry = menus.find((m) => m.key === ivr.entryKey) || menus[0];
  const nodes = new Map();
  nodes.set("start", {
    id: "start",
    kind: "start",
    k: "IVR",
    t: ivr.name || "Untitled",
    s: entry ? `Starts at ${entry.name || entry.key}` : "",
  });
  for (const m of menus) {
    const wait = Number(m.inputTimeout) > 0 ? `Wait ${m.inputTimeout}s` : "Auto";
    nodes.set(String(m.key), {
      id: String(m.key),
      kind: "menu",
      k: `Menu ${m.key}`,
      t: m.name || m.key,
      s: `${playLine(m)} · ${wait}`,
    });
  }
  const edges = [];
  if (entry) edges.push({ from: "start", to: String(entry.key), label: "Start", fail: false });

  for (const m of menus) {
    for (const o of m.options || []) {
      const ok = destOf(o.success, o.action, menus);
      const fail = destOf(o.fail, o.action, menus);
      const when = friendlyWhen(o.when);
      const push = (dest, failFlag, label) => {
        if (dest.id === "repeat") {
          edges.push({ from: String(m.key), to: String(m.key), label, fail: failFlag });
          return;
        }
        if (dest.id === "hangup") nodes.set("hangup", { id: "hangup", kind: "end", k: "End", t: "Hang up", s: "" });
        edges.push({ from: String(m.key), to: dest.id, label, fail: failFlag });
      };
      push(ok, false, when);
      if (String(o.fail || "").trim() && fail.id !== ok.id) push(fail, true, `${when} · fail`);
    }
  }

  const uniq = [];
  const seen = new Set();
  for (const e of edges) {
    const k = `${e.from}>${e.to}>${e.label}>${e.fail}`;
    if (seen.has(k)) continue;
    seen.add(k);
    uniq.push(e);
  }
  return { nodes, edges: uniq };
}

function layout(graph) {
  const { nodes, edges } = graph;
  const kids = new Map();
  for (const n of nodes.keys()) kids.set(n, []);
  for (const e of edges) {
    if (e.from === e.to) continue;
    const list = kids.get(e.from) || [];
    if (!list.includes(e.to) && nodes.has(e.to)) list.push(e.to);
    kids.set(e.from, list);
  }
  const rank = new Map();
  const q = ["start"];
  rank.set("start", 0);
  while (q.length) {
    const id = q.shift();
    for (const to of kids.get(id) || []) {
      if (to === "hangup") continue;
      const next = (rank.get(id) ?? 0) + 1;
      if (!rank.has(to) || rank.get(to) > next) {
        rank.set(to, next);
        q.push(to);
      }
    }
  }
  let max = 0;
  for (const r of rank.values()) max = Math.max(max, r);
  for (const id of nodes.keys()) {
    if (id === "hangup") continue;
    if (!rank.has(id)) {
      max += 1;
      rank.set(id, max);
    }
  }
  if (nodes.has("hangup")) {
    max += 1;
    rank.set("hangup", max);
  }
  const byRank = new Map();
  for (const [id, r] of rank) {
    if (!byRank.has(r)) byRank.set(r, []);
    byRank.get(r).push(id);
  }
  const NW = 200;
  const NH = 78;
  const GX = 36;
  const GY = 108;
  let maxW = 640;
  const pos = {};
  const ranks = [...byRank.keys()].sort((a, b) => a - b);
  for (const r of ranks) {
    const ids = byRank.get(r);
    const rowW = ids.length * NW + Math.max(0, ids.length - 1) * GX;
    maxW = Math.max(maxW, rowW + 48);
    const origin = 24 + Math.max(0, (maxW - rowW) / 2);
    ids.forEach((id, i) => {
      pos[id] = { x: origin + i * (NW + GX), y: 28 + r * (NH + GY), w: NW, h: NH };
    });
  }
  const height = 28 + (max + 1) * (NH + GY);
  return { pos, width: maxW, height, NW, NH };
}

function elbow(a, b) {
  const x1 = a.x + a.w / 2;
  const y1 = a.y + a.h;
  const x2 = b.x + b.w / 2;
  const y2 = b.y;
  if (b.y >= a.y + a.h - 8) {
    const mid = (y1 + y2) / 2;
    return { d: `M ${x1} ${y1} C ${x1} ${mid}, ${x2} ${mid}, ${x2} ${y2}`, lx: (x1 + x2) / 2, ly: mid };
  }
  const side = x1 <= x2 ? Math.min(x1, x2) - 28 : Math.max(x1, x2) + 28;
  const d = `M ${x1} ${a.y + a.h / 2} C ${side} ${a.y + a.h / 2}, ${side} ${b.y + b.h / 2}, ${b.x + (x1 <= x2 ? 0 : b.w)} ${b.y + b.h / 2}`;
  return { d, lx: side, ly: (a.y + b.y + a.h) / 2 };
}

function selfPath(p) {
  const x = p.x + p.w - 6;
  const y1 = p.y + 18;
  const y2 = p.y + p.h - 18;
  const cx = p.x + p.w + 34;
  return {
    d: `M ${x} ${y1} C ${cx} ${y1}, ${cx} ${y2}, ${x} ${y2}`,
    lx: cx,
    ly: (y1 + y2) / 2,
  };
}

function renderChart(ivr) {
  const graph = buildGraph(ivr);
  const { pos, width, height } = layout(graph);
  const host = document.getElementById("chart");
  const nodesHtml = [...graph.nodes.values()]
    .map((n) => {
      const p = pos[n.id];
      if (!p) return "";
      return `<div class="chart-node ${esc(n.kind)}" style="left:${p.x}px;top:${p.y}px;width:${p.w}px;height:${p.h}px">
        <div class="k">${esc(n.k)}</div>
        <div class="t">${esc(n.t)}</div>
        <div class="s">${esc(n.s)}</div>
      </div>`;
    })
    .join("");
  const paths = [];
  const labels = [];
  graph.edges.forEach((e, i) => {
    const a = pos[e.from];
    const b = pos[e.to];
    if (!a || !b) return;
    const curve = e.from === e.to ? selfPath(a) : elbow(a, b);
    const color = e.fail ? "#c0392b" : "#1560b5";
    paths.push(`<path d="${curve.d}" fill="none" stroke="${color}" stroke-width="2" marker-end="url(#arr-${e.fail ? "f" : "ok"})" />`);
    labels.push(
      `<div class="edge-label${e.fail ? " fail" : ""}" style="left:${curve.lx}px;top:${curve.ly}px">${esc(e.label)}</div>`,
    );
  });
  host.style.width = "auto";
  host.innerHTML = `<div style="position:relative;width:${width}px;height:${height}px">
    <svg class="wires" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
      <defs>
        <marker id="arr-ok" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#1560b5" />
        </marker>
        <marker id="arr-f" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#c0392b" />
        </marker>
      </defs>
      ${paths.join("")}
    </svg>
    ${nodesHtml}${labels.join("")}
  </div>`;
}

async function boot() {
  const id = Number(new URLSearchParams(location.search).get("id"));
  if (!id) {
    document.getElementById("title").textContent = "No IVR selected";
    document.getElementById("chart").innerHTML = `<p class="muted" style="padding:24px">Open this page from IVRs → Flow.</p>`;
    return;
  }
  const res = await api(`/v1/ivrs/${id}`);
  if (!res.ok) {
    document.getElementById("title").textContent = "IVR not found";
    return;
  }
  const ivr = await res.json();
  document.title = `${ivr.name} — flow`;
  document.getElementById("title").textContent = ivr.name;
  document.getElementById("edit-link").href = `/ivrs?edit=${ivr.id}`;
  renderChart(ivr);
}

document.getElementById("print").addEventListener("click", () => window.print());
boot().catch(() => {});
