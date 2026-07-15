/*
 * Platinium by Cycl0o0 — OpenDeezer native player (service worker)
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * This file is part of the Platinium browser project.
 * Platinium is free software: you can redistribute it and/or modify it under
 * the terms of the GNU Affero General Public License as published by the
 * Free Software Foundation, either version 3 of the License, or (at your
 * option) any later version. See <https://www.gnu.org/licenses/agpl-3.0.html>.
 */

"use strict";

// Clicking the toolbar action opens the side panel.
function enablePanelOnAction() {
  if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
    chrome.sidePanel
      .setPanelBehavior({ openPanelOnActionClick: true })
      .catch((err) => console.warn("[Platinium OpenDeezer]", err));
  }
}

chrome.runtime.onInstalled.addListener(enablePanelOnAction);
chrome.runtime.onStartup.addListener(enablePanelOnAction);
enablePanelOnAction();
