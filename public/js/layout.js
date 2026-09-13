(function () {
  const icon = window.iimIcon || function () { return ""; };
  const active = document.body.getAttribute("data-nav") || "";

  function item(href, label, iconName, opts) {
    const id = opts && opts.id ? ` id="${opts.id}"` : "";
    const blank = opts && opts.blank ? ' target="_blank" rel="noopener"' : "";
    const on = href === active ? " active" : "";
    return `<li class="nav-item"><a class="nav-link${on}" href="${href}"${id}${blank}><span class="nav-link-icon">${icon(iconName)}</span><span class="nav-link-title">${label}</span></a></li>`;
  }

  const side = document.getElementById("iim-sidebar");
  if (side) {
    side.innerHTML = `
      <button class="navbar-toggler" type="button" data-bs-toggle="collapse" data-bs-target="#sidebar-menu" aria-controls="sidebar-menu" aria-expanded="false" aria-label="Toggle navigation">
        <span class="navbar-toggler-icon"></span>
      </button>
      <h1 class="navbar-brand navbar-brand-autodark">
        <a href="/app">${icon("activity")} IIM</a>
      </h1>
      <div class="collapse navbar-collapse" id="sidebar-menu">
        <ul class="navbar-nav pt-lg-3">
          <li class="nav-item"><span class="nav-link disabled">Monitoring</span></li>
          ${item("/app", "Live dashboard", "layout-dashboard")}
          ${item("/stations", "IIM stations", "headphones")}
          ${item("/logs", "Download logs", "download")}
          ${item("/docs", "IIM Swagger", "api", { blank: true })}
          ${item("https://petstore.swagger.io/", "PULSE Swagger", "heart-rate", { id: "pulse-swagger", blank: true })}
          <li class="nav-item mt-2"><span class="nav-link disabled">Management</span></li>
          ${item("/setups", "Inbound routing", "phone-incoming")}
          ${item("/outbound", "Outbound routing", "phone-outgoing")}
          ${item("/ivrs", "IVRs", "git")}
          ${item("/functions", "IVR functions", "function")}
          ${item("/telephony", "Telephony Setup", "phone")}
          ${item("/pulse", "PULSE API End Point Setup", "plug")}
          ${item("/alerts", "Alert mail (SMTP)", "mail")}
        </ul>
      </div>`;
  }

  const top = document.getElementById("iim-top");
  if (top) {
    top.innerHTML = `
      <header class="navbar navbar-expand-md d-print-none">
        <div class="container-xl">
          <button class="navbar-toggler d-lg-none" type="button" data-bs-toggle="collapse" data-bs-target="#sidebar-menu" aria-controls="sidebar-menu" aria-expanded="false" aria-label="Toggle navigation">
            <span class="navbar-toggler-icon"></span>
          </button>
          <div class="navbar-nav flex-row order-md-last ms-auto align-items-center">
            <div class="nav-item dropdown">
              <a href="#" class="nav-link d-flex lh-1 p-0" data-bs-toggle="dropdown" id="user-menu-btn" aria-expanded="false">
                <span class="avatar avatar-sm" id="avatar">S</span>
                <div class="d-none d-md-block ps-2">
                  <div id="who">Super</div>
                </div>
              </a>
              <div class="dropdown-menu dropdown-menu-end" id="user-menu-drop">
                <button class="dropdown-item" type="button" id="open-password">${icon("lock")} Change password</button>
                <button class="dropdown-item" type="button" id="logout">${icon("logout")} Logout</button>
              </div>
            </div>
          </div>
        </div>
      </header>`;
  }

  document.querySelectorAll("[data-icon]").forEach((el) => {
    const name = el.getAttribute("data-icon");
    el.innerHTML = icon(name);
  });
})();
