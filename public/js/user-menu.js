function passwordModalHtml() {
  return `<div class="modal-back" id="pw-modal">
    <div class="modal-card">
      <h3>Change password</h3>
      <p class="muted">Stored hashed in SQLite. Env seeds the first user only.</p>
      <form id="pw-form">
        <label for="pw-current">Current</label>
        <input id="pw-current" type="password" required autocomplete="current-password" />
        <label for="pw-next">New</label>
        <input id="pw-next" type="password" minlength="8" required autocomplete="new-password" />
        <p class="muted" id="pw-msg"></p>
        <div class="modal-actions">
          <button class="btn ghost" type="button" id="pw-cancel">Cancel</button>
          <button class="btn" type="submit">Save</button>
        </div>
      </form>
    </div>
  </div>`;
}

function openPasswordModal() {
  if (document.getElementById("pw-modal")) return;
  document.body.insertAdjacentHTML("beforeend", passwordModalHtml());
  const wrap = document.getElementById("pw-modal");
  const close = () => wrap.remove();
  wrap.addEventListener("click", (e) => {
    if (e.target === wrap) close();
  });
  document.getElementById("pw-cancel").addEventListener("click", close);
  document.getElementById("pw-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = document.getElementById("pw-msg");
    const res = await fetch("/auth/password", {
      method: "PUT",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        currentPassword: document.getElementById("pw-current").value,
        newPassword: document.getElementById("pw-next").value,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) {
      window.location.href = "/";
      return;
    }
    if (!res.ok) {
      msg.textContent = data.error || "Could not change password";
      return;
    }
    window.location.href = "/";
  });
}

function placeDrop(btn, drop) {
  const r = btn.getBoundingClientRect();
  drop.style.top = `${Math.round(r.bottom + 8)}px`;
  drop.style.right = `${Math.round(window.innerWidth - r.right)}px`;
  drop.style.left = "auto";
}

function bindUserMenu() {
  const openPw = document.getElementById("open-password");
  if (openPw) {
    openPw.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      openPasswordModal();
    });
  }

  const btn = document.getElementById("user-menu-btn");
  const drop = document.getElementById("user-menu-drop");
  if (!btn || !drop || btn.getAttribute("data-bs-toggle") === "dropdown") return;

  drop.removeAttribute("hidden");
  document.body.appendChild(drop);

  const isOpen = () => drop.classList.contains("open");

  const closeMenu = () => {
    drop.classList.remove("open");
    btn.setAttribute("aria-expanded", "false");
  };

  const openMenu = () => {
    placeDrop(btn, drop);
    drop.classList.add("open");
    btn.setAttribute("aria-expanded", "true");
  };

  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (isOpen()) closeMenu();
    else openMenu();
  });

  document.addEventListener("click", (e) => {
    if (btn.contains(e.target) || drop.contains(e.target)) return;
    closeMenu();
  });

  window.addEventListener("resize", () => {
    if (isOpen()) placeDrop(btn, drop);
  });
}

const DEFAULT_PULSE_SWAGGER = "https://petstore.swagger.io/";

function bindPulseSwaggerLink() {
  const a = document.getElementById("pulse-swagger");
  if (!a) return;
  fetch("/v1/config/settings", { credentials: "same-origin" })
    .then((res) => (res.ok ? res.json() : {}))
    .then((settings) => {
      const url = String(settings.pulse_swagger_url || DEFAULT_PULSE_SWAGGER).trim();
      if (/^https?:\/\//i.test(url)) {
        a.href = url;
        a.removeAttribute("hidden");
      } else {
        a.setAttribute("hidden", "");
      }
    })
    .catch(() => {});
}

function bindLogout() {
  const logout = document.getElementById("logout");
  if (!logout || logout.dataset.bound) return;
  logout.dataset.bound = "1";
  logout.addEventListener("click", async () => {
    await fetch("/auth/logout", { method: "POST", credentials: "same-origin" });
    window.location.href = "/";
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    bindUserMenu();
    bindPulseSwaggerLink();
    bindLogout();
  });
} else {
  bindUserMenu();
  bindPulseSwaggerLink();
  bindLogout();
}
