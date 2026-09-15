(function (global) {
  const ICONS = {
    activity:
      '<path d="M3 12h4l3 8 4-16 3 8h4" />',
    "alert-triangle":
      '<path d="M12 9v4" /><path d="M12 16v.01" /><path d="M3.4 19h17.2a2 2 0 0 0 1.73-3L13.73 4a2 2 0 0 0-3.46 0L1.67 16a2 2 0 0 0 1.73 3" />',
    api: '<path d="M4 13h5" /><path d="M15 13h5" /><path d="M9 13v-3a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v3" /><path d="M7 17h10" /><path d="M12 17v4" /><path d="M8 4v3" /><path d="M16 4v3" />',
    "arrow-down": '<path d="M12 5v14" /><path d="M18 13l-6 6" /><path d="M6 13l6 6" />',
    bell: '<path d="M10 5a2 2 0 1 1 4 0 7 7 0 0 1 4 6v3a4 4 0 0 0 2 3H4a4 4 0 0 0 2-3v-3a7 7 0 0 1 4-6" /><path d="M9 17v1a3 3 0 0 0 6 0v-1" />',
    cpu: '<path d="M5 6a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1z" /><path d="M9 9h6v6H9z" /><path d="M3 10h2" /><path d="M3 14h2" /><path d="M19 10h2" /><path d="M19 14h2" /><path d="M10 3v2" /><path d="M14 3v2" /><path d="M10 19v2" /><path d="M14 19v2" />',
    database:
      '<ellipse cx="12" cy="6" rx="8" ry="3" /><path d="M4 6v6c0 1.66 3.58 3 8 3s8-1.34 8-3V6" /><path d="M4 12v6c0 1.66 3.58 3 8 3s8-1.34 8-3v-6" />',
    download:
      '<path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" /><path d="M7 11l5 5 5-5" /><path d="M12 4v12" />',
    function:
      '<path d="M4 8h8" /><path d="M8 4v8" /><path d="M14 8.5a2.5 2.5 0 1 1 5 0c0 .8-.5 1.5-2 2.5s-2 1.7-2 2.5a2.5 2.5 0 1 0 5 0" />',
    git: '<circle cx="6" cy="6" r="2" /><circle cx="6" cy="18" r="2" /><circle cx="18" cy="12" r="2" /><path d="M6 8v8" /><path d="M8 6h4a4 4 0 0 1 4 4" />',
    headphones:
      '<path d="M4 15v-3a8 8 0 1 1 16 0v3" /><path d="M18 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3z" /><path d="M4 15a2 2 0 0 1 2-2h1a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />',
    "layout-dashboard":
      '<path d="M4 5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v5H4z" /><path d="M14 5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3h-6z" /><path d="M4 14h6v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z" /><path d="M14 12h6v7a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1z" />',
    lock: '<path d="M8 10V7a4 4 0 1 1 8 0v3" /><rect x="5" y="10" width="14" height="10" rx="2" />',
    logout: '<path d="M14 8V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h7a2 2 0 0 0 2-2v-2" /><path d="M9 12h12" /><path d="M16 9l5 3-5 3" />',
    mail: '<path d="M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><path d="M3 7l9 6 9-6" />',
    "message-2":
      '<path d="M8 9h8" /><path d="M8 13h6" /><path d="M5 4h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9l-5 3v-3H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2" />',
    phone:
      '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L16 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2" />',
    "phone-incoming":
      '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L16 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2" /><path d="M15 5l5 0" /><path d="M15 5v5" /><path d="M20 5l-5 5" />',
    "phone-outgoing":
      '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L16 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2" /><path d="M15 9l5-5" /><path d="M16 4h4v4" />',
    "phone-call":
      '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L16 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2" /><path d="M15 6a3.5 3.5 0 0 1 4 4" /><path d="M15 3a7 7 0 0 1 7 7" />',
    plug: '<path d="M7 8h10v6a5 5 0 0 1-10 0z" /><path d="M9 8V3" /><path d="M15 8V3" /><path d="M12 14v7" />',
    route: '<circle cx="6" cy="19" r="2" /><circle cx="18" cy="5" r="2" /><path d="M12 19h4.5a3.5 3.5 0 0 0 0-7h-7a3.5 3.5 0 0 1 0-7H12" />',
    server:
      '<rect x="3" y="4" width="18" height="8" rx="2" /><rect x="3" y="12" width="18" height="8" rx="2" /><path d="M7 8h.01" /><path d="M7 16h.01" />',
    settings:
      '<path d="M10.3 6.2 9 3.5 7.7 6.2a2 2 0 0 1-1.8 1.2H3l1.8 1.4a2 2 0 0 1 .7 2.2L4.3 14 7 13.2a2 2 0 0 1 2.2.7L10.6 16l1.4-2.1a2 2 0 0 1 2.2-.7L16.9 14l-1.2-2.9a2 2 0 0 1 .7-2.2L18.2 7.5h-2.9a2 2 0 0 1-1.8-1.3z" /><circle cx="12" cy="12" r="2" />',
    "chart-bar":
      '<path d="M3 20h18" /><path d="M7 16v-6" /><path d="M12 16V8" /><path d="M17 16v-3" />',
    "device-desktop":
      '<rect x="3" y="4" width="18" height="12" rx="1" /><path d="M7 20h10" /><path d="M9 16v4" /><path d="M15 16v4" />',
    "heart-rate":
      '<path d="M3 12h4l2-5 3 10 2-5h7" />',
    clock: '<circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 3" />',
    users: '<circle cx="9" cy="8" r="3" /><path d="M3 19a6 6 0 0 1 12 0" /><circle cx="17" cy="8" r="2" /><path d="M17 14a5 5 0 0 1 4 5" />',
    "circle-check":
      '<circle cx="12" cy="12" r="9" /><path d="M9 12l2 2 4-4" />',
    "circle-x": '<circle cx="12" cy="12" r="9" /><path d="M10 10l4 4" /><path d="M14 10l-4 4" />',
    "hard-drive":
      '<path d="M4 17a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7H4z" /><path d="M4 13h16" /><path d="M16 17h.01" />',
    "memory":
      '<rect x="4" y="6" width="16" height="12" rx="1" /><path d="M8 6V4" /><path d="M12 6V4" /><path d="M16 6V4" /><path d="M8 20v-2" /><path d="M12 20v-2" /><path d="M16 20v-2" /><path d="M6 12h12" />',
    terminal:
      '<path d="M5 7l5 5-5 5" /><path d="M12 17h7" /><rect x="3" y="4" width="18" height="16" rx="2" />',
    maximize:
      '<path d="M4 9V4h5" /><path d="M20 9V4h-5" /><path d="M4 15v5h5" /><path d="M20 15v5h-5" />',
    minimize:
      '<path d="M9 4H4v5" /><path d="M15 4h5v5" /><path d="M9 20H4v-5" /><path d="M15 20h5v-5" />',
  };

  function icon(name, cls) {
    const inner = ICONS[name];
    if (!inner) return "";
    return `<svg xmlns="http://www.w3.org/2000/svg" class="icon ${cls || ""}" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
  }

  global.iimIcon = icon;
})(window);
