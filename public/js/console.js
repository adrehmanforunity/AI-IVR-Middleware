(function () {
  const CAP = 250;
  const pane = document.getElementById("pane");
  const status = document.getElementById("status");
  const pauseBtn = document.getElementById("pause");
  const followEl = document.getElementById("follow");

  let lines = [];
  let paused = false;
  let skipped = 0;
  let dropped = 0;
  let es = null;
  let paintQueued = false;

  function paint() {
    paintQueued = false;
    pane.textContent = lines.join("\n");
    if (!paused && followEl.checked) pane.scrollTop = pane.scrollHeight;
    const bits = [];
    if (skipped) bits.push(`paused-skip ${skipped}`);
    if (dropped) bits.push(`server-drop ${dropped}`);
    const extra = bits.length ? ` · ${bits.join(" · ")}` : "";
    const mode = paused ? "Paused (stream off)" : es ? "Live" : "Disconnected";
    status.textContent = `${mode} · ${lines.length}/${CAP} lines${extra}`;
  }

  function schedulePaint() {
    if (paintQueued) return;
    paintQueued = true;
    requestAnimationFrame(paint);
  }

  function applyLines(next, extraDrop) {
    if (extraDrop) dropped += extraDrop;
    if (!next || !next.length) {
      schedulePaint();
      return;
    }
    for (let i = 0; i < next.length; i++) lines.push(next[i]);
    if (lines.length > CAP) lines = lines.slice(lines.length - CAP);
    schedulePaint();
  }

  function connect() {
    if (es) {
      es.close();
      es = null;
    }
    es = new EventSource("/v1/console/stream", { withCredentials: true });
    es.onerror = () => {
      if (paused) return;
      if (es && es.readyState === EventSource.CLOSED) {
        status.textContent = "Disconnected — refresh if this stays";
      }
    };
    es.onmessage = (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (msg.t === "snap" && Array.isArray(msg.lines)) {
        lines = msg.lines.slice(-CAP);
        schedulePaint();
        return;
      }
      if (msg.t === "batch") applyLines(msg.lines, msg.dropped || 0);
    };
  }

  function disconnect() {
    if (es) {
      es.close();
      es = null;
    }
  }

  pauseBtn.addEventListener("click", () => {
    paused = !paused;
    pauseBtn.textContent = paused ? "Resume" : "Pause";
    if (paused) {
      disconnect();
      skipped = 0;
      paint();
      return;
    }
    dropped = 0;
    connect();
  });

  document.getElementById("copy").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      status.textContent = `Copied ${lines.length} lines`;
    } catch {
      status.textContent = "Copy failed";
    }
  });

  document.getElementById("save").addEventListener("click", () => {
    const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" });
    const a = document.createElement("a");
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    a.href = URL.createObjectURL(blob);
    a.download = `iim-console-${stamp}.log`;
    a.click();
    URL.revokeObjectURL(a.href);
  });

  document.getElementById("clear").addEventListener("click", () => {
    lines = [];
    skipped = 0;
    dropped = 0;
    paint();
  });

  const expandBtn = document.getElementById("expand");
  expandBtn.addEventListener("click", () => {
    const on = document.body.classList.toggle("console-fill");
    expandBtn.textContent = on ? "Exit expand" : "Expand";
    schedulePaint();
  });

  const fsBtn = document.getElementById("fullscreen");
  const card = document.getElementById("console-card");
  function fsEl() {
    return document.fullscreenElement || document.webkitFullscreenElement;
  }
  function syncFsLabel() {
    fsBtn.textContent = fsEl() ? "Exit full screen" : "Full screen";
  }
  fsBtn.addEventListener("click", async () => {
    try {
      if (fsEl()) {
        if (document.exitFullscreen) await document.exitFullscreen();
        else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
      } else if (card.requestFullscreen) {
        await card.requestFullscreen();
      } else if (card.webkitRequestFullscreen) {
        card.webkitRequestFullscreen();
      }
    } catch {
      status.textContent = "Full screen not available";
    }
    syncFsLabel();
    schedulePaint();
  });
  document.addEventListener("fullscreenchange", syncFsLabel);
  document.addEventListener("webkitfullscreenchange", syncFsLabel);

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && document.body.classList.contains("console-fill")) {
      document.body.classList.remove("console-fill");
      expandBtn.textContent = "Expand";
    }
  });

  window.addEventListener("pagehide", disconnect);
  connect();
})();
