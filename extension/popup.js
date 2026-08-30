// Mynx popup: Site / All / Generator / Saved tabs.
// Talks to the desktop only via background messages; holds no vault data.

(function () {
  const statusPill = document.getElementById("status-pill");
  const toast = document.getElementById("toast");

  let appStatus = { running: false, unlocked: false };
  let currentDomain = "";
  let currentTabId = null;

  // ---------- helpers ----------

  function send(msg) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(msg, (response) => {
        if (chrome.runtime.lastError) {
          resolve({ success: false, error: chrome.runtime.lastError.message });
        } else {
          resolve(response || { success: false, error: "No response" });
        }
      });
    });
  }

  function showToast(text) {
    toast.textContent = text;
    toast.classList.add("show");
    setTimeout(() => toast.classList.remove("show"), 1200);
  }

  function copyText(text, label) {
    navigator.clipboard.writeText(text).then(() => showToast(label || "Copied"));
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function emptyState(pane, text) {
    pane.innerHTML = "";
    pane.appendChild(el("div", "empty", text));
  }

  // ---------- status ----------

  function renderStatus() {
    if (!appStatus.running) {
      statusPill.textContent = "Offline";
      statusPill.className = "pill offline";
    } else if (!appStatus.unlocked) {
      statusPill.textContent = "Locked";
      statusPill.className = "pill locked";
    } else {
      statusPill.textContent = "Unlocked";
      statusPill.className = "pill unlocked";
    }
  }

  async function refreshStatus() {
    const res = await send({ type: "GET_STATUS" });
    appStatus = res.success ? res.data : { running: false, unlocked: false };
    renderStatus();
    return appStatus;
  }

  function vaultErrorState(pane, res) {
    if (!appStatus.running) {
      emptyState(pane, "Mynx desktop is not running.\nStart the app and try again.");
      return true;
    }
    if (!appStatus.unlocked || (res && res.data && res.data.error === "vault_locked")) {
      emptyState(pane, "Unlock Mynx desktop to see your logins.");
      return true;
    }
    if (
      res &&
      res.data &&
      (res.data.error === "pairing_required" || res.data.error === "pairing_denied")
    ) {
      emptyState(pane, "Confirm access in the Mynx desktop app.");
      return true;
    }
    return false;
  }

  // ---------- tabs ----------

  const panes = {
    site: document.getElementById("pane-site"),
    all: document.getElementById("pane-all"),
    generator: document.getElementById("pane-generator"),
    saved: document.getElementById("pane-saved"),
  };

  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      Object.values(panes).forEach((p) => p.classList.add("hidden"));
      const name = tab.dataset.tab;
      panes[name].classList.remove("hidden");
      if (name === "site") renderSite();
      if (name === "all") renderAll();
      if (name === "saved") renderSaved();
    });
  });

  // ---------- Site tab ----------

  function entryRow({ title, subtitle, actions }) {
    const row = el("div", "entry");
    const meta = el("div", "meta");
    meta.appendChild(el("div", "t", title));
    meta.appendChild(el("div", "u", subtitle || ""));
    row.appendChild(meta);
    const act = el("div", "actions");
    for (const a of actions) act.appendChild(a);
    row.appendChild(act);
    return row;
  }

  function iconBtn(label, title, onClick) {
    const b = el("button", "icon-btn", label);
    b.title = title;
    b.addEventListener("click", onClick);
    return b;
  }

  async function renderSite() {
    const pane = panes.site;
    pane.innerHTML = "";
    if (!currentDomain) {
      emptyState(pane, "No website detected in the active tab.");
      return;
    }
    if (vaultErrorState(pane)) return;

    pane.appendChild(el("div", "empty", "Loading..."));
    const res = await send({ type: "LIST_CREDENTIALS", domain: currentDomain });
    pane.innerHTML = "";
    if (!res.success) {
      emptyState(pane, "Mynx desktop is not running.");
      return;
    }
    if (vaultErrorState(pane, res)) return;

    const entries = (res.data && res.data.entries) || [];
    if (entries.length === 0) {
      emptyState(pane, `No logins saved for ${currentDomain}.`);
    }
    for (const entry of entries) {
      const fill = el("button", "btn", "Fill");
      fill.addEventListener("click", () => {
        if (currentTabId == null) return;
        chrome.tabs.sendMessage(currentTabId, {
          type: "FILL_CREDENTIALS",
          username: entry.username,
          password: entry.password,
          totp: entry.totp,
        });
        window.close();
      });
      pane.appendChild(
        entryRow({
          title: entry.title || entry.username || "Login",
          subtitle: entry.username,
          actions: [
            fill,
            iconBtn("👤", "Copy username", () => copyText(entry.username, "Username copied")),
            iconBtn("🔑", "Copy password", () => copyText(entry.password, "Password copied")),
          ],
        })
      );
    }

    const add = el("button", "btn", "+ Add login");
    add.style.width = "100%";
    add.style.marginTop = "8px";
    add.addEventListener("click", renderAddForm);
    pane.appendChild(add);
  }

  // ---------- Add login form (Site tab) ----------

  const DRAFT_KEY = "addLoginDraft";

  function getDraft() {
    return new Promise((resolve) => {
      chrome.storage.session.get(DRAFT_KEY, (r) => resolve(r[DRAFT_KEY] || null));
    });
  }

  function setDraft(draft) {
    return new Promise((resolve) => chrome.storage.session.set({ [DRAFT_KEY]: draft }, resolve));
  }

  function clearDraft() {
    return new Promise((resolve) => chrome.storage.session.remove(DRAFT_KEY, resolve));
  }

  function getPageCredentials() {
    return new Promise((resolve) => {
      if (currentTabId == null) {
        resolve(null);
        return;
      }
      chrome.tabs.sendMessage(currentTabId, { type: "GET_FORM_CREDENTIALS" }, (res) => {
        if (chrome.runtime.lastError || !res || !res.success) {
          resolve(null);
        } else {
          resolve({ username: res.username || "", password: res.password || "" });
        }
      });
    });
  }

  async function renderAddForm() {
    const pane = panes.site;
    pane.innerHTML = "";

    const [draft, pageCreds] = await Promise.all([getDraft(), getPageCredentials()]);

    const title = el("input");
    title.type = "text";
    title.placeholder = "Title";
    title.value = draft?.title ?? currentDomain ?? "";

    const username = el("input");
    username.type = "text";
    username.placeholder = "Username";
    username.value = draft?.username ?? pageCreds?.username ?? "";

    const pwdRow = el("div", "gen-output");
    pwdRow.style.marginBottom = "0";
    const password = el("input");
    password.type = "text";
    password.placeholder = "Password";
    password.value = draft?.password ?? pageCreds?.password ?? "";
    const gen = iconBtn("🎲", "Generate password", () => {
      password.value = generatePassword();
      saveDraftFromFields();
    });
    pwdRow.appendChild(password);
    pwdRow.appendChild(gen);

    const url = el("input");
    url.type = "text";
    url.placeholder = "URL";
    url.value = draft?.url ?? (currentDomain ? "https://" + currentDomain : "");

    const btnRow = el("div");
    btnRow.style.display = "flex";
    btnRow.style.gap = "6px";
    const save = el("button", "btn", "Save");
    save.style.flex = "1";
    const cancel = el("button", "icon-btn", "✕");
    cancel.title = "Cancel";
    cancel.style.width = "auto";
    cancel.style.padding = "0 10px";
    cancel.addEventListener("click", async () => {
      await clearDraft();
      renderSite();
    });
    btnRow.appendChild(save);
    btnRow.appendChild(cancel);

    function saveDraftFromFields() {
      void setDraft({
        title: title.value,
        username: username.value,
        password: password.value,
        url: url.value,
      });
    }

    for (const field of [title, username, password, url]) {
      field.addEventListener("input", saveDraftFromFields);
    }

    for (const node of [title, username, pwdRow, url, btnRow]) {
      node.style.marginBottom = "8px";
      pane.appendChild(node);
    }

    save.addEventListener("click", async () => {
      if (!username.value || !password.value) {
        showToast("Username and password required");
        return;
      }
      save.disabled = true;
      const res = await send({
        type: "SAVE_CREDENTIAL",
        entry: {
          title: title.value || currentDomain,
          username: username.value,
          password: password.value,
          url: url.value,
          notes: "",
        },
      });
      if (res.success && res.data && res.data.success !== false) {
        allEntries = null; // сбросить кэш вкладки All
        await clearDraft();
        showToast("Saved to vault");
        renderSite();
      } else {
        save.disabled = false;
        showToast((res.data && res.data.error) || res.error || "Save failed");
      }
    });
  }

  // ---------- All tab ----------

  let allEntries = null;

  function renderAllList(filter) {
    const list = document.getElementById("all-list");
    list.innerHTML = "";
    const q = (filter || "").toLowerCase();
    const filtered = (allEntries || []).filter((e) => {
      const hay = `${e.title || ""} ${e.username || ""} ${e.url || ""}`.toLowerCase();
      return hay.includes(q);
    });
    if (filtered.length === 0) {
      list.appendChild(el("div", "empty", allEntries && allEntries.length ? "No matches." : "Vault is empty."));
      return;
    }
    for (const entry of filtered) {
      const actions = [
        iconBtn("👤", "Copy username", () => copyText(entry.username, "Username copied")),
      ];
      if (entry.url) {
        actions.push(iconBtn("↗", "Open URL", () => chrome.tabs.create({ url: entry.url })));
      }
      list.appendChild(
        entryRow({ title: entry.title || entry.username || "Login", subtitle: entry.username, actions })
      );
    }
  }

  async function renderAll() {
    const list = document.getElementById("all-list");
    if (vaultErrorState(list)) {
      allEntries = null;
      return;
    }
    if (allEntries) {
      renderAllList(document.getElementById("search-input").value);
      return;
    }
    list.innerHTML = "";
    list.appendChild(el("div", "empty", "Loading..."));
    const res = await send({ type: "SEARCH_CREDENTIALS" });
    if (!res.success || vaultErrorState(list, res)) {
      allEntries = null;
      return;
    }
    allEntries = (res.data && res.data.entries) || [];
    renderAllList(document.getElementById("search-input").value);
  }

  document.getElementById("search-input").addEventListener("input", (e) => {
    renderAllList(e.target.value);
  });

  // ---------- Generator tab ----------

  const GEN_SETS = {
    upper: "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
    lower: "abcdefghijklmnopqrstuvwxyz",
    digits: "0123456789",
    symbols: "!@#$%^&*()-_=+[]{};:,.<>?/~",
  };

  function randomInt(max) {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    return buf[0] % max;
  }

  function generatePassword() {
    const length = parseInt(document.getElementById("gen-length").value, 10);
    const groups = ["upper", "lower", "digits", "symbols"].filter(
      (g) => document.getElementById("gen-" + g).checked
    );
    if (groups.length === 0) return "";

    const chars = [];
    // Guarantee at least one char from each selected group.
    for (const g of groups) {
      const set = GEN_SETS[g];
      chars.push(set[randomInt(set.length)]);
    }
    const alphabet = groups.map((g) => GEN_SETS[g]).join("");
    while (chars.length < length) {
      chars.push(alphabet[randomInt(alphabet.length)]);
    }
    // Shuffle so guaranteed chars are not always at the front.
    for (let i = chars.length - 1; i > 0; i--) {
      const j = randomInt(i + 1);
      [chars[i], chars[j]] = [chars[j], chars[i]];
    }
    return chars.slice(0, length).join("");
  }

  function regenerate() {
    document.getElementById("gen-password").value = generatePassword();
  }

  document.getElementById("gen-length").addEventListener("input", (e) => {
    document.getElementById("gen-length-val").textContent = e.target.value;
    regenerate();
  });
  for (const g of ["upper", "lower", "digits", "symbols"]) {
    document.getElementById("gen-" + g).addEventListener("change", regenerate);
  }
  document.getElementById("gen-regen").addEventListener("click", regenerate);
  document.getElementById("gen-copy").addEventListener("click", () => {
    const v = document.getElementById("gen-password").value;
    if (v) copyText(v, "Password copied");
  });

  // ---------- Saved tab ----------

  function getPending() {
    return new Promise((resolve) => {
      chrome.storage.session.get("pendingSaves", (r) => {
        resolve(Array.isArray(r.pendingSaves) ? r.pendingSaves : []);
      });
    });
  }

  function setPending(list) {
    return new Promise((resolve) => chrome.storage.session.set({ pendingSaves: list }, resolve));
  }

  function updateSavedBadge(count) {
    const badge = document.getElementById("saved-count");
    badge.textContent = String(count);
    badge.classList.toggle("hidden", count === 0);
  }

  async function renderSaved() {
    const pane = panes.saved;
    const list = await getPending();
    updateSavedBadge(list.length);
    pane.innerHTML = "";
    if (list.length === 0) {
      emptyState(pane, "No new logins captured yet.\nLog in on a site and it will appear here.");
      return;
    }
    const canSave = appStatus.running && appStatus.unlocked;
    list.forEach((item, idx) => {
      const row = el("div", "entry");
      const meta = el("div", "meta");
      meta.appendChild(el("div", "t", item.domain));
      meta.appendChild(el("div", "u", item.username));
      const pwd = el("div", "pwd-mask", "••••••••");
      meta.appendChild(pwd);
      row.appendChild(meta);

      const act = el("div", "actions");
      const reveal = iconBtn("👁", "Show password", () => {
        const shown = pwd.textContent !== "••••••••";
        pwd.textContent = shown ? "••••••••" : item.password;
      });
      const save = el("button", "btn", "Save to vault");
      save.disabled = !canSave;
      save.title = canSave ? "" : "Unlock Mynx desktop first";
      save.addEventListener("click", async () => {
        save.disabled = true;
        const res = await send({
          type: "SAVE_CREDENTIAL",
          entry: {
            title: item.title || item.domain,
            username: item.username,
            password: item.password,
            url: item.url,
            notes: "",
          },
        });
        if (res.success && res.data && res.data.success !== false) {
          const cur = await getPending();
          await setPending(cur.filter((_, i) => i !== idx));
          showToast("Saved to vault");
          renderSaved();
        } else {
          save.disabled = false;
          showToast((res.data && res.data.error) || res.error || "Save failed");
        }
      });
      const dismiss = iconBtn("✕", "Dismiss", async () => {
        const cur = await getPending();
        await setPending(cur.filter((_, i) => i !== idx));
        renderSaved();
      });
      act.appendChild(reveal);
      act.appendChild(save);
      act.appendChild(dismiss);
      row.appendChild(act);
      pane.appendChild(row);
    });
  }

  // ---------- init ----------

  async function init() {
    regenerate();
    await refreshStatus();

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs && tabs[0];
      if (tab && tab.url && /^https?:/.test(tab.url)) {
        try {
          currentDomain = new URL(tab.url).hostname.replace(/^www\./, "");
          currentTabId = tab.id;
        } catch (e) {
          /* ignore unparseable URLs */
        }
      }
      renderSite();
    });

    const pending = await getPending();
    updateSavedBadge(pending.length);
  }

  init();
})();
