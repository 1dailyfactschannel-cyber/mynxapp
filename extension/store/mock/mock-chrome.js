// Mock chrome.* API for Chrome Web Store screenshots.
// Real popup.js / content.js run against this; data is demo-only, no real secrets.
(function () {
  var SITE_ENTRIES = [
    {
      title: "GitHub — personal",
      username: "jane.dev",
      password: "Tr7$kM9!pQ2wLx8z",
      url: "https://github.com",
      totp: null,
    },
    {
      title: "GitHub — work",
      username: "jane@acme.dev",
      password: "Wq4#Zn82vB!sD61f",
      url: "https://github.com",
      totp: null,
    },
    {
      title: "GitHub (CI bot)",
      username: "ci-bot-acme",
      password: "bX5!rT0$mN8vQz2w",
      url: "https://github.com",
      totp: null,
    },
  ];

  var ALL_ENTRIES = [
    { title: "GitHub — personal", username: "jane.dev", url: "https://github.com" },
    { title: "GitHub — work", username: "jane@acme.dev", url: "https://github.com" },
    { title: "GitLab", username: "jane.dev", url: "https://gitlab.com" },
    { title: "DigitalOcean", username: "jane@acme.dev", url: "https://cloud.digitalocean.com" },
    { title: "Bitbucket", username: "jane.dev", url: "https://bitbucket.org" },
    { title: "Gmail", username: "jane.dev.mail@gmail.com", url: "https://mail.google.com" },
    { title: "Notion", username: "jane@acme.dev", url: "https://notion.so" },
    { title: "AWS Console", username: "acme-root-admin", url: "https://console.aws.amazon.com" },
    { title: "Figma", username: "jane@acme.dev", url: "https://figma.com" },
  ];

  var sessionData = {
    pendingSaves: [
      {
        domain: "github.com",
        username: "jane.dev",
        password: "N3w!Passw0rd#2026",
        url: "https://github.com",
        title: "GitHub",
      },
      {
        domain: "gitlab.com",
        username: "jane.dev",
        password: "Lab$ecret7!xQ9",
        url: "https://gitlab.com",
        title: "GitLab",
      },
    ],
  };

  function asyncCb(cb, value) {
    setTimeout(function () {
      cb(value);
    }, 30);
  }

  var runtime = {
    lastError: null,
    sendMessage: function (msg, cb) {
      var res;
      switch (msg && msg.type) {
        case "GET_STATUS":
          res = { success: true, data: { running: true, unlocked: true } };
          break;
        case "LIST_CREDENTIALS":
          res = { success: true, data: { entries: SITE_ENTRIES } };
          break;
        case "SEARCH_CREDENTIALS":
          res = { success: true, data: { entries: ALL_ENTRIES } };
          break;
        case "SAVE_CREDENTIAL":
          res = { success: true, data: { success: true } };
          break;
        case "PENDING_SAVE_ADDED":
          res = { success: true, data: {} };
          break;
        default:
          res = { success: true, data: {} };
      }
      if (typeof cb === "function") asyncCb(cb, res);
      return Promise.resolve(res);
    },
    onMessage: {
      addListener: function () {},
    },
  };

  var tabs = {
    query: function (queryInfo, cb) {
      var result = [{ id: 1, url: "https://github.com/login", active: true, title: "Sign in to GitHub" }];
      if (typeof cb === "function") asyncCb(cb, result);
      return Promise.resolve(result);
    },
    create: function () {},
    sendMessage: function () {},
  };

  var storageSession = {
    get: function (key, cb) {
      var out = {};
      if (typeof key === "string") {
        out[key] = sessionData[key];
      } else {
        for (var k in sessionData) out[k] = sessionData[k];
      }
      asyncCb(cb, out);
    },
    set: function (obj, cb) {
      for (var k in obj) sessionData[k] = obj[k];
      if (typeof cb === "function") asyncCb(cb);
    },
  };

  window.chrome = {
    runtime: runtime,
    tabs: tabs,
    storage: {
      session: storageSession,
      onChanged: { addListener: function () {} },
    },
    action: {
      setBadgeText: function () {},
      setBadgeBackgroundColor: function () {},
    },
  };
})();
