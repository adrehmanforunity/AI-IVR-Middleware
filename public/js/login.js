const form = document.getElementById("login-form");
const errorEl = document.getElementById("error");
const submit = document.getElementById("submit");

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  errorEl.textContent = "";
  submit.disabled = true;
  try {
    const res = await fetch("/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({
        username: document.getElementById("username").value.trim(),
        password: document.getElementById("password").value,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (res.status === 429) {
        errorEl.textContent = "Too many sign-in attempts. Try again in 15 minutes.";
        return;
      }
      errorEl.textContent = data.error === "invalid credentials" ? "Invalid user name or password" : "Sign in failed";
      return;
    }
    window.location.href = "/app";
  } catch {
    errorEl.textContent = "Cannot reach IIM";
  } finally {
    submit.disabled = false;
  }
});
