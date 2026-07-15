/*
 * Platinium by Cycl0o0 — OpenDeezer native player (options logic)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * This file is part of the Platinium browser project.
 * Platinium is free software: you can redistribute it and/or modify it under
 * the terms of the GNU Affero General Public License as published by the
 * Free Software Foundation, either version 3 of the License, or (at your
 * option) any later version. See <https://www.gnu.org/licenses/agpl-3.0.html>.
 */

"use strict";

const DEFAULTS = {
  baseUrl: "http://127.0.0.1:7654",
  token: "",
};

const baseUrlEl = document.getElementById("baseUrl");
const tokenEl = document.getElementById("token");
const feedbackEl = document.getElementById("feedback");

function say(msg, ok) {
  feedbackEl.textContent = msg;
  feedbackEl.className = ok ? "ok" : "err";
}

function currentValues() {
  return {
    baseUrl: (baseUrlEl.value.trim() || DEFAULTS.baseUrl).replace(/\/+$/, ""),
    token: tokenEl.value.trim(),
  };
}

// Localhost is covered by the manifest's host_permissions. Any other host is
// covered by optional_host_permissions and must be granted at runtime, so the
// extension stays portable (no per-user hosts baked into the manifest).
function isLocalhost(url) {
  try {
    const h = new URL(url).hostname;
    return h === "127.0.0.1" || h === "localhost" || h === "[::1]";
  } catch (_) {
    return false;
  }
}

function ensureHostPermission(baseUrl) {
  return new Promise((resolve) => {
    if (isLocalhost(baseUrl)) return resolve(true);
    const origin = new URL(baseUrl).origin + "/*";
    chrome.permissions.contains({ origins: [origin] }, (has) => {
      if (has) return resolve(true);
      chrome.permissions.request({ origins: [origin] }, (granted) => resolve(granted));
    });
  });
}

chrome.storage.sync.get(DEFAULTS, (stored) => {
  baseUrlEl.value = stored.baseUrl || DEFAULTS.baseUrl;
  tokenEl.value = stored.token || "";
});

document.getElementById("save").addEventListener("click", async () => {
  const values = currentValues();
  const granted = await ensureHostPermission(values.baseUrl);
  if (!granted) {
    return say("Host permission denied for " + values.baseUrl + " — not saved.", false);
  }
  chrome.storage.sync.set(values, () => say("Saved.", true));
});

document.getElementById("test").addEventListener("click", async () => {
  const { baseUrl, token } = currentValues();
  say("Testing…", true);
  const granted = await ensureHostPermission(baseUrl);
  if (!granted) return say("Host permission denied for " + baseUrl + ".", false);
  try {
    const res = await fetch(baseUrl + "/status", {
      headers: token ? { Authorization: "Bearer " + token } : {},
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const s = await res.json();
    const now = s.track && s.track.title ? " — now: " + s.track.title : "";
    say("Connected (" + (s.state || "ok") + ")" + now, true);
  } catch (err) {
    say(
      "OpenDeezer offline or unreachable (" + err.message + "). " +
        "Check that the control API is running and the URL/token are correct.",
      false
    );
  }
});
