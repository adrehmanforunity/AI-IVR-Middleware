(function () {
  const meta = document.querySelector('meta[name="csrf-token"]');
  window.__IIM_CSRF = meta && meta.getAttribute("content") ? meta.getAttribute("content") : "";
  const rawFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    const opts = init ? { ...init } : {};
    const method = String(opts.method || "GET").toUpperCase();
    if (["POST", "PUT", "PATCH", "DELETE"].indexOf(method) !== -1 && window.__IIM_CSRF) {
      const headers = new Headers(opts.headers || {});
      if (!headers.has("X-CSRF-Token")) headers.set("X-CSRF-Token", window.__IIM_CSRF);
      opts.headers = headers;
      if (!opts.credentials) opts.credentials = "same-origin";
    }
    return rawFetch(input, opts);
  };
})();
