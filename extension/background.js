// Mynx extension background service worker.
// Bridges UI scripts to the Mynx desktop app via native messaging.
// No credentials are stored here; only the desktop holds the vault.

const NATIVE_HOST_NAME = "com.matt.mynx.native";
const NATIVE_TIMEOUT_MS = 5000;
// Pairing ждёт клика пользователя в десктопном приложении (сервер даёт 60с).
const PAIR_TIMEOUT_MS = 65000;
const STATUS_CACHE_MS = 10000;
const CLIENT_NAME = "Mynx Browser Extension";

let statusCache = null; // { data: { unlocked, running }, at: number }
let pairKey = null; // ключ доверенного клиента, живёт в chrome.storage.session

chrome.storage.session.get("pairKey", (r) => {
  pairKey = (r && r.pairKey) || null;
});

// Send a message to the native host with a hard timeout.
function sendNativeRaw(msg, timeoutMs) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error("Native host timeout"));
      }
    }, timeoutMs || NATIVE_TIMEOUT_MS);

    chrome.runtime.sendNativeMessage(NATIVE_HOST_NAME, msg, (response) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);

      const err = chrome.runtime.lastError;
      if (err) {
        reject(new Error(err.message || "Native host error"));
        return;
      }
      if (!response) {
        reject(new Error("No response from native host"));
        return;
      }
      if (response.success === false) {
        reject(new Error(response.error || "Unknown native error"));
        return;
      }
      resolve(response.data !== undefined ? response.data : response);
    });
  });
}

// Ask the user to confirm the connection in the desktop app.
function notifyPairing() {
  chrome.notifications.create("mynx-pairing", {
    type: "basic",
    iconUrl: "icons/icon128.png",
    title: "Mynx",
    message: "Confirm access in the Mynx desktop app.",
  });
}

function clearPairingNotification() {
  chrome.notifications.clear("mynx-pairing");
}

// Attach pairing key; on "pairing_required" run the pairing flow
// (user confirms in the desktop app) and retry the original request once.
async function sendNative(msg) {
  const attach = (m) => ({
    ...m,
    client: CLIENT_NAME,
    ...(pairKey ? { key: pairKey } : {}),
  });

  let data = await sendNativeRaw(attach(msg));
  if (data && data.error === "pairing_required") {
    pairKey = null;
    notifyPairing();
    try {
      const pairData = await sendNativeRaw(
        { type: "pair", client: CLIENT_NAME },
        PAIR_TIMEOUT_MS
      );
      if (pairData && pairData.success !== false && pairData.key) {
        pairKey = pairData.key;
        chrome.storage.session.set({ pairKey });
        data = await sendNativeRaw(attach(msg));
      }
    } finally {
      clearPairingNotification();
    }
  }
  return data;
}

// Query desktop status; vault_locked data error still means the host is alive.
async function getStatus(forceRefresh) {
  if (!forceRefresh && statusCache && Date.now() - statusCache.at < STATUS_CACHE_MS) {
    return statusCache.data;
  }
  let data;
  try {
    const res = await sendNative({ type: "status" });
    data = { running: true, unlocked: !!(res && res.unlocked) };
  } catch (e) {
    data = { running: false, unlocked: false };
  }
  statusCache = { data, at: Date.now() };
  updateBadge(data);
  return data;
}

// Badge priority: off > locked (!) > pending (+) > none.
async function updateBadge(status) {
  let text = "";
  let color = "#10b981";
  if (!status) {
    status = statusCache ? statusCache.data : { running: false, unlocked: false };
  }
  if (!status.running) {
    text = "off";
    color = "#64748b";
  } else if (!status.unlocked) {
    text = "!";
    color = "#f59e0b";
  } else {
    const pending = await getPendingSaves();
    if (pending.length > 0) {
      text = "+";
      color = "#10b981";
    }
  }
  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color });
}

function getPendingSaves() {
  return new Promise((resolve) => {
    chrome.storage.session.get("pendingSaves", (result) => {
      resolve(Array.isArray(result.pendingSaves) ? result.pendingSaves : []);
    });
  });
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (!request || !request.type) return false;

  switch (request.type) {
    case "GET_STATUS":
      getStatus(!!request.force)
        .then((data) => sendResponse({ success: true, data }))
        .catch((e) => sendResponse({ success: false, error: e.message }));
      return true;

    case "GET_CREDENTIALS":
      sendNative({ type: "get-credentials", domain: request.domain })
        .then((data) => sendResponse({ success: true, data }))
        .catch((e) => sendResponse({ success: false, error: e.message }));
      return true;

    case "LIST_CREDENTIALS":
      sendNative({ type: "list-credentials", domain: request.domain })
        .then((data) => sendResponse({ success: true, data }))
        .catch((e) => sendResponse({ success: false, error: e.message }));
      return true;

    case "SEARCH_CREDENTIALS":
      sendNative({ type: "search-credentials" })
        .then((data) => sendResponse({ success: true, data }))
        .catch((e) => sendResponse({ success: false, error: e.message }));
      return true;

    case "SAVE_CREDENTIAL":
      sendNative({ type: "save-credential", entry: request.entry })
        .then((data) => sendResponse({ success: true, data }))
        .catch((e) => sendResponse({ success: false, error: e.message }));
      return true;

    case "PENDING_SAVE_ADDED":
      updateBadge().then(() => sendResponse({ success: true }));
      return true;

    default:
      return false;
  }
});

// Refresh badge when the pending list changes (e.g. saved/dismissed from popup).
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "session" && changes.pendingSaves) {
    updateBadge();
  }
});

// One status probe at service worker startup.
getStatus(true);
