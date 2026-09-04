// Mynx extension background service worker.
// Bridges UI scripts to the Mynx desktop app via native messaging.
// No credentials are stored here; only the desktop holds the vault.

const NATIVE_HOST_NAME = "com.matt.mynx.native";
const NATIVE_TIMEOUT_MS = 5000;
// Pairing ждёт клика пользователя в десктопном приложении (сервер даёт 60с).
const PAIR_TIMEOUT_MS = 65000;
const STATUS_CACHE_MS = 10000;
const CLIENT_NAME = "Mynx Browser Extension";

// Favicon-кэш (session storage: чистится при закрытии браузера — домены
// не остаются на диске) и расписание бэкапа (local storage).
const FAVICON_CACHE_KEY = "faviconCache";
const FAVICON_CACHE_MAX = 300;
const FAVICON_MAX_BYTES = 100 * 1024;
const BACKUP_ALARM = "mynx-vault-backup";

let statusCache = null; // { data: { unlocked, running }, at: number }
let pairKey = null; // ключ доверенного клиента, живёт в chrome.storage.session

chrome.storage.session.get("pairKey", (r) => {
  pairKey = (r && r.pairKey) || null;
});

// Send a message to the native host with a hard timeout.
// Detect integrity / signature failures from the native host and surface
// a clear error to the popup / content scripts.
function isIntegrityError(data) {
  return !!(data && typeof data.message === "string" &&
    data.message.startsWith("desktop_integrity_invalid"));
}

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
  if (isIntegrityError(data)) {
    return { error: "desktop_integrity_invalid", message: data.message };
  }
  if (data && data.error === "pairing_required") {
    pairKey = null;
    notifyPairing();
    try {
      const pairData = await sendNativeRaw(
        { type: "pair", client: CLIENT_NAME },
        PAIR_TIMEOUT_MS
      );
      if (pairData && pairData.success !== false && pairData.data?.key) {
        pairKey = pairData.data.key;
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
    if (isIntegrityError(res)) {
      data = { running: false, unlocked: false, integrityError: res.message };
    } else {
      data = { running: true, unlocked: !!(res && res.unlocked) };
    }
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

// ---------- Favicon fetching (DDG → Google s2), кэш в session storage ----------

function storageGet(area, key) {
  return new Promise((resolve) => {
    chrome.storage[area].get(key, (result) => resolve(result[key]));
  });
}

function storageSet(area, key, value) {
  return new Promise((resolve) => chrome.storage[area].set({ [key]: value }, resolve));
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

async function fetchFaviconDataUrl(domain) {
  const sources = [
    `https://icons.duckduckgo.com/ip3/${encodeURIComponent(domain)}.ico`,
    `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=32`,
  ];
  for (const url of sources) {
    try {
      const res = await fetch(url, { credentials: "omit" });
      if (!res.ok) continue;
      const blob = await res.blob();
      if (blob.size === 0 || blob.size > FAVICON_MAX_BYTES) continue;
      const type = blob.type || "image/x-icon";
      if (!type.startsWith("image/")) continue;
      const b64 = arrayBufferToBase64(await blob.arrayBuffer());
      return `data:${type};base64,${b64}`;
    } catch (e) {
      /* следующий источник */
    }
  }
  return null;
}

async function getFavicon(rawDomain) {
  const domain = String(rawDomain || "").replace(/^www\./, "").trim();
  if (!domain || !/^[a-z0-9.-]+$/i.test(domain)) return { dataUrl: null };
  const cache = (await storageGet("session", FAVICON_CACHE_KEY)) || {};
  if (cache[domain]) return { dataUrl: cache[domain] };
  const dataUrl = await fetchFaviconDataUrl(domain);
  if (dataUrl) {
    // Prune: держим не больше FAVICON_CACHE_MAX записей (порядок вставки).
    const keys = Object.keys(cache);
    if (keys.length >= FAVICON_CACHE_MAX) {
      for (const k of keys.slice(0, keys.length - FAVICON_CACHE_MAX + 1)) delete cache[k];
    }
    cache[domain] = dataUrl;
    await storageSet("session", FAVICON_CACHE_KEY, cache);
  }
  return { dataUrl };
}

// ---------- Расписание бэкапа: chrome.alarms → нативный vault-backup ----------

const DEFAULT_BACKUP_SETTINGS = { enabled: false, intervalMinutes: 60 };

async function getBackupSettings() {
  const s = await storageGet("local", "backupSettings");
  return s && typeof s === "object" ? { ...DEFAULT_BACKUP_SETTINGS, ...s } : { ...DEFAULT_BACKUP_SETTINGS };
}

async function ensureBackupAlarm(settings) {
  try {
    if (settings.enabled && Number(settings.intervalMinutes) >= 15) {
      // Chrome: минимальный период 1 минута; наши пресеты — 15м и больше.
      chrome.alarms.create(BACKUP_ALARM, {
        delayInMinutes: Number(settings.intervalMinutes),
        periodInMinutes: Number(settings.intervalMinutes),
      });
    } else {
      await chrome.alarms.clear(BACKUP_ALARM);
    }
  } catch (e) {
    /* alarms недоступны — расписание просто не сработает */
  }
}

async function runBackupNow() {
  try {
    const data = await sendNative({ type: "vault-backup" });
    const at = (data && data.at) || Date.now();
    await storageSet("local", "backupState", { at, ok: true });
    return { at, ok: true };
  } catch (e) {
    await storageSet("local", "backupState", { at: Date.now(), ok: false, error: e.message });
    // Ошибка важна пользователю (успех — тихо, статус виден в попапе).
    try {
      chrome.notifications.create("mynx-backup", {
        type: "basic",
        iconUrl: "icons/icon128.png",
        title: "Mynx",
        message: `Backup failed: ${e.message}`,
      });
    } catch (_) {
      /* notifications могут быть недоступны */
    }
    return { at: Date.now(), ok: false, error: e.message };
  }
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm && alarm.name === BACKUP_ALARM) {
    runBackupNow();
  }
});

// Восстановить alarm после рестарта service worker / браузера.
getBackupSettings().then(ensureBackupAlarm);

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

    case "GET_FAVICON":
      getFavicon(request.domain)
        .then((data) => sendResponse({ success: true, data }))
        .catch((e) => sendResponse({ success: false, error: e.message }));
      return true;

    case "LIST_ALL":
      sendNative({ type: "list-all-entries" })
        .then((data) => sendResponse({ success: true, data }))
        .catch((e) => sendResponse({ success: false, error: e.message }));
      return true;

    case "UPDATE_ENTRY":
      sendNative({ type: "update-entry", entry: request.entry })
        .then((data) => sendResponse({ success: true, data }))
        .catch((e) => sendResponse({ success: false, error: e.message }));
      return true;

    case "GET_HEALTH":
      sendNative({ type: "get-health", entry: request.params })
        .then((data) => sendResponse({ success: true, data }))
        .catch((e) => sendResponse({ success: false, error: e.message }));
      return true;

    case "IMPORT_ENTRIES":
      // Крупный CSV дробим на пачки: натив-хост читает сообщения до 1 МБ.
      (async () => {
        const entries = Array.isArray(request.entries) ? request.entries : [];
        const BATCH = 500;
        let imported = 0;
        let skipped = 0;
        for (let i = 0; i < entries.length; i += BATCH) {
          const data = await sendNative({
            type: "import-entries",
            entries: entries.slice(i, i + BATCH),
          });
          imported += (data && data.imported) || 0;
          skipped += (data && data.skipped) || 0;
        }
        return { imported, skipped };
      })()
        .then((data) => sendResponse({ success: true, data }))
        .catch((e) => sendResponse({ success: false, error: e.message }));
      return true;

    case "RUN_BACKUP":
      runBackupNow()
        .then((data) => sendResponse({ success: true, data }))
        .catch((e) => sendResponse({ success: false, error: e.message }));
      return true;

    case "GET_BACKUP_SETTINGS":
      (async () => {
        const settings = await getBackupSettings();
        const state = (await storageGet("local", "backupState")) || null;
        return { settings, last: state };
      })()
        .then((data) => sendResponse({ success: true, data }))
        .catch((e) => sendResponse({ success: false, error: e.message }));
      return true;

    case "SET_BACKUP_SETTINGS":
      (async () => {
        const settings = {
          enabled: !!request.enabled,
          intervalMinutes: Math.max(15, parseInt(request.intervalMinutes, 10) || 60),
        };
        await storageSet("local", "backupSettings", settings);
        await ensureBackupAlarm(settings);
        return settings;
      })()
        .then((data) => sendResponse({ success: true, data }))
        .catch((e) => sendResponse({ success: false, error: e.message }));
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
