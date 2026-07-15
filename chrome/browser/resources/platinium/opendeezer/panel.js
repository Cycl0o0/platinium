/*
 * Platinium by Cycl0o0 — OpenDeezer native player (side panel logic)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * This file is part of the Platinium browser project.
 * Platinium is free software: you can redistribute it and/or modify it under
 * the terms of the GNU Affero General Public License as published by the
 * Free Software Foundation, either version 3 of the License, or (at your
 * option) any later version. See <https://www.gnu.org/licenses/agpl-3.0.html>.
 *
 * Talks to the OpenDeezer SDK control server (default http://127.0.0.1:7654).
 * Prefers the SSE /events stream (via streaming fetch, so the Authorization
 * header works); falls back to polling GET /status every second.
 */

"use strict";

const DEFAULTS = {
  baseUrl: "http://127.0.0.1:7654",
  token: "",
};

const els = {
  offline: document.getElementById("offline"),
  art: document.getElementById("art"),
  title: document.getElementById("title"),
  artist: document.getElementById("artist"),
  album: document.getElementById("album"),
  pos: document.getElementById("pos"),
  dur: document.getElementById("dur"),
  seek: document.getElementById("seek"),
  playpause: document.getElementById("playpause"),
  prev: document.getElementById("prev"),
  next: document.getElementById("next"),
  repeat: document.getElementById("repeat"),
  shuffle: document.getElementById("shuffle"),
  volume: document.getElementById("volume"),
  searchForm: document.getElementById("search-form"),
  searchInput: document.getElementById("search-input"),
  results: document.getElementById("results"),
};

let cfg = { ...DEFAULTS };
let lastState = null;
let lastStateAt = 0;
let seeking = false;
let volDragging = false;
let sseActive = false;
let sseAbort = null;
let volTimer = null;

/* ---------------------------------------------------------------- helpers */

function baseUrl() {
  return (cfg.baseUrl || DEFAULTS.baseUrl).replace(/\/+$/, "");
}

function authHeaders() {
  return cfg.token ? { Authorization: "Bearer " + cfg.token } : {};
}

let lastErrorStatus = 0;

async function api(path, opts = {}) {
  const res = await fetch(baseUrl() + path, {
    ...opts,
    headers: { ...(opts.headers || {}), ...authHeaders() },
  });
  if (!res.ok) {
    lastErrorStatus = res.status;
    throw new Error("HTTP " + res.status);
  }
  lastErrorStatus = 0;
  return res;
}

async function getJSON(path) {
  return (await api(path)).json();
}

async function post(path, body) {
  const opts = { method: "POST" };
  if (body !== undefined) {
    opts.headers = { "Content-Type": "application/json" };
    opts.body = JSON.stringify(body);
  }
  await api(path, opts);
  if (!sseActive) poll(); // snappy UI refresh when not on the event stream
}

function fmt(ms) {
  if (!Number.isFinite(ms) || ms < 0) ms = 0;
  const s = Math.floor(ms / 1000);
  return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
}

function setOnline(ok) {
  els.offline.classList.toggle("hidden", ok);
  for (const b of [els.playpause, els.prev, els.next, els.repeat, els.shuffle]) {
    b.disabled = !ok;
  }
  if (!ok) {
    if (lastErrorStatus === 401 || lastErrorStatus === 403) {
      els.title.textContent = "OpenDeezer: unauthorized (" + lastErrorStatus + ")";
      els.artist.textContent = "Set the control token in Settings";
    } else {
      els.title.textContent = "OpenDeezer offline";
      els.artist.textContent = "Check Settings / the tunnel to :7654";
    }
    els.album.textContent = " ";
  }
}

/* ----------------------------------------------------------------- render */

function render(state) {
  if (!state || typeof state !== "object") return;
  lastState = state;
  lastStateAt = Date.now();
  setOnline(true);

  const t = state.track || {};
  els.title.textContent = t.title || "Nothing playing";
  els.artist.textContent = t.artist || " ";
  els.album.textContent = t.album || " ";

  els.playpause.innerHTML = state.state === "playing" ? "&#9208;" : "&#9654;";

  if (!seeking) {
    els.seek.max = t.durationMS || 0;
    els.seek.value = t.positionMS || 0;
    els.pos.textContent = fmt(t.positionMS);
  }
  els.dur.textContent = fmt(t.durationMS);

  if (!volDragging && typeof state.volume === "number") {
    els.volume.value = Math.round(state.volume * 100);
  }

  const mode = state.repeat || "off";
  els.repeat.dataset.mode = mode;
  els.repeat.classList.toggle("on", mode !== "off");
  els.repeat.title = "Repeat: " + mode;
  els.repeat.innerHTML = mode === "one" ? "&#128258;" : "&#128257;";

  els.shuffle.classList.toggle("on", !!state.shuffle);
}

// Smooth progress between server updates while playing.
setInterval(() => {
  if (!lastState || lastState.state !== "playing" || seeking) return;
  const t = lastState.track || {};
  const extrapolated = Math.min(
    (t.positionMS || 0) + (Date.now() - lastStateAt),
    t.durationMS || Infinity
  );
  els.seek.value = extrapolated;
  els.pos.textContent = fmt(extrapolated);
}, 250);

/* ------------------------------------------------- status: SSE + polling */

async function poll() {
  if (sseActive) return;
  try {
    render(await getJSON("/status"));
  } catch (_) {
    setOnline(false);
  }
}

async function startSSE() {
  if (sseActive) return;
  const ctrl = new AbortController();
  sseAbort = ctrl;
  try {
    // fetch-based SSE so the Authorization header is sent (EventSource can't).
    const res = await fetch(baseUrl() + "/events", {
      headers: { Accept: "text/event-stream", ...authHeaders() },
      signal: ctrl.signal,
    });
    if (!res.ok || !res.body) throw new Error("SSE unavailable");
    sseActive = true;

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let sep;
      while ((sep = buf.indexOf("\n\n")) >= 0) {
        const event = buf.slice(0, sep);
        buf = buf.slice(sep + 2);
        const data = event
          .split("\n")
          .filter((l) => l.startsWith("data:"))
          .map((l) => l.slice(5).trim())
          .join("\n");
        if (data) {
          try {
            render(JSON.parse(data));
          } catch (_) {
            /* ignore malformed frames */
          }
        }
      }
    }
  } catch (_) {
    /* stream refused or dropped — polling covers us */
  } finally {
    sseActive = false;
  }
}

function restartStream() {
  if (sseAbort) sseAbort.abort();
  startSSE();
  poll();
}

setInterval(poll, 1000); // 1s polling whenever the stream isn't live
setInterval(startSSE, 10000); // periodically retry the stream

/* --------------------------------------------------------------- controls */

els.playpause.addEventListener("click", () => post("/playpause").catch(() => setOnline(false)));
els.prev.addEventListener("click", () => post("/previous").catch(() => setOnline(false)));
els.next.addEventListener("click", () => post("/next").catch(() => setOnline(false)));

els.repeat.addEventListener("click", () => {
  const order = { off: "all", all: "one", one: "off" };
  const next = order[els.repeat.dataset.mode] || "off";
  post("/repeat", { mode: next }).catch(() => setOnline(false));
});

els.shuffle.addEventListener("click", () => {
  const on = !(lastState && lastState.shuffle);
  post("/shuffle", { on }).catch(() => setOnline(false));
});

els.seek.addEventListener("input", () => {
  seeking = true;
  els.pos.textContent = fmt(Number(els.seek.value));
});
els.seek.addEventListener("change", () => {
  const ms = Math.round(Number(els.seek.value));
  post("/seek", { ms })
    .catch(() => setOnline(false))
    .finally(() => {
      seeking = false;
    });
});

els.volume.addEventListener("pointerdown", () => {
  volDragging = true;
});
els.volume.addEventListener("pointerup", () => {
  volDragging = false;
});
els.volume.addEventListener("input", () => {
  clearTimeout(volTimer);
  volTimer = setTimeout(() => {
    post("/volume", { volume: Number(els.volume.value) / 100 }).catch(() =>
      setOnline(false)
    );
  }, 150);
});

/* ----------------------------------------------------------------- search */

els.searchForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const q = els.searchInput.value.trim();
  if (!q) return;
  els.results.replaceChildren(makeEmptyRow("Searching…"));
  try {
    const data = await getJSON("/search?q=" + encodeURIComponent(q));
    renderResults(Array.isArray(data.tracks) ? data.tracks : []);
  } catch (_) {
    els.results.replaceChildren(makeEmptyRow("Search failed — is OpenDeezer up?"));
  }
});

function makeEmptyRow(text) {
  const li = document.createElement("li");
  li.className = "r-empty";
  li.textContent = text;
  return li;
}

function renderResults(tracks) {
  if (!tracks.length) {
    els.results.replaceChildren(makeEmptyRow("No results."));
    return;
  }
  els.results.replaceChildren(
    ...tracks.map((tr) => {
      const li = document.createElement("li");
      li.title = "Play this track";

      const title = document.createElement("span");
      title.className = "r-title";
      title.textContent = tr.title || "Untitled";

      const sub = document.createElement("span");
      sub.className = "r-sub";
      sub.textContent = [tr.artist, tr.album].filter(Boolean).join(" · ");

      li.append(title, sub);
      li.addEventListener("click", () =>
        post("/play", { trackId: tr.id }).catch(() => setOnline(false))
      );
      return li;
    })
  );
}

/* ------------------------------------------------------------------- init */

chrome.storage.local.get(DEFAULTS, (stored) => {
  cfg = { ...DEFAULTS, ...stored };
  restartStream();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.baseUrl) cfg.baseUrl = changes.baseUrl.newValue || DEFAULTS.baseUrl;
  if (changes.token) cfg.token = changes.token.newValue || "";
  restartStream();
});
