// Mynx content script: inline autofill icons, account dropdown, save capture.
// No credentials persist here; everything goes through the background worker.

(function () {
  const PROCESSED_ATTR = "data-mynx-icon";
  const ICON_CLASS = "mynx-inline-icon";
  const DROPDOWN_ID = "mynx-dropdown";

  const USERNAME_SELECTORS = [
    'input[name="username"]',
    'input[autocomplete="username"]',
    'input[autocomplete="email"]',
    'input[type="email"]',
    'input[name*="user" i]',
    'input[id*="user" i]',
    'input[name*="login" i]',
    'input[id*="login" i]',
    'input[name*="email" i]',
    'input[id*="email" i]',
  ].join(", ");

  const OTP_RE = /(otp|2fa|totp|code)/i;

  function getDomain() {
    return window.location.hostname.replace(/^www\./, "");
  }

  function isVisible(el) {
    if (!el || el.disabled || el.type === "hidden") return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function findPasswordFields() {
    return Array.from(document.querySelectorAll('input[type="password"]')).filter(isVisible);
  }

  function findUsernameField(near) {
    const scope = (near && near.form) || document;
    const candidates = Array.from(scope.querySelectorAll(USERNAME_SELECTORS)).filter(
      (el) => isVisible(el) && el.type !== "password"
    );
    return candidates[0] || null;
  }

  function findOtpField() {
    const inputs = Array.from(
      document.querySelectorAll('input[type="text"], input[type="tel"], input[type="number"], input:not([type])')
    );
    return (
      inputs.find((el) => {
        if (!isVisible(el)) return false;
        const hay = `${el.name || ""} ${el.id || ""} ${el.autocomplete || ""}`;
        return OTP_RE.test(hay);
      }) || null
    );
  }

  // React-compatible value setter: native setter + bubbling events.
  function fillField(input, value) {
    if (!input || value == null) return;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function fillCredentials({ username, password, totp }) {
    const pwdFields = findPasswordFields();
    const pwdField = pwdFields[0] || null;
    const userField = findUsernameField(pwdField);
    if (userField && username) fillField(userField, username);
    if (pwdField && password) fillField(pwdField, password);
    if (totp) {
      const otpField = findOtpField();
      if (otpField) fillField(otpField, totp);
    }
  }

  // ---------- Inline icons ----------

  const LOCK_SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" ' +
    'stroke="#10b981" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<rect x="3" y="11" width="18" height="11" rx="2"/>' +
    '<path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>';

  function positionIcon(icon, field) {
    const rect = field.getBoundingClientRect();
    // Зона справа: иконки сайта (origPad) + место под нашу иконку (24px), см. addIcon.
    const rightZone = field._mynxReserved || 26;
    icon.style.setProperty("top", `${window.scrollY + rect.top + (rect.height - 18) / 2}px`, "important");
    icon.style.setProperty("left", `${window.scrollX + rect.right - rightZone}px`, "important");
  }

  function addIcon(field) {
    if (field.hasAttribute(PROCESSED_ATTR) && field._mynxIcon && document.contains(field._mynxIcon)) return;
    field.setAttribute(PROCESSED_ATTR, "1");

    // Сайт резервирует место под свои иконки (глаз и т.п.) через padding-right.
    // Ставим нашу иконку левее этой зоны и расширяем padding, чтобы текст не уходил под неё.
    const origPad = parseFloat(getComputedStyle(field).paddingRight) || 0;
    const reserved = Math.min(Math.max(origPad, 8), 120);
    field._mynxReserved = reserved + 24;
    field.style.setProperty("padding-right", `${origPad + 24}px`, "important");

    const icon = document.createElement("div");
    icon.className = ICON_CLASS;
    icon.innerHTML = LOCK_SVG;
    icon.title = "Mynx: fill login";
    icon.style.cssText =
      "position:absolute !important; width:18px !important; height:18px !important; " +
      "cursor:pointer !important; z-index:2147483647 !important; line-height:0 !important; " +
      "padding:0 !important; margin:0 !important; background:transparent !important;";

    icon.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      onIconClick(field, icon);
    });

    document.body.appendChild(icon);
    positionIcon(icon, field);
    field._mynxIcon = icon;
  }

  function repositionAll() {
    for (const icon of document.querySelectorAll("." + ICON_CLASS)) {
      const field = icon._mynxField;
      if (field && document.contains(field)) {
        positionIcon(icon, field);
      }
    }
  }

  // Удаляем иконки удалённых полей и прячем иконки скрытых (после логина поля часто уходят из DOM).
  function cleanupIcons() {
    for (const icon of document.querySelectorAll("." + ICON_CLASS)) {
      const field = icon._mynxField;
      if (!field || !document.contains(field)) {
        icon.remove();
      } else if (!isVisible(field)) {
        icon.style.setProperty("display", "none", "important");
      } else {
        icon.style.removeProperty("display");
      }
    }
  }

  function scanFields() {
    cleanupIcons();
    const targets = new Set();
    for (const pwd of findPasswordFields()) {
      targets.add(pwd);
      const user = findUsernameField(pwd);
      if (user) targets.add(user);
    }
    // Standalone username fields (multi-step login forms).
    if (targets.size === 0) {
      const user = findUsernameField(null);
      if (user) targets.add(user);
    }
    for (const field of targets) {
      addIcon(field);
      const icon = field._mynxIcon;
      if (icon) icon._mynxField = field;
    }
  }

  // ---------- Dropdown ----------

  function closeDropdown() {
    const dd = document.getElementById(DROPDOWN_ID);
    if (dd) dd.remove();
    document.removeEventListener("mousedown", onOutsideClick, true);
    document.removeEventListener("keydown", onEscape, true);
  }

  function onOutsideClick(e) {
    const dd = document.getElementById(DROPDOWN_ID);
    if (dd && !dd.contains(e.target) && !(e.target.closest && e.target.closest("." + ICON_CLASS))) {
      closeDropdown();
    }
  }

  function onEscape(e) {
    if (e.key === "Escape") closeDropdown();
  }

  function showDropdown(anchorField, buildContent) {
    closeDropdown();

    const dd = document.createElement("div");
    dd.id = DROPDOWN_ID;
    dd.style.cssText =
      "position:absolute !important; z-index:2147483647 !important; min-width:240px !important; " +
      "max-width:320px !important; max-height:260px !important; overflow-y:auto !important; " +
      "background:#0a0a0f !important; border:1px solid #1f2937 !important; border-radius:10px !important; " +
      "box-shadow:0 8px 24px rgba(0,0,0,0.6) !important; padding:4px !important; " +
      "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif !important;";

    const rect = anchorField.getBoundingClientRect();
    dd.style.setProperty("top", `${window.scrollY + rect.bottom + 4}px`, "important");
    dd.style.setProperty("left", `${window.scrollX + rect.left}px`, "important");

    document.body.appendChild(dd);
    buildContent(dd);

    document.addEventListener("mousedown", onOutsideClick, true);
    document.addEventListener("keydown", onEscape, true);
  }

  function dropdownItem(dd, { title, subtitle, onClick }) {
    const item = document.createElement("div");
    item.style.cssText =
      "padding:8px 10px !important; border-radius:6px !important; cursor:pointer !important; " +
      "display:flex !important; flex-direction:column !important; gap:2px !important;";
    item.innerHTML =
      `<span style="color:#e5e7eb !important; font-size:13px !important; font-weight:600 !important; ` +
      `white-space:nowrap !important; overflow:hidden !important; text-overflow:ellipsis !important;"></span>` +
      `<span style="color:#64748b !important; font-size:12px !important; ` +
      `white-space:nowrap !important; overflow:hidden !important; text-overflow:ellipsis !important;"></span>`;
    item.children[0].textContent = title;
    item.children[1].textContent = subtitle || "";
    item.addEventListener("mouseenter", () => {
      item.style.setProperty("background", "rgba(16,185,129,0.15)", "important");
    });
    item.addEventListener("mouseleave", () => {
      item.style.setProperty("background", "transparent", "important");
    });
    if (onClick) {
      item.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
      });
    } else {
      item.style.setProperty("cursor", "default", "important");
    }
    dd.appendChild(item);
  }

  function onIconClick(field) {
    showDropdown(field, (dd) => {
      dropdownItem(dd, { title: "Loading...", subtitle: "" });
    });

    chrome.runtime.sendMessage({ type: "LIST_CREDENTIALS", domain: getDomain() }, (response) => {
      if (chrome.runtime.lastError) {
        showDropdown(field, (dd) =>
          dropdownItem(dd, { title: "Mynx desktop is not running", subtitle: "" })
        );
        return;
      }
      showDropdown(field, (dd) => {
        if (!response || !response.success) {
          dropdownItem(dd, {
            title: "Mynx desktop is not running",
            subtitle: (response && response.error) || "",
          });
          return;
        }
        const data = response.data || {};
        if (data.error === "vault_locked") {
          dropdownItem(dd, { title: "Vault is locked — unlock Mynx desktop", subtitle: "" });
          return;
        }
        if (data.error === "pairing_required" || data.error === "pairing_denied") {
          dropdownItem(dd, { title: "Confirm access in the Mynx desktop app", subtitle: "" });
          return;
        }
        const entries = Array.isArray(data.entries) ? data.entries : [];
        if (entries.length === 0) {
          dropdownItem(dd, { title: "No logins for this site", subtitle: "" });
          return;
        }
        for (const entry of entries) {
          dropdownItem(dd, {
            title: entry.title || entry.username || "Login",
            subtitle: entry.username || "",
            onClick: () => {
              fillCredentials(entry);
              closeDropdown();
            },
          });
        }
      });
    });
  }

  // ---------- Save capture ----------

  function savePending(entry) {
    chrome.storage.session.get("pendingSaves", (result) => {
      const list = Array.isArray(result.pendingSaves) ? result.pendingSaves : [];
      const idx = list.findIndex((p) => p.domain === entry.domain && p.username === entry.username);
      if (idx >= 0) {
        list[idx] = entry; // refresh changed password
      } else {
        list.push(entry);
      }
      chrome.storage.session.set({ pendingSaves: list }, () => {
        chrome.runtime.sendMessage({ type: "PENDING_SAVE_ADDED" });
      });
    });
  }

  function captureSubmit() {
    const pwdField = findPasswordFields()[0];
    if (!pwdField || !pwdField.value) return;
    const userField = findUsernameField(pwdField);
    const username = userField ? userField.value : "";
    if (!username) return;
    savePending({
      domain: getDomain(),
      username,
      password: pwdField.value,
      url: location.origin,
      title: document.title,
    });
  }

  document.addEventListener(
    "submit",
    () => {
      captureSubmit();
    },
    true
  );

  document.addEventListener(
    "click",
    (e) => {
      const btn = e.target.closest && e.target.closest('button[type="submit"], input[type="submit"]');
      if (btn) captureSubmit();
    },
    true
  );

  // ---------- Messages from popup ----------

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request && request.type === "FILL_CREDENTIALS") {
      fillCredentials(request);
      sendResponse({ success: true });
      return false;
    }
    if (request && request.type === "GET_FORM_CREDENTIALS") {
      const pwdFields = findPasswordFields();
      const pwdField = pwdFields[0] || null;
      const userField = findUsernameField(pwdField);
      sendResponse({
        success: true,
        username: userField ? userField.value : "",
        password: pwdField ? pwdField.value : "",
      });
      return false;
    }
    return false;
  });

  // ---------- Lifecycle ----------

  let scanTimer = null;
  function scheduleScan() {
    if (scanTimer) clearTimeout(scanTimer);
    scanTimer = setTimeout(scanFields, 300);
  }

  function init() {
    scanFields();
    window.addEventListener("scroll", repositionAll, true);
    window.addEventListener("resize", repositionAll);
    new MutationObserver(scheduleScan).observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
