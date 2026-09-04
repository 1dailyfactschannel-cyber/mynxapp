// Mynx popup: Site / All / Health / Generator / Saved + Settings pane.
// Talks to the desktop only via background messages; holds no vault data.
// Vault-side features (health, categories, import dedup, backup) are
// computed by the desktop over native messaging — passwords never leave it.

(function () {
  const statusPill = document.getElementById("status-pill");
  const toast = document.getElementById("toast");

  let appStatus = { running: false, unlocked: false };
  let currentDomain = "";
  let currentTabId = null;

  // ---------- settings (chrome.storage.local) ----------

  const DEFAULT_SETTINGS = {
    favicons: true,
    density: "cozy", // compact | cozy | spacious
    fontScale: 100, // 85..130 (%)
    highContrast: false,
    reduceMotion: false,
    healthThreshold: 180, // days
  };
  let settings = { ...DEFAULT_SETTINGS };

  function loadSettings() {
    return new Promise((resolve) => {
      chrome.storage.local.get("uiSettings", (r) => {
        settings = { ...DEFAULT_SETTINGS, ...(r.uiSettings || {}) };
        resolve(settings);
      });
    });
  }

  function saveSettings() {
    return new Promise((resolve) =>
      chrome.storage.local.set({ uiSettings: settings }, resolve)
    );
  }

  function applySettings() {
    document.documentElement.style.setProperty("--fs-scale", String(settings.fontScale / 100));
    document.body.classList.remove("density-compact", "density-cozy", "density-spacious");
    document.body.classList.add("density-" + (settings.density || "cozy"));
    document.body.classList.toggle("contrast-high", !!settings.highContrast);
    document.body.classList.toggle("motion-reduced", !!settings.reduceMotion);
  }

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
    setTimeout(() => toast.classList.remove("show"), 1400);
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

  const ILLUSTRATIONS = {
    search:
      '<svg class="illust" width="54" height="44" viewBox="0 0 54 44" fill="none" aria-hidden="true">' +
      '<circle class="float" cx="24" cy="18" r="12" stroke="#10b981" stroke-width="2" opacity="0.9"/>' +
      '<path class="float" d="M33 27l9 9" stroke="#10b981" stroke-width="2.5" stroke-linecap="round"/>' +
      '<path d="M18 18a6 6 0 0 1 6-6" stroke="#34d399" stroke-width="2" stroke-linecap="round" opacity="0.5"/></svg>',
    site:
      '<svg class="illust" width="54" height="44" viewBox="0 0 54 44" fill="none" aria-hidden="true">' +
      '<rect class="float" x="10" y="6" width="34" height="32" rx="4" stroke="#10b981" stroke-width="2"/>' +
      '<path class="float" d="M17 22V15a7 7 0 0 1 14 0v7" stroke="#34d399" stroke-width="2"/>' +
      '<circle cx="27" cy="26" r="3" fill="#34d399"/></svg>',
    saved:
      '<svg class="illust" width="54" height="44" viewBox="0 0 54 44" fill="none" aria-hidden="true">' +
      '<path class="float" d="M10 26h10l3 4h8l3-4h10" stroke="#10b981" stroke-width="2" stroke-linecap="round"/>' +
      '<path class="float" d="M14 26l3-14h20l3 14" stroke="#34d399" stroke-width="2" stroke-linecap="round" opacity="0.6"/>' +
      '<path d="M10 34h34" stroke="#10b981" stroke-width="2" stroke-linecap="round" opacity="0.4"/></svg>',
    health:
      '<svg class="illust" width="54" height="44" viewBox="0 0 54 44" fill="none" aria-hidden="true">' +
      '<path class="float" d="M27 38S8 27 8 15a9 9 0 0 1 19-3 9 9 0 0 1 19 3c0 12-19 23-19 23z" stroke="#10b981" stroke-width="2"/>' +
      '<path class="float" d="M15 20h7l3-6 5 12 3-6h6" stroke="#34d399" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    folder:
      '<svg class="illust" width="54" height="44" viewBox="0 0 54 44" fill="none" aria-hidden="true">' +
      '<path class="float" d="M8 12a3 3 0 0 1 3-3h10l4 5h18a3 3 0 0 1 3 3v17a3 3 0 0 1-3 3H11a3 3 0 0 1-3-3V12z" stroke="#10b981" stroke-width="2"/>' +
      '<path d="M8 19h38" stroke="#34d399" stroke-width="2" opacity="0.5"/></svg>',
    key:
      '<svg class="illust" width="54" height="44" viewBox="0 0 54 44" fill="none" aria-hidden="true">' +
      '<circle class="float" cx="20" cy="18" r="8" stroke="#10b981" stroke-width="2"/>' +
      '<path class="float" d="M26 24l16 16m-6-6l4-4m-10-0l4-4" stroke="#34d399" stroke-width="2" stroke-linecap="round"/></svg>',
  };

  function emptyState(pane, text, illust) {
    pane.innerHTML = "";
    const box = el("div", "empty");
    if (illust && ILLUSTRATIONS[illust]) {
      const span = el("span");
      span.innerHTML = ILLUSTRATIONS[illust];
      box.appendChild(span.firstChild);
    }
    box.appendChild(document.createTextNode(text));
    pane.appendChild(box);
  }

  // ---------- favicons ----------

  const faviconPromises = new Map();

  function getFaviconUrl(domain) {
    if (!domain) return Promise.resolve(null);
    if (faviconPromises.has(domain)) return faviconPromises.get(domain);
    const p = send({ type: "GET_FAVICON", domain }).then((res) =>
      res.success && res.data ? res.data.dataUrl || null : null
    );
    faviconPromises.set(domain, p);
    return p;
  }

  function makeFav(domain, title) {
    const fav = el("span", "fav");
    const letter = (title || domain || "?").trim().charAt(0).toUpperCase() || "?";
    fav.appendChild(el("span", "letter", letter));
    fav.setAttribute("aria-hidden", "true");
    if (settings.favicons && domain) {
      getFaviconUrl(domain).then((dataUrl) => {
        if (!dataUrl || !fav.isConnected) return;
        const img = document.createElement("img");
        img.src = dataUrl;
        img.alt = "";
        img.width = 16;
        img.height = 16;
        fav.textContent = "";
        fav.appendChild(img);
      });
    }
    return fav;
  }

  // ---------- keyboard navigation (a11y) ----------

  function listKeyNav(e) {
    const row = e.target.closest && e.target.closest(".entry");
    if (!row) return;
    const container = e.currentTarget;
    const rows = Array.from(container.querySelectorAll(".entry"));
    const idx = rows.indexOf(row);
    let next = null;
    if (e.key === "ArrowDown") next = rows[Math.min(rows.length - 1, idx + 1)];
    else if (e.key === "ArrowUp") next = rows[Math.max(0, idx - 1)];
    else if (e.key === "Home") next = rows[0];
    else if (e.key === "End") next = rows[rows.length - 1];
    if (next) {
      e.preventDefault();
      next.focus();
    }
  }

  function entryRow({ title, subtitle, domain, actions, badge, delay }) {
    const row = el("div", "entry");
    row.tabIndex = 0;
    row.setAttribute("role", "listitem");
    row.setAttribute("aria-label", subtitle ? `${title}, ${subtitle}` : title);
    if (delay) row.style.animationDelay = `${Math.min(delay, 250)}ms`;
    row.appendChild(makeFav(domain, title));
    const meta = el("div", "meta");
    meta.appendChild(el("div", "t", title));
    if (subtitle) meta.appendChild(el("div", "u", subtitle));
    row.appendChild(meta);
    if (badge) row.appendChild(badge);
    const act = el("div", "actions");
    for (const a of actions) act.appendChild(a);
    row.appendChild(act);
    return row;
  }

  function iconBtn(label, title, onClick) {
    const b = el("button", "icon-btn", label);
    b.title = title;
    b.setAttribute("aria-label", title);
    b.addEventListener("click", onClick);
    return b;
  }

  // ---------- status ----------

  function renderStatus() {
    if (appStatus.integrityError) {
      statusPill.textContent = "Tampered";
      statusPill.className = "pill offline";
      statusPill.title = appStatus.integrityError;
    } else if (!appStatus.running) {
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
      emptyState(pane, "Mynx desktop is not running.\nStart the app and try again.", "key");
      return true;
    }
    if (!appStatus.unlocked || (res && res.data && res.data.error === "vault_locked")) {
      emptyState(pane, "Unlock Mynx desktop to see your logins.", "key");
      return true;
    }
    if (
      res &&
      res.data &&
      (res.data.error === "pairing_required" || res.data.error === "pairing_denied")
    ) {
      emptyState(pane, "Confirm access in the Mynx desktop app.", "key");
      return true;
    }
    return false;
  }

  // ---------- tabs + settings gear ----------

  const panes = {
    site: document.getElementById("pane-site"),
    all: document.getElementById("pane-all"),
    health: document.getElementById("pane-health"),
    generator: document.getElementById("pane-generator"),
    saved: document.getElementById("pane-saved"),
    settings: document.getElementById("pane-settings"),
  };
  const tabsBar = document.getElementById("tabs");
  const gearBtn = document.getElementById("settings-btn");
  let activeTab = "site";
  let settingsOpen = false;

  function activateTab(name) {
    activeTab = name;
    tabsBar.querySelectorAll(".tab").forEach((t) => {
      const on = t.dataset.tab === name;
      t.classList.toggle("active", on);
      t.setAttribute("aria-selected", on ? "true" : "false");
    });
    Object.entries(panes).forEach(([key, p]) => p.classList.toggle("hidden", key !== name));
    if (name === "site") renderSite();
    if (name === "all") renderAll();
    if (name === "health") renderHealth();
    if (name === "saved") renderSaved();
  }

  tabsBar.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => activateTab(tab.dataset.tab));
  });

  // Roving focus in the tablist: arrows move focus and activate.
  tabsBar.addEventListener("keydown", (e) => {
    const tabs = Array.from(tabsBar.querySelectorAll(".tab"));
    const idx = tabs.indexOf(document.activeElement);
    if (idx < 0) return;
    let next = null;
    if (e.key === "ArrowRight") next = tabs[(idx + 1) % tabs.length];
    else if (e.key === "ArrowLeft") next = tabs[(idx - 1 + tabs.length) % tabs.length];
    else if (e.key === "Home") next = tabs[0];
    else if (e.key === "End") next = tabs[tabs.length - 1];
    if (next) {
      e.preventDefault();
      next.focus();
      activateTab(next.dataset.tab);
    }
  });

  gearBtn.addEventListener("click", () => {
    settingsOpen = !settingsOpen;
    gearBtn.setAttribute("aria-expanded", settingsOpen ? "true" : "false");
    gearBtn.textContent = settingsOpen ? "✕" : "⚙";
    tabsBar.classList.toggle("hidden", settingsOpen);
    if (settingsOpen) {
      renderSettings();
      Object.entries(panes).forEach(([key, p]) => p.classList.toggle("hidden", key !== "settings"));
    } else {
      activateTab(activeTab);
    }
  });

  // ---------- Site tab ----------

  async function renderSite() {
    const pane = panes.site;
    pane.innerHTML = "";
    pane.setAttribute("role", "list");
    pane.removeEventListener("keydown", listKeyNav);
    pane.addEventListener("keydown", listKeyNav);
    if (!currentDomain) {
      emptyState(pane, "No website detected in the active tab.", "site");
      return;
    }
    if (vaultErrorState(pane)) return;

    pane.appendChild(el("div", "empty", "Loading..."));
    const res = await send({ type: "LIST_CREDENTIALS", domain: currentDomain });
    pane.innerHTML = "";
    if (!res.success) {
      emptyState(pane, "Mynx desktop is not running.", "key");
      return;
    }
    if (vaultErrorState(pane, res)) return;

    const entries = (res.data && res.data.entries) || [];
    if (entries.length === 0) {
      emptyState(
        pane,
        `No logins saved for ${currentDomain}.\nTip: passkeys for this site are managed in the Mynx desktop app.`,
        "site"
      );
    }
    entries.forEach((entry, i) => {
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
          domain: currentDomain,
          delay: i * 25,
          actions: [
            fill,
            iconBtn("👤", "Copy username", () => copyText(entry.username, "Username copied")),
            iconBtn("🔑", "Copy password", () => copyText(entry.password, "Password copied")),
          ],
        })
      );
    });

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
    title.setAttribute("aria-label", "Title");
    title.value = draft?.title ?? currentDomain ?? "";

    const username = el("input");
    username.type = "text";
    username.placeholder = "Username";
    username.setAttribute("aria-label", "Username");
    username.value = draft?.username ?? pageCreds?.username ?? "";

    const pwdRow = el("div", "gen-output");
    pwdRow.style.marginBottom = "0";
    const password = el("input");
    password.type = "text";
    password.placeholder = "Password";
    password.setAttribute("aria-label", "Password");
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
    url.setAttribute("aria-label", "URL");
    url.value = draft?.url ?? (currentDomain ? "https://" + currentDomain : "");

    const btnRow = el("div");
    btnRow.style.display = "flex";
    btnRow.style.gap = "6px";
    const save = el("button", "btn", "Save");
    save.style.flex = "1";
    const cancel = el("button", "icon-btn", "✕");
    cancel.title = "Cancel";
    cancel.setAttribute("aria-label", "Cancel");
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
        allEntries = null; // invalidate All tab cache
        await clearDraft();
        showToast("Saved to vault");
        renderSite();
      } else {
        save.disabled = false;
        showToast((res.data && res.data.error) || res.error || "Save failed");
      }
    });
  }

  // ---------- All tab: virtualized list + categories + drag&drop ----------

  let allEntries = null; // {id,title,username,url,category,favorite,updatedAt}
  let activeCategory = "__all__";
  const DENSITY_ROW_H = { compact: 40, cozy: 48, spacious: 58 };

  const allScroll = document.getElementById("all-scroll");
  const chipsBar = document.getElementById("category-chips");
  const searchInput = document.getElementById("search-input");

  function allFiltered() {
    const q = (searchInput.value || "").toLowerCase();
    return (allEntries || []).filter((e) => {
      if (activeCategory === "__none__" && (e.category || "") !== "") return false;
      if (activeCategory !== "__all__" && activeCategory !== "__none__" && (e.category || "") !== activeCategory) return false;
      const hay = `${e.title || ""} ${e.username || ""} ${e.url || ""}`.toLowerCase();
      return hay.includes(q);
    });
  }

  function allCategories() {
    const set = new Set();
    for (const e of allEntries || []) {
      const c = (e.category || "").trim();
      if (c) set.add(c);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }

  function renderChips() {
    chipsBar.innerHTML = "";
    const cats = allCategories();
    const defs = [
      { key: "__all__", label: "All" },
      ...cats.map((c) => ({ key: c, label: c })),
      { key: "__none__", label: "No category" },
    ];
    defs.forEach((d, i) => {
      const chip = el("button", "chip", d.label);
      chip.style.animationDelay = `${Math.min(i * 20, 200)}ms`;
      chip.tabIndex = 0;
      chip.classList.toggle("active", activeCategory === d.key);
      chip.setAttribute("aria-pressed", activeCategory === d.key ? "true" : "false");
      chip.title = `Filter: ${d.label}. Drag a login here to move it.`;
      chip.addEventListener("click", () => {
        activeCategory = d.key;
        renderChips();
        renderAllList();
      });
      chip.addEventListener("dragover", (e) => {
        e.preventDefault();
        chip.classList.add("drop-target");
      });
      chip.addEventListener("dragleave", () => chip.classList.remove("drop-target"));
      chip.addEventListener("drop", (e) => {
        e.preventDefault();
        chip.classList.remove("drop-target");
        const id = e.dataTransfer.getData("text/mynx-entry-id") || e.dataTransfer.getData("text/plain");
        if (id) moveEntryToCategory(id, d.key === "__all__" ? null : d.key === "__none__" ? "" : d.key);
      });
      chipsBar.appendChild(chip);
    });
  }

  function renderVirtualRows(items) {
    const rowH = DENSITY_ROW_H[settings.density] || DENSITY_ROW_H.cozy;
    allScroll.innerHTML = "";
    if (items.length === 0) return;

    const spacer = el("div");
    spacer.style.position = "relative";
    spacer.style.height = `${items.length * rowH}px`;
    allScroll.appendChild(spacer);

    const render = () => {
      const top = allScroll.scrollTop;
      const h = allScroll.clientHeight || 288;
      const overscan = 6;
      const start = Math.max(0, Math.floor(top / rowH) - overscan);
      const end = Math.min(items.length, Math.ceil((top + h) / rowH) + overscan);
      spacer.textContent = "";
      for (let i = start; i < end; i++) {
        const wrap = el("div");
        wrap.style.position = "absolute";
        wrap.style.top = `${i * rowH}px`;
        wrap.style.left = "0";
        wrap.style.right = "0";
        wrap.appendChild(allRow(items[i], i));
        spacer.appendChild(wrap);
      }
    };
    allScroll.onscroll = render;
    render();
  }

  function allRow(entry, i) {
    const actions = [
      iconBtn("👤", "Copy username", () => copyText(entry.username, "Username copied")),
    ];
    if (entry.url) {
      actions.push(iconBtn("↗", "Open URL", () => chrome.tabs.create({ url: entry.url })));
    }
    actions.push(iconBtn("📁", "Move to category", (e) => openMovePopover(entry, e.currentTarget)));

    const row = entryRow({
      title: entry.title || entry.username || "Login",
      subtitle: entry.username,
      domain: domainOf(entry.url),
      delay: i * 12,
      actions,
    });
    row.draggable = true;
    row.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("text/mynx-entry-id", entry.id);
      e.dataTransfer.effectAllowed = "move";
      row.classList.add("dragging");
    });
    row.addEventListener("dragend", () => row.classList.remove("dragging"));
    return row;
  }

  function domainOf(url) {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch (e) {
      return "";
    }
  }

  async function moveEntryToCategory(id, category) {
    const res = await send({
      type: "UPDATE_ENTRY",
      entry: { id, category: category || "" },
    });
    if (res.success) {
      const e = (allEntries || []).find((x) => x.id === id);
      if (e) e.category = category || "";
      showToast(category ? `Moved to “${category}”` : "Removed from category");
      renderChips();
      renderAllList();
    } else {
      showToast((res.error || "Move failed") + "");
    }
  }

  // Keyboard-accessible fallback for drag&drop: popover with category list.
  function openMovePopover(entry, anchor) {
    closeMovePopover();
    const pop = el("div");
    pop.id = "mynx-move-pop";
    pop.style.cssText =
      "position:fixed;z-index:60;background:#111118;border:1px solid #1f2937;border-radius:8px;" +
      "box-shadow:0 8px 24px rgba(0,0,0,0.6);padding:6px;max-height:200px;overflow-y:auto;min-width:150px;";
    pop.setAttribute("role", "menu");
    pop.setAttribute("aria-label", "Move to category");

    const add = (label, category) => {
      const b = el("button", "chip", label);
      b.style.display = "block";
      b.style.width = "100%";
      b.style.marginBottom = "4px";
      b.style.cursor = "pointer";
      if ((entry.category || "") === (category || "")) b.classList.add("active");
      b.addEventListener("click", () => {
        closeMovePopover();
        moveEntryToCategory(entry.id, category);
      });
      pop.appendChild(b);
    };
    add("No category", "");
    for (const c of allCategories()) add(c, c);
    const newCat = el("input");
    newCat.type = "text";
    newCat.placeholder = "New category…";
    newCat.setAttribute("aria-label", "New category name");
    newCat.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && newCat.value.trim()) {
        closeMovePopover();
        moveEntryToCategory(entry.id, newCat.value.trim());
      }
    });
    pop.appendChild(newCat);

    document.body.appendChild(pop);
    const r = anchor.getBoundingClientRect();
    pop.style.top = `${Math.min(r.bottom + 4, window.innerHeight - 210)}px`;
    pop.style.left = `${Math.max(4, Math.min(r.left - 60, 340 - 160))}px`;
    newCat.focus();
    setTimeout(() => {
      document.addEventListener("mousedown", popOutside);
      document.addEventListener("keydown", popEscape, true);
    }, 0);
  }

  function popOutside(e) {
    const pop = document.getElementById("mynx-move-pop");
    if (pop && !pop.contains(e.target)) closeMovePopover();
  }
  function popEscape(e) {
    if (e.key === "Escape") closeMovePopover();
  }
  function closeMovePopover() {
    const pop = document.getElementById("mynx-move-pop");
    if (pop) pop.remove();
    document.removeEventListener("mousedown", popOutside);
    document.removeEventListener("keydown", popEscape, true);
  }

  function renderAllList() {
    const items = allFiltered();
    allScroll.innerHTML = "";
    if (items.length === 0) {
      const box = el("div", "empty");
      box.appendChild((() => {
        const s = el("span");
        s.innerHTML = ILLUSTRATIONS[(allEntries || []).length ? "search" : "folder"];
        return s.firstChild;
      })());
      box.appendChild(
        document.createTextNode(
          (allEntries || []).length ? "Nothing matches this filter." : "Vault is empty.\nSaved logins appear here."
        )
      );
      allScroll.appendChild(box);
      return;
    }
    renderVirtualRows(items);
  }

  async function renderAll() {
    allScroll.removeEventListener("keydown", listKeyNav);
    allScroll.addEventListener("keydown", listKeyNav);
    if (vaultErrorState(allScroll)) {
      allEntries = null;
      return;
    }
    if (allEntries) {
      renderChips();
      renderAllList();
      return;
    }
    allScroll.innerHTML = "";
    allScroll.appendChild(el("div", "empty", "Loading..."));
    const res = await send({ type: "LIST_ALL" });
    if (!res.success || vaultErrorState(allScroll, res)) {
      allEntries = null;
      return;
    }
    allEntries = (res.data && res.data.entries) || [];
    renderChips();
    renderAllList();
  }

  searchInput.addEventListener("input", () => {
    renderAllList();
  });

  // ---------- CSV import (Chrome / Bitwarden) ----------

  function parseCsv(text) {
    const rows = [];
    let row = [];
    let field = "";
    let inQ = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQ) {
        if (c === '"') {
          if (text[i + 1] === '"') {
            field += '"';
            i++;
          } else {
            inQ = false;
          }
        } else {
          field += c;
        }
      } else if (c === '"') {
        inQ = true;
      } else if (c === ",") {
        row.push(field);
        field = "";
      } else if (c === "\n") {
        row.push(field);
        field = "";
        rows.push(row);
        row = [];
      } else if (c !== "\r") {
        field += c;
      }
    }
    if (field.length > 0 || row.length > 0) {
      row.push(field);
      rows.push(row);
    }
    return rows;
  }

  function csvToEntries(text) {
    const rows = parseCsv(text);
    if (rows.length < 2) return null;
    const header = rows[0].map((h) => h.trim().toLowerCase());
    const col = (...names) => {
      for (const n of names) {
        const i = header.indexOf(n);
        if (i >= 0) return i;
      }
      return -1;
    };
    const iT = col("name", "title", "account");
    const iU = col("url", "login_uri", "website", "web site");
    const iUser = col("username", "login_username", "user name", "login");
    const iP = col("password", "login_password");
    if (iUser < 0 || iP < 0) return null; // need at least username+password
    const format = header.includes("login_uri") ? "Bitwarden" : "Chrome";
    const entries = [];
    for (const r of rows.slice(1)) {
      const get = (i) => (i >= 0 ? (r[i] || "").trim() : "");
      const username = get(iUser);
      const password = get(iP);
      if (!username && !password) continue;
      entries.push({
        title: get(iT),
        username,
        password,
        url: get(iU),
      });
    }
    return { format, entries };
  }

  document.getElementById("import-btn").addEventListener("click", () => {
    document.getElementById("import-file").click();
  });

  document.getElementById("import-file").addEventListener("change", async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    if (!appStatus.running || !appStatus.unlocked) {
      showToast("Unlock Mynx desktop first");
      return;
    }
    try {
      const text = await file.text();
      const parsed = csvToEntries(text);
      if (!parsed || parsed.entries.length === 0) {
        showToast("Unrecognized CSV (need username+password)");
        return;
      }
      const btn = document.getElementById("import-btn");
      btn.disabled = true;
      const res = await send({ type: "IMPORT_ENTRIES", entries: parsed.entries });
      btn.disabled = false;
      if (res.success) {
        allEntries = null;
        const d = res.data || {};
        showToast(`Imported ${d.imported || 0}, skipped ${d.skipped || 0} dups`);
        renderAll(); // refetch full list (ids/categories) from the desktop
      } else {
        showToast(res.error || "Import failed");
      }
    } catch (err) {
      showToast("Import failed: " + err.message);
    }
  });

  // ---------- Health tab ----------

  const HISTORY_KEY = "healthHistory";
  const HISTORY_MAX = 90;
  const DAY_MS = 24 * 3600 * 1000;

  async function loadHealthHistory() {
    return new Promise((resolve) => {
      chrome.storage.local.get(HISTORY_KEY, (r) => {
        const h = r[HISTORY_KEY];
        resolve(Array.isArray(h) ? h : []);
      });
    });
  }

  async function recordHealthSnapshot(payload) {
    const history = await loadHealthHistory();
    const snap = {
      at: Date.now(),
      score: payload.score || 0,
      weak: (payload.weak || []).length,
      reused: (payload.reused || []).length,
      rotationDue: (payload.rotationDue || []).length,
      total: payload.total || 0,
    };
    const dayStart = new Date().setHours(0, 0, 0, 0);
    const withoutToday = history.filter((s) => new Date(s.at).setHours(0, 0, 0, 0) !== dayStart);
    const next = [...withoutToday, snap].slice(-HISTORY_MAX);
    await new Promise((resolve) => chrome.storage.local.set({ [HISTORY_KEY]: next }, resolve));
    return next;
  }

  function trendDelta(history, days = 7) {
    if (history.length < 2) return null;
    const cutoff = Date.now() - days * DAY_MS;
    const past = history.filter((s) => s.at <= cutoff);
    const baseline = past.length > 0 ? past[past.length - 1] : history[0];
    const latest = history[history.length - 1];
    if (baseline === latest) return null;
    return latest.score - baseline.score;
  }

  function sparkline(history) {
    const w = 300;
    const h = 28;
    if (history.length < 2) return "";
    const scores = history.map((s) => s.score);
    const min = 0;
    const max = 100;
    const step = w / (scores.length - 1);
    const pts = scores
      .map((s, i) => `${(i * step).toFixed(1)},${(h - ((s - min) / (max - min)) * h).toFixed(1)}`)
      .join(" ");
    return (
      `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">` +
      `<polyline points="${pts}" fill="none" stroke="#10b981" stroke-width="1.5" stroke-linejoin="round"/>` +
      `</svg>`
    );
  }

  function scoreColor(score) {
    if (score >= 80) return "#10b981";
    if (score >= 50) return "#fbbf24";
    return "#f87171";
  }

  function healthSection(label, items, detailFn) {
    const det = document.createElement("details");
    det.className = "health-section";
    const sum = el("summary", null, label);
    const n = el("span", "n", String(items.length));
    sum.appendChild(n);
    det.appendChild(sum);
    if (items.length === 0) {
      const none = el("div", "h-item", "Nothing here — keep it up!");
      det.appendChild(none);
    } else {
      for (const it of items.slice(0, 50)) {
        const d = el("div", "h-item");
        const b = el("b", null, it.title || it.username || "Login");
        d.appendChild(b);
        d.appendChild(document.createTextNode(detailFn(it) || ""));
        det.appendChild(d);
      }
      if (items.length > 50) {
        det.appendChild(el("div", "h-item", `…and ${items.length - 50} more`));
      }
    }
    return det;
  }

  function buildHealthCsv(payload, threshold) {
    const esc = (v) => {
      const s = String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const rows = [];
    rows.push(["Mynx Health Report"]);
    rows.push(["Generated", new Date().toISOString()]);
    rows.push(["Entries", payload.total]);
    rows.push(["Total score", payload.score]);
    rows.push(["Base strength", payload.baseStrength]);
    rows.push(["Avg password age (days)", payload.avgPasswordAgeDays ?? ""]);
    rows.push(["Rotation threshold (days)", threshold]);
    rows.push([]);
    rows.push(["Section", "Title", "Username", "Detail"]);
    for (const e of payload.rotationDue || []) {
      rows.push(["rotation_due", esc(e.title), esc(e.username || ""), `${e.ageDays} days`]);
    }
    for (const e of payload.weak || []) {
      rows.push(["weak_password", esc(e.title), esc(e.username || ""), `strength ${e.strength}`]);
    }
    for (const e of payload.reused || []) {
      rows.push(["reused_password", esc(e.title), esc(e.username || ""), "shared with other entries"]);
    }
    for (const e of payload.no2fa || []) {
      rows.push(["no_2fa", esc(e.title), esc(e.username || ""), ""]);
    }
    return "\uFEFF" + rows.map((r) => r.join(",")).join("\r\n");
  }

  function downloadCsv(filename, csv) {
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function renderHealth() {
    const pane = panes.health;
    pane.innerHTML = "";
    pane.removeEventListener("keydown", listKeyNav);
    if (vaultErrorState(pane)) return;

    pane.appendChild(el("div", "empty", "Analyzing vault…"));
    const res = await send({
      type: "GET_HEALTH",
      params: { thresholdDays: settings.healthThreshold },
    });
    pane.innerHTML = "";
    if (!res.success || !res.data || !res.data.data) {
      emptyState(pane, "Health report needs the desktop app running and unlocked.", "health");
      return;
    }
    const payload = res.data.data;
    if ((payload.total || 0) === 0) {
      emptyState(pane, "Vault is empty — nothing to analyze yet.", "health");
      return;
    }

    const history = await recordHealthSnapshot(payload);
    const delta = trendDelta(history);

    // Ring + stats
    const top = el("div", "health-top");
    const ring = el("div", "ring-wrap");
    const r = 30;
    const c = 2 * Math.PI * r;
    const color = scoreColor(payload.score || 0);
    ring.innerHTML =
      `<svg width="74" height="74" viewBox="0 0 74 74" aria-hidden="true">` +
      `<circle cx="37" cy="37" r="${r}" stroke="#1f2937" stroke-width="7" fill="none"/>` +
      `<circle cx="37" cy="37" r="${r}" stroke="${color}" stroke-width="7" fill="none" stroke-linecap="round"` +
      ` stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${(c * (1 - (payload.score || 0) / 100)).toFixed(1)}"` +
      ` style="transition:stroke-dashoffset 0.6s ease"/></svg>`;
    const scoreBox = el("div", "ring-score");
    scoreBox.appendChild(el("span", null, String(payload.score ?? 0)));
    scoreBox.appendChild(el("small", null, "score"));
    ring.appendChild(scoreBox);
    top.appendChild(ring);

    const stats = el("div", "health-stats");
    const stat = (label, value) => {
      const s = el("div");
      s.appendChild(el("b", null, value));
      s.appendChild(document.createTextNode(" " + label));
      return s;
    };
    stats.appendChild(stat("entries", String(payload.total)));
    stats.appendChild(stat("base strength", `${payload.baseStrength ?? 0}`));
    stats.appendChild(stat("avg age", payload.avgPasswordAgeDays != null ? `${payload.avgPasswordAgeDays}d` : "—"));
    stats.appendChild(stat("weak / reused", `${(payload.weak || []).length} / ${(payload.reused || []).length}`));
    top.appendChild(stats);
    pane.appendChild(top);

    // Sparkline + 7-day delta
    if (history.length >= 2) {
      const spark = el("div", "health-spark");
      const cap = el("div", "cap");
      cap.appendChild(el("span", null, "Score trend"));
      if (delta !== null) {
        const d = el(
          "span",
          delta >= 0 ? "delta-up" : "delta-down",
          `${delta >= 0 ? "▲ +" : "▼ "}${delta} / 7d`
        );
        cap.appendChild(d);
      }
      spark.appendChild(cap);
      const svgWrap = el("span");
      svgWrap.innerHTML = sparkline(history);
      spark.appendChild(svgWrap.firstChild);
      pane.appendChild(spark);
    }

    // Toolbar: threshold + export
    const bar = el("div", "health-toolbar");
    const lbl = el("label", null, "Rotate after");
    lbl.htmlFor = "health-threshold";
    bar.appendChild(lbl);
    const sel = document.createElement("select");
    sel.id = "health-threshold";
    for (const v of [90, 180, 365]) {
      const o = document.createElement("option");
      o.value = String(v);
      o.textContent = `${v} days`;
      if (settings.healthThreshold === v) o.selected = true;
      sel.appendChild(o);
    }
    sel.addEventListener("change", async () => {
      settings.healthThreshold = parseInt(sel.value, 10);
      await saveSettings();
      renderHealth();
    });
    bar.appendChild(sel);
    const exp = el("button", "btn", "Export CSV");
    exp.style.marginLeft = "auto";
    exp.addEventListener("click", () => {
      downloadCsv("mynx-health-report.csv", buildHealthCsv(payload, settings.healthThreshold));
      showToast("Report exported");
    });
    bar.appendChild(exp);
    pane.appendChild(bar);

    // Sections
    pane.appendChild(
      healthSection("🔑 Passwords to rotate", payload.rotationDue || [], (e) => `${e.ageDays} days old`)
    );
    pane.appendChild(healthSection("⚠ Weak passwords", payload.weak || [], (e) => `strength ${e.strength}/100`));
    pane.appendChild(healthSection("♻ Reused passwords", payload.reused || [], () => "used on more than one site"));
    pane.appendChild(healthSection("🛡 No two-factor", payload.no2fa || [], () => "no TOTP, no 2fa tag"));
  }

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

  // Port of calculateStrength (desktop src/stores/vault.ts)
  function calculateStrength(pwd) {
    if (!pwd) return 0;
    let s = 0;
    if (pwd.length >= 12) s += 25;
    if (pwd.length >= 16) s += 15;
    if (/[a-z]/.test(pwd)) s += 15;
    if (/[A-Z]/.test(pwd)) s += 15;
    if (/[0-9]/.test(pwd)) s += 15;
    if (/[^a-zA-Z0-9]/.test(pwd)) s += 15;
    return Math.min(100, s);
  }

  function updateStrengthMeter(pwd) {
    const bar = document.getElementById("gen-strength-bar");
    const label = document.getElementById("gen-strength-label");
    const s = calculateStrength(pwd);
    bar.style.width = `${s}%`;
    let color = "#f87171";
    let name = "Weak";
    if (s >= 85) {
      color = "#10b981";
      name = "Strong";
    } else if (s >= 70) {
      color = "#34d399";
      name = "Good";
    } else if (s >= 40) {
      color = "#fbbf24";
      name = "Fair";
    }
    bar.style.backgroundColor = color;
    label.textContent = pwd ? `Strength: ${name} (${s}/100)` : "Strength: —";
    label.style.color = pwd ? color : "#64748b";
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
    const pwd = generatePassword();
    document.getElementById("gen-password").value = pwd;
    updateStrengthMeter(pwd);
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
    pane.setAttribute("role", "list");
    pane.removeEventListener("keydown", listKeyNav);
    pane.addEventListener("keydown", listKeyNav);
    if (list.length === 0) {
      emptyState(pane, "No new logins captured yet.\nLog in on a site and it will appear here.", "saved");
      return;
    }
    const canSave = appStatus.running && appStatus.unlocked;
    list.forEach((item, idx) => {
      const row = entryRow({
        title: item.title || item.domain,
        subtitle: item.username,
        domain: item.domain,
        delay: idx * 25,
        actions: [],
      });
      const meta = row.querySelector(".meta");
      const pwd = el("div", "pwd-mask", "••••••••");
      meta.appendChild(pwd);

      const act = row.querySelector(".actions");
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
      pane.appendChild(row);
    });
  }

  // ---------- Settings pane ----------

  function fmtTime(ts) {
    try {
      return new Date(ts).toLocaleString();
    } catch (e) {
      return String(ts);
    }
  }

  function makeSwitch(labelText, checked, onChange) {
    const row = el("div", "set-row");
    const sw = el("span", "switch");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = !!checked;
    input.setAttribute("aria-label", labelText);
    const track = el("span", "track");
    sw.appendChild(input);
    sw.appendChild(track);
    input.addEventListener("change", () => onChange(input.checked));
    row.appendChild(el("label", "main", labelText));
    row.appendChild(sw);
    return row;
  }

  async function renderSettings() {
    const pane = panes.settings;
    pane.innerHTML = "";

    // ----- Appearance -----
    const g1 = el("div", "set-group");
    g1.appendChild(el("h3", null, "Appearance"));
    const densRow = el("div", "set-row");
    densRow.appendChild(el("label", "main", "List density"));
    const dens = document.createElement("select");
    dens.setAttribute("aria-label", "List density");
    for (const [v, label] of [["compact", "Compact"], ["cozy", "Cozy"], ["spacious", "Spacious"]]) {
      const o = document.createElement("option");
      o.value = v;
      o.textContent = label;
      if (settings.density === v) o.selected = true;
      dens.appendChild(o);
    }
    dens.addEventListener("change", async () => {
      settings.density = dens.value;
      await saveSettings();
      applySettings();
      if (allEntries) renderAllList();
    });
    densRow.appendChild(dens);
    g1.appendChild(densRow);

    const fsRow = el("div", "set-row");
    fsRow.appendChild(el("label", "main", `Font size (${settings.fontScale}%)`));
    const fs = document.createElement("input");
    fs.type = "range";
    fs.min = "85";
    fs.max = "130";
    fs.step = "5";
    fs.value = String(settings.fontScale);
    fs.setAttribute("aria-label", "Font size percent");
    fs.style.flex = "1";
    fs.addEventListener("input", async () => {
      settings.fontScale = parseInt(fs.value, 10);
      fsRow.querySelector("label").textContent = `Font size (${settings.fontScale}%)`;
      applySettings();
    });
    fs.addEventListener("change", saveSettings);
    fsRow.appendChild(fs);
    g1.appendChild(fsRow);

    g1.appendChild(makeSwitch("High contrast", settings.highContrast, async (v) => {
      settings.highContrast = v;
      await saveSettings();
      applySettings();
    }));
    g1.appendChild(makeSwitch("Reduce motion", settings.reduceMotion, async (v) => {
      settings.reduceMotion = v;
      await saveSettings();
      applySettings();
    }));
    g1.appendChild(makeSwitch("Show site favicons", settings.favicons, async (v) => {
      settings.favicons = v;
      await saveSettings();
      if (activeTab === "site") renderSite();
      if (activeTab === "all" && allEntries) renderAllList();
      if (activeTab === "saved") renderSaved();
    }));
    pane.appendChild(g1);

    // ----- Auto-backup -----
    const g2 = el("div", "set-group");
    g2.appendChild(el("h3", null, "Auto-backup"));
    const backupInfo = el("div", "set-note", "Loading…");
    let backupSettings = { enabled: false, intervalMinutes: 60 };

    const applyBackupInfo = (last) => {
      backupInfo.textContent = last
        ? `Last backup: ${fmtTime(last.at)} — ${last.ok ? "OK" : last.error || "failed"}`
        : "No backup has run yet from the extension.";
    };

    const res = await send({ type: "GET_BACKUP_SETTINGS" });
    if (res.success && res.data) {
      backupSettings = res.data.settings || backupSettings;
      applyBackupInfo(res.data.last);
    } else {
      backupInfo.textContent = "Status unavailable.";
    }

    g2.appendChild(
      makeSwitch("Back up vault on schedule", backupSettings.enabled, async (v) => {
        backupSettings.enabled = v;
        await send({
          type: "SET_BACKUP_SETTINGS",
          enabled: v,
          intervalMinutes: backupSettings.intervalMinutes,
        });
      })
    );

    const ivRow = el("div", "set-row");
    ivRow.appendChild(el("label", "main", "Interval"));
    const iv = document.createElement("select");
    iv.setAttribute("aria-label", "Backup interval");
    for (const [mins, label] of [[15, "15 minutes"], [60, "1 hour"], [360, "6 hours"], [1440, "1 day"], [10080, "7 days"]]) {
      const o = document.createElement("option");
      o.value = String(mins);
      o.textContent = label;
      if (backupSettings.intervalMinutes === mins) o.selected = true;
      iv.appendChild(o);
    }
    iv.addEventListener("change", async () => {
      backupSettings.intervalMinutes = parseInt(iv.value, 10);
      await send({
        type: "SET_BACKUP_SETTINGS",
        enabled: backupSettings.enabled,
        intervalMinutes: backupSettings.intervalMinutes,
      });
    });
    ivRow.appendChild(iv);
    g2.appendChild(ivRow);
    g2.appendChild(backupInfo);

    const runRow = el("div", "set-row");
    const runBtn = el("button", "btn", "Back up now");
    runBtn.addEventListener("click", async () => {
      runBtn.disabled = true;
      backupInfo.textContent = "Backing up…";
      const r = await send({ type: "RUN_BACKUP" });
      runBtn.disabled = false;
      if (r.success && r.data) {
        applyBackupInfo(r.data);
        showToast(r.data.ok ? "Backup done" : "Backup failed");
      } else {
        backupInfo.textContent = `Backup failed: ${r.error || "unknown error"}`;
      }
    });
    runRow.appendChild(runBtn);
    g2.appendChild(runRow);
    const note = el(
      "div",
      "set-note",
      "Backup settings (folder and copy limit) are configured in the Mynx desktop app. Backup runs while the browser is open; the vault stays on your PC."
    );
    g2.appendChild(note);
    pane.appendChild(g2);

    // ----- Passkeys -----
    const g3 = el("div", "set-group");
    g3.appendChild(el("h3", null, "Passkeys"));
    g3.appendChild(
      el(
        "div",
        "set-note",
        "Passkeys are created, stored and self-tested in the Mynx desktop app (Passkeys section). Your browser's built-in passkey prompts keep working as usual — keys never leave the encrypted vault."
      )
    );
    pane.appendChild(g3);
  }

  // ---------- init ----------

  async function init() {
    await loadSettings();
    applySettings();
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
