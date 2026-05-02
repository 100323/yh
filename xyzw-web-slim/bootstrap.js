(function () {
  var DEFAULT_VERSION_URL = "version.json";
  var VERSION_BADGE_ID = "xyzw-version-badge";
  var APP_TITLE_ID = "xyzw-app-title";
  var RUNTIME_SETTINGS_KEY = "__XYZW_RUNTIME_SETTINGS__";
  var SLIM_LAUNCH_STORAGE_PREFIX = "xyzw-slim-launch:";
  var SLIM_LAST_ACCOUNT_KEY = "xyzw-slim-launch-account";
  var SLIM_RUNTIME_PATCH_TIMER = null;
  var BOOT_PATCH_LABEL = "remotefix-12";
  var DEBUG_PANEL_ID = "xyzw-slim-debug-panel";
  var DEBUG_LOGS = [];
  var DEBUG_COLLAPSED = false;
  var DEBUG_PANEL_ENABLED = false;
  var DEBUG_BUNDLE_STATE = {};
  var DEBUG_MANIFEST_STATE = {
    loaded: false,
    version: "",
    codeVersion: "",
    manifestUrl: "",
    manifestApplied: 0,
    source: "",
    updatedAt: "",
  };
  var DEBUG_STATUS_COLORS = {
    idle: "#8ea1b5",
    loading: "#5ac8fa",
    success: "#30d158",
    fallback: "#ff9f0a",
    error: "#ff453a",
  };
  var AUTO_CODE_VERSION = {
    enabled: true,
    baseVersion: "2.22.3",
    anchorFriday: "2026-04-03",
    timezoneOffsetMinutes: 8 * 60,
  };
  var DEFAULT_MANIFEST_CONFIG = {
    enabled: true,
    proxyUrl: "/api/slim/manifest",
    url: "https://xxz-xyzw.hortorgames.com/login/manifest?platform=hortor&version=0.32.0-ios",
    method: "POST",
    mode: "cors",
    credentials: "omit",
    cache: "no-store",
    headers: {
      Accept: "application/json, text/plain, */*",
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
    },
    body: "",
  };
  var MANIFEST_CACHE_PREFIX = "xyzw-slim-manifest-cache:";
  var MANIFEST_CACHE_TTL_MS = 5 * 60 * 1000;
  var MANIFEST_FETCH_TIMEOUT_MS = 2500;
  var DEFAULT_JSC_CONFIG = {
    enabled: true,
    bundles: ["launcher", "game", "TEST_REMOTE_MODULE"],
    remoteRoot: "remote",
    configPrefetch: true,
    cacheVersionsPerBundle: 3,
  };

  function clonePlainObject(source) {
    var target = {};
    if (!source || typeof source !== "object") {
      return target;
    }

    Object.keys(source).forEach(function (key) {
      target[key] = source[key];
    });
    return target;
  }

  function toIsoTime(value) {
    try {
      var date = value ? new Date(value) : new Date();
      if (Number.isNaN(date.getTime())) {
        return "";
      }
      return date.toISOString().replace("T", " ").replace("Z", "");
    } catch (error) {
      return "";
    }
  }

  function escapeDebugHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function ensureDebugBundleState(bundleName) {
    var key = String(bundleName || "").trim();
    if (!key) {
      return null;
    }
    if (!DEBUG_BUNDLE_STATE[key]) {
      DEBUG_BUNDLE_STATE[key] = {
        bundle: key,
        targetVersion: "",
        actualVersion: "",
        source: "",
        stage: "等待启动",
        status: "idle",
        message: "",
        lastEvent: "",
        updatedAt: "",
      };
    }
    return DEBUG_BUNDLE_STATE[key];
  }

  function getTrackedDebugBundles() {
    var settings = getSettingsObject();
    var bundles = [];
    var source = Array.isArray(settings && settings.jscBundles) && settings.jscBundles.length > 0
      ? settings.jscBundles
      : DEFAULT_JSC_CONFIG.bundles;
    source.forEach(function (name) {
      if (typeof name === "string" && name && bundles.indexOf(name) === -1) {
        bundles.push(name);
      }
    });
    return bundles;
  }

  function refreshDebugBundleTargets() {
    getTrackedDebugBundles().forEach(function (bundleName) {
      var state = ensureDebugBundleState(bundleName);
      if (!state) {
        return;
      }
      var version = resolveRuntimeBundleVersion(bundleName);
      if (version) {
        state.targetVersion = version;
      }
      if (!state.updatedAt) {
        state.updatedAt = toIsoTime();
      }
    });
  }

  function updateDebugBundleState(bundleName, patch) {
    var state = ensureDebugBundleState(bundleName);
    if (!state || !patch || typeof patch !== "object") {
      return;
    }
    Object.keys(patch).forEach(function (key) {
      if (patch[key] !== undefined) {
        state[key] = patch[key];
      }
    });
    state.updatedAt = toIsoTime();
  }

  function handleJscRuntimeDebug(label, payload) {
    if (!payload || typeof payload !== "object" || !payload.bundle) {
      return;
    }

    var bundleName = String(payload.bundle || "");
    var message = payload.message || payload.url || payload.cache || payload.source || "";
    var version = payload.version ? String(payload.version) : "";
    var currentState = ensureDebugBundleState(bundleName) || {};
    refreshDebugBundleTargets();

    switch (label) {
      case "bundle-load-start":
        updateDebugBundleState(bundleName, {
          actualVersion: version || resolveRuntimeBundleVersion(bundleName),
          stage: "开始加载 Bundle",
          status: "loading",
          source: "待定",
          message: message,
          lastEvent: label,
        });
        break;
      case "bundle-cache-hit":
        updateDebugBundleState(bundleName, {
          actualVersion: version || resolveRuntimeBundleVersion(bundleName),
          stage: "命中缓存",
          status: "loading",
          source: payload.cache === "memory" ? "内存缓存" : "IndexedDB 缓存",
          message: payload.cache || "",
          lastEvent: label,
        });
        break;
      case "remote-script-request":
        updateDebugBundleState(bundleName, {
          actualVersion: version || resolveRuntimeBundleVersion(bundleName),
          stage: "请求远程 JSC",
          status: "loading",
          source: "远程 JSC",
          message: payload.url || "",
          lastEvent: label,
        });
        break;
      case "remote-config-request":
        updateDebugBundleState(bundleName, {
          stage: "请求远程配置",
          status: "loading",
          message: payload.url || "",
          lastEvent: label,
        });
        break;
      case "remote-config-ok":
        updateDebugBundleState(bundleName, {
          stage: "配置已到位",
          status: "loading",
          message: payload.via || "",
          lastEvent: label,
        });
        break;
      case "decrypt-ok":
        updateDebugBundleState(bundleName, {
          actualVersion: version || resolveRuntimeBundleVersion(bundleName),
          stage: "JSC 解密成功",
          status: "loading",
          source: payload.mode === "bridge" ? "Native Bridge" : "远程 JSC",
          message: (payload.mode || "") + (payload.offset !== undefined ? " / offset " + payload.offset : ""),
          lastEvent: label,
        });
        break;
      case "bundle-script-loaded":
        updateDebugBundleState(bundleName, {
          actualVersion: version || resolveRuntimeBundleVersion(bundleName),
          stage: "脚本已注入执行",
          status: payload.source === "local" ? "fallback" : "success",
          source: payload.source === "local"
            ? "本地 JS"
            : (currentState.source && /缓存/.test(currentState.source))
              ? currentState.source
              : payload.source === "bridge"
                ? "Native Bridge"
                : "远程 JSC",
          message: payload.mode || "",
          lastEvent: label,
        });
        break;
      case "bundle-remote-ok":
        updateDebugBundleState(bundleName, {
          actualVersion: version || resolveRuntimeBundleVersion(bundleName),
          stage: "自动更新生效",
          status: "success",
          source: (currentState.source && /缓存/.test(currentState.source))
            ? currentState.source
            : payload.source === "bridge"
              ? "Native Bridge"
              : "远程 JSC",
          message: (currentState.source && /缓存/.test(currentState.source)) ? "已使用缓存中的远程 JSC" : "已使用远程 JSC",
          lastEvent: label,
        });
        break;
      case "bundle-remote-failed":
        updateDebugBundleState(bundleName, {
          actualVersion: version || resolveRuntimeBundleVersion(bundleName),
          stage: "远程 JSC 失败",
          status: "error",
          source: "远程 JSC",
          message: payload.message || "",
          lastEvent: label,
        });
        break;
      case "local-package-ok":
        updateDebugBundleState(bundleName, {
          actualVersion: version || resolveRuntimeBundleVersion(bundleName),
          stage: "本地 JS 可回退",
          status: "fallback",
          source: "本地 JS",
          message: payload.scriptUrl || "",
          lastEvent: label,
        });
        break;
      case "bundle-local-fallback":
        updateDebugBundleState(bundleName, {
          actualVersion: payload.actualVersion ? String(payload.actualVersion) : (version || resolveRuntimeBundleVersion(bundleName)),
          stage: "已回退本地 JS",
          status: "fallback",
          source: "本地 JS",
          message: payload.remoteError || "",
          lastEvent: label,
        });
        break;
      default:
        updateDebugBundleState(bundleName, {
          actualVersion: version || resolveRuntimeBundleVersion(bundleName),
          message: message,
          lastEvent: label,
        });
        break;
    }
  }

  function ensureDebugPanel() {
    return null;
  }

  function renderDebugPanel() {
    return;
  }

  function appendDebugLog(label, payload) {
    return;
  }

  function shouldTraceNetwork(url) {
    var text = String(url || "");
    return (
      text.indexOf("login/authuser") !== -1 ||
      text.indexOf("login/serverlist") !== -1 ||
      text.indexOf("login/rolequery") !== -1 ||
      text.indexOf("login/manifest") !== -1
    );
  }

  function shouldTraceStorageKey(key) {
    var text = String(key || "");
    return (
      text.indexOf("xyzw-slim-launch") !== -1 ||
      text === "userId" ||
      text === "_fakeAuthed"
    );
  }

  function summarizeValue(value, limit) {
    var text = String(value == null ? "" : value);
    return {
      length: text.length,
      preview: text.slice(0, limit || 220),
    };
  }

  function patchStorageDebug(target, label) {
    if (!target || target.__xyzwStorageDebugPatched) {
      return;
    }

    var originalGetItem = typeof target.getItem === "function" ? target.getItem.bind(target) : null;
    var originalSetItem = typeof target.setItem === "function" ? target.setItem.bind(target) : null;
    var originalRemoveItem = typeof target.removeItem === "function" ? target.removeItem.bind(target) : null;

    if (originalGetItem) {
      target.getItem = function (key) {
        var result = originalGetItem(key);
        if (shouldTraceStorageKey(key)) {
          appendDebugLog(label + "-getItem", {
            key: String(key || ""),
            hit: result != null,
            value: summarizeValue(result),
          });
        }
        return result;
      };
    }

    if (originalSetItem) {
      target.setItem = function (key, value) {
        if (shouldTraceStorageKey(key)) {
          appendDebugLog(label + "-setItem", {
            key: String(key || ""),
            value: summarizeValue(value),
          });
        }
        return originalSetItem(key, value);
      };
    }

    if (originalRemoveItem) {
      target.removeItem = function (key) {
        if (shouldTraceStorageKey(key)) {
          appendDebugLog(label + "-removeItem", { key: String(key || "") });
        }
        return originalRemoveItem(key);
      };
    }

    target.__xyzwStorageDebugPatched = true;
    appendDebugLog(label + "-debug-patched");
  }

  function patchGlobalErrorDebug() {
    if (window.__xyzwGlobalErrorDebugPatched) {
      return;
    }

    window.__xyzwGlobalErrorDebugPatched = true;
    window.addEventListener("error", function (event) {
      appendDebugLog("window-error", {
        message: event && event.message ? event.message : "",
        source: event && event.filename ? event.filename : "",
        line: event && event.lineno ? event.lineno : 0,
        column: event && event.colno ? event.colno : 0,
        stack: event && event.error && event.error.stack ? String(event.error.stack).slice(0, 2000) : "",
      });
    });

    window.addEventListener("unhandledrejection", function (event) {
      var reason = event ? event.reason : null;
      appendDebugLog("unhandled-rejection", {
        message: reason && reason.message ? reason.message : String(reason == null ? "" : reason),
        stack: reason && reason.stack ? String(reason.stack).slice(0, 2000) : "",
      });
    });

    var originalAlert = window.alert;
    if (typeof originalAlert === "function") {
      window.alert = function (message) {
        appendDebugLog("window-alert", String(message == null ? "" : message).slice(0, 1000));
        return originalAlert.apply(window, arguments);
      };
    }

    appendDebugLog("global-error-debug-patched");
  }

  function hasQueryFlag(name) {
    var key = String(name || "").trim();
    if (!key) {
      return false;
    }

    try {
      var search = new URLSearchParams(window.location.search || "");
      return search.get(key) === "1";
    } catch (error) {
      return false;
    }
  }

  function isEmbedMode() {
    return hasQueryFlag("embed");
  }

  function isRuntimeShellMode() {
    return hasQueryFlag("runtimeShell");
  }

  function applyEmbedModeStyles() {
    var embedMode = isEmbedMode();
    var runtimeShellMode = isRuntimeShellMode();
    if (!embedMode && !runtimeShellMode) {
      return;
    }

    if (document.getElementById("xyzw-embed-cover-style")) {
      return;
    }

    var style = document.createElement("style");
    style.id = "xyzw-embed-cover-style";
    style.textContent = [
      "html, body { width: 100% !important; height: 100% !important; margin: 0 !important; background: #050912 !important; overflow: hidden !important; overscroll-behavior: none !important; }",
      "body.xyzw-embed-mode, body.xyzw-runtime-shell-mode { overflow: hidden !important; }",
      "body.xyzw-embed-mode #Cocos2dGameContainer, body.xyzw-runtime-shell-mode #Cocos2dGameContainer { position: absolute !important; inset: 0 !important; width: 100% !important; height: 100% !important; margin: 0 !important; display: block !important; overflow: hidden !important; }",
      "body.xyzw-embed-mode #GameCanvas, body.xyzw-runtime-shell-mode #GameCanvas, body.xyzw-embed-mode canvas, body.xyzw-runtime-shell-mode canvas { position: absolute !important; inset: 0 !important; width: 100% !important; height: 100% !important; object-fit: cover !important; background: transparent !important; }",
      "body.xyzw-embed-mode #splash, body.xyzw-runtime-shell-mode #splash { background-color: #050912 !important; background-size: 36% !important; }",
    ].join("");
    document.head.appendChild(style);
    if (embedMode) {
      document.documentElement.classList.add("xyzw-embed-mode");
    }
    if (runtimeShellMode) {
      document.documentElement.classList.add("xyzw-runtime-shell-mode");
    }
    if (document.body) {
      if (embedMode) {
        document.body.classList.add("xyzw-embed-mode");
      }
      if (runtimeShellMode) {
        document.body.classList.add("xyzw-runtime-shell-mode");
      }
    } else {
      document.addEventListener("DOMContentLoaded", function () {
        if (document.body) {
          if (embedMode) {
            document.body.classList.add("xyzw-embed-mode");
          }
          if (runtimeShellMode) {
            document.body.classList.add("xyzw-runtime-shell-mode");
          }
        }
      }, { once: true });
    }
    appendDebugLog("embed-mode-style-applied");
  }

  var RUNTIME_USER_SCRIPT_KEY = "xyzw-runtime-user-script";

  function getRuntimeUserScriptRecord() {
    if (!isRuntimeShellMode()) {
      return null;
    }

    try {
      var raw = window.localStorage ? window.localStorage.getItem(RUNTIME_USER_SCRIPT_KEY) : "";
      if (!raw) {
        return null;
      }

      var payload = JSON.parse(raw);
      if (!payload || payload.enabled === false || !payload.code) {
        return null;
      }

      return {
        fileName: String(payload.fileName || "imported-script.js"),
        code: String(payload.code || ""),
        updatedAt: String(payload.updatedAt || ""),
      };
    } catch (error) {
      console.warn("[runtime-user-script] failed to read imported script", error);
      appendDebugLog("runtime-user-script-read-failed", {
        message: error && error.message ? error.message : String(error),
      });
      return null;
    }
  }

  function injectRuntimeUserScript() {
    var payload = getRuntimeUserScriptRecord();
    if (!payload) {
      return false;
    }

    if (window.__XYZWRuntimeUserScriptInjected) {
      return true;
    }

    try {
      var script = document.createElement("script");
      script.type = "text/javascript";
      script.id = "xyzw-runtime-user-script";
      script.dataset.fileName = payload.fileName;
      script.dataset.updatedAt = payload.updatedAt;
      script.textContent = payload.code + "\n//# sourceURL=xyzw-imported-user-script-" + encodeURIComponent(payload.fileName).replace(/%/g, "_") + "\n";
      (document.head || document.documentElement || document.body).appendChild(script);
      window.__XYZWRuntimeUserScriptInjected = {
        fileName: payload.fileName,
        updatedAt: payload.updatedAt,
      };
      console.info("[runtime-user-script] injected", payload.fileName);
      appendDebugLog("runtime-user-script-injected", {
        fileName: payload.fileName,
        updatedAt: payload.updatedAt,
      });
      return true;
    } catch (error) {
      console.warn("[runtime-user-script] inject failed", error);
      appendDebugLog("runtime-user-script-inject-failed", {
        fileName: payload.fileName,
        message: error && error.message ? error.message : String(error),
      });
      return false;
    }
  }

  function patchRuntimeShellFullscreen() {
    if (!isRuntimeShellMode()) {
      return false;
    }

    if (window.__XYZWRuntimeShellFullscreenPatched) {
      return true;
    }

    window.__XYZWRuntimeShellFullscreenPatched = true;

    function patchPrototypeMethod(target, key, replacement, label) {
      if (!target || typeof target[key] !== "function" || target[key].__xyzwRuntimeShellPatched) {
        return false;
      }

      var original = target[key];
      var wrapped = function () {
        appendDebugLog(label || "runtime-shell-fullscreen-blocked");
        return replacement.apply(this, arguments);
      };
      wrapped.__xyzwRuntimeShellPatched = true;
      wrapped.__xyzwOriginal = original;
      target[key] = wrapped;
      return true;
    }

    function patchDocumentMethod(key) {
      return patchPrototypeMethod(
        Document.prototype,
        key,
        function () {
          return Promise.resolve(false);
        },
        "runtime-shell-document-" + key,
      );
    }

    function patchElementMethod(key) {
      return patchPrototypeMethod(
        Element.prototype,
        key,
        function () {
          return Promise.resolve(false);
        },
        "runtime-shell-element-" + key,
      );
    }

    patchElementMethod("requestFullscreen");
    patchElementMethod("webkitRequestFullScreen");
    patchElementMethod("webkitRequestFullscreen");
    patchElementMethod("mozRequestFullScreen");
    patchElementMethod("msRequestFullscreen");
    patchDocumentMethod("exitFullscreen");
    patchDocumentMethod("webkitCancelFullScreen");
    patchDocumentMethod("mozCancelFullScreen");
    patchDocumentMethod("msExitFullscreen");

    try {
      if (typeof document !== "undefined") {
        Object.defineProperty(document, "fullscreenEnabled", {
          configurable: true,
          enumerable: false,
          get: function () {
            return false;
          },
        });
      }
    } catch (error) {}

    try {
      if (window.cc && window.cc.screen) {
        if (typeof window.cc.screen.autoFullScreen === "function") {
          window.cc.screen.autoFullScreen = function () {
            appendDebugLog("runtime-shell-cc-screen-autoFullScreen-blocked");
            return false;
          };
        }
        if (typeof window.cc.screen.requestFullScreen === "function") {
          window.cc.screen.requestFullScreen = function () {
            appendDebugLog("runtime-shell-cc-screen-requestFullScreen-blocked");
            return false;
          };
        }
        if (typeof window.cc.screen.exitFullScreen === "function") {
          window.cc.screen.exitFullScreen = function () {
            appendDebugLog("runtime-shell-cc-screen-exitFullScreen-blocked");
            return false;
          };
        }
        if (typeof window.cc.screen.fullScreen === "function") {
          window.cc.screen.fullScreen = function () {
            return false;
          };
        }
      }

      if (window.cc && window.cc.view) {
        if (typeof window.cc.view.enableAutoFullScreen === "function") {
          window.cc.view.enableAutoFullScreen = function () {
            this._autoFullScreen = false;
            appendDebugLog("runtime-shell-cc-view-enableAutoFullScreen-blocked");
            return false;
          };
        }
        if (typeof window.cc.view.isAutoFullScreenEnabled === "function") {
          window.cc.view.isAutoFullScreenEnabled = function () {
            return false;
          };
        }
      }
    } catch (error) {
      appendDebugLog("runtime-shell-fullscreen-patch-error", {
        message: error && error.message ? error.message : String(error),
      });
    }

    appendDebugLog("runtime-shell-fullscreen-patched");
    return true;
  }

  function patchFetchDebug() {
    if (typeof window.fetch !== "function" || window.fetch.__xyzwDebugPatched) {
      return;
    }

    var originalFetch = window.fetch.bind(window);
    var patchedFetch = async function (input, init) {
      var url = typeof input === "string" ? input : (input && input.url) || "";
      if (shouldTraceNetwork(url) && String(url).indexOf("login/manifest?platform=hortor") === -1) {
        appendDebugLog("fetch-request", {
          url: String(url).slice(0, 220),
          method: (init && init.method) || "GET",
        });
      }

      try {
        var response = await originalFetch(input, init);
        if (shouldTraceNetwork(url) && String(url).indexOf("login/manifest?platform=hortor") === -1) {
          appendDebugLog("fetch-response", {
            url: String(url).slice(0, 220),
            status: response && response.status,
            ok: !!(response && response.ok),
          });
        }
        return response;
      } catch (error) {
        if (shouldTraceNetwork(url)) {
          appendDebugLog("fetch-error", {
            url: String(url).slice(0, 220),
            message: error && error.message ? error.message : String(error),
          });
        }
        throw error;
      }
    };

    patchedFetch.__xyzwDebugPatched = true;
    window.fetch = patchedFetch;
    if (typeof globalThis !== "undefined") {
      globalThis.fetch = patchedFetch;
    }
    appendDebugLog("fetch-debug-patched");
  }

  function toHexPreviewFromArrayBuffer(buffer, limit) {
    try {
      var view = new Uint8Array(buffer || new ArrayBuffer(0));
      var max = Math.min(view.length, limit || 64);
      var parts = [];
      for (var index = 0; index < max; index += 1) {
        parts.push(view[index].toString(16).padStart(2, "0"));
      }
      return parts.join("");
    } catch (error) {
      return "";
    }
  }

  function patchXHRDebug() {
    if (typeof window.XMLHttpRequest !== "function" || window.XMLHttpRequest.__xyzwDebugPatched) {
      return;
    }

    var OriginalXHR = window.XMLHttpRequest;

    function PatchedXHR() {
      var xhr = new OriginalXHR();
      var meta = {
        method: "GET",
        url: "",
        bodyPreview: "",
        bodyLength: 0,
        headers: {},
      };

      var originalOpen = xhr.open;
      xhr.open = function (method, url) {
        meta.method = method || "GET";
        meta.url = url || "";
        return originalOpen.apply(xhr, arguments);
      };

      var originalSetRequestHeader = xhr.setRequestHeader;
      xhr.setRequestHeader = function (name, value) {
        try {
          meta.headers[String(name || "").toLowerCase()] = String(value || "");
        } catch (error) {}
        return originalSetRequestHeader.apply(xhr, arguments);
      };

      var originalSend = xhr.send;
      xhr.send = function (body) {
        if (body instanceof ArrayBuffer) {
          meta.bodyLength = body.byteLength || 0;
          meta.bodyPreview = toHexPreviewFromArrayBuffer(body, 64);
        } else if (typeof ArrayBuffer !== "undefined" && ArrayBuffer.isView && ArrayBuffer.isView(body)) {
          meta.bodyLength = body.byteLength || 0;
          meta.bodyPreview = toHexPreviewFromArrayBuffer(body.buffer, 64);
        } else if (typeof body === "string") {
          meta.bodyLength = body.length;
          meta.bodyPreview = body.slice(0, 160);
        } else {
          meta.bodyLength = 0;
          meta.bodyPreview = "";
        }
        return originalSend.apply(xhr, arguments);
      };

      xhr.addEventListener("loadstart", function () {
        if (shouldTraceNetwork(meta.url)) {
          appendDebugLog("xhr-request", {
            url: String(meta.url).slice(0, 220),
            method: meta.method,
            bodyLength: meta.bodyLength,
            bodyPreview: meta.bodyPreview,
            headers: meta.headers,
          });
        }
      });

      xhr.addEventListener("loadend", function () {
        if (shouldTraceNetwork(meta.url)) {
          appendDebugLog("xhr-response", {
            url: String(meta.url).slice(0, 220),
            method: meta.method,
            status: xhr.status,
            responseType: xhr.responseType || "",
          });
        }
      });

      xhr.addEventListener("error", function () {
        if (shouldTraceNetwork(meta.url)) {
          appendDebugLog("xhr-error", {
            url: String(meta.url).slice(0, 220),
            method: meta.method,
            status: xhr.status,
          });
        }
      });

      return xhr;
    }

    PatchedXHR.prototype = OriginalXHR.prototype;
    PatchedXHR.__xyzwDebugPatched = true;
    window.XMLHttpRequest = PatchedXHR;
    if (typeof globalThis !== "undefined") {
      globalThis.XMLHttpRequest = PatchedXHR;
    }
    appendDebugLog("xhr-debug-patched");
  }

  function resolveManifestConfig(payload) {
    var search = null;
    try {
      search = new URLSearchParams(window.location.search || "");
    } catch (error) {
      search = null;
    }

    var raw = null;
    if (payload && payload.manifest && typeof payload.manifest === "object") {
      raw = payload.manifest;
    } else if (payload && payload.settings && payload.settings.manifest && typeof payload.settings.manifest === "object") {
      raw = payload.settings.manifest;
    }

    if (raw && raw.enabled === false) {
      return {
        enabled: false,
      };
    }

    var config = clonePlainObject(DEFAULT_MANIFEST_CONFIG);
    config.headers = clonePlainObject(DEFAULT_MANIFEST_CONFIG.headers);

    if (raw) {
      Object.keys(raw).forEach(function (key) {
        if (key === "headers" && raw.headers && typeof raw.headers === "object") {
          config.headers = Object.assign({}, config.headers, raw.headers);
          return;
        }

        config[key] = raw[key];
      });
    }

    if (search) {
      var manifestUrl = search.get("manifestUrl");
      if (manifestUrl) {
        config.url = manifestUrl;
      }

      var manifestProxyUrl = search.get("manifestProxyUrl");
      if (manifestProxyUrl !== null) {
        config.proxyUrl = manifestProxyUrl;
      }
    }

    if (typeof config.url !== "string" || !config.url) {
      config.enabled = false;
    }

    return config;
  }

  function tryParseJson(text) {
    if (typeof text !== "string") {
      return null;
    }

    var trimmed = text.trim();
    if (!trimmed) {
      return null;
    }

    try {
      return JSON.parse(trimmed);
    } catch (error) {
      return null;
    }
  }

  function getSlimSafeStorage() {
    try {
      return window.localStorage;
    } catch (error) {
      return null;
    }
  }

  function buildManifestCacheKey(config) {
    return MANIFEST_CACHE_PREFIX + encodeURIComponent(String(config && config.url ? config.url : ""));
  }

  function cloneManifestState(state) {
    if (!state || typeof state !== "object") {
      return null;
    }

    return {
      bundleVers: clonePlainObject(state.bundleVers),
      codeVersion: typeof state.codeVersion === "string" ? state.codeVersion : "",
      dataVers: typeof state.dataVers === "string" ? state.dataVers : "",
      dataBundleVer: typeof state.dataBundleVer === "string" ? state.dataBundleVer : "",
      serverUrl: typeof state.serverUrl === "string" ? state.serverUrl : "",
      raw: state.raw || null,
    };
  }

  function readManifestCacheEntry(config) {
    var storage = getSlimSafeStorage();
    if (!storage || !config || !config.url) {
      return null;
    }

    try {
      var parsed = tryParseJson(storage.getItem(buildManifestCacheKey(config)) || "");
      var state = cloneManifestState(parsed && parsed.state ? parsed.state : null);
      if (!parsed || !state) {
        return null;
      }

      var cachedAt = Number(parsed.cachedAt || 0);
      return {
        state: state,
        cachedAt: cachedAt,
        ageMs: cachedAt > 0 ? Math.max(0, Date.now() - cachedAt) : Number.POSITIVE_INFINITY,
        isFresh: cachedAt > 0 ? Date.now() - cachedAt < MANIFEST_CACHE_TTL_MS : false,
      };
    } catch (error) {
      return null;
    }
  }

  function writeManifestCacheEntry(config, state) {
    var storage = getSlimSafeStorage();
    if (!storage || !config || !config.url || !state) {
      return;
    }

    try {
      storage.setItem(
        buildManifestCacheKey(config),
        JSON.stringify({
          cachedAt: Date.now(),
          state: cloneManifestState(state),
        }),
      );
    } catch (error) {
      appendDebugLog("manifest-cache-write-failed", error && error.message ? error.message : String(error));
    }
  }

  function buildManifestStateFromCache(config, requestInit, entry, via) {
    if (!entry || !entry.state) {
      return null;
    }

    var state = cloneManifestState(entry.state);
    if (!state) {
      return null;
    }

    state.url = config && config.url ? config.url : "";
    state.request = requestInit || null;
    state.via = via || "cache";
    state.cacheAgeMs = Number.isFinite(entry.ageMs) ? entry.ageMs : null;
    return state;
  }

  async function fetchWithTimeout(url, requestInit, timeoutMs, label) {
    var timeout = Math.max(0, Number(timeoutMs) || 0);
    if (!timeout || typeof AbortController !== "function") {
      return fetch(url, requestInit);
    }

    var controller = new AbortController();
    var timerId = setTimeout(function () {
      controller.abort();
    }, timeout);

    try {
      var nextInit = Object.assign({}, requestInit || {}, {
        signal: controller.signal,
      });
      return await fetch(url, nextInit);
    } catch (error) {
      if (controller.signal && controller.signal.aborted) {
        throw new Error((label || "request") + " timeout after " + timeout + "ms");
      }
      throw error;
    } finally {
      clearTimeout(timerId);
    }
  }

  function toCleanString(value) {
    return String(value == null ? "" : value).trim();
  }

  function pickFirstDefined() {
    for (var i = 0; i < arguments.length; i += 1) {
      var value = arguments[i];
      if (value !== undefined && value !== null && value !== "") {
        return value;
      }
    }
    return undefined;
  }

  function tryParseJsonString(value) {
    if (typeof value !== "string") {
      return value;
    }

    var text = value.trim();
    if (!text) {
      return value;
    }

    try {
      return JSON.parse(text);
    } catch (error) {
      return value;
    }
  }

  function readSlimLaunchPayload() {
    var storage = getSlimSafeStorage();
    if (!storage) {
      appendDebugLog("launch-storage-unavailable");
      return null;
    }

    var launchKey = "";
    try {
      var search = new URLSearchParams(window.location.search || "");
      launchKey = search.get("launchKey") || "";
    } catch (error) {
      launchKey = "";
    }

    var raw = "";
    var source = "";

    if (launchKey) {
      raw = storage.getItem(launchKey) || "";
      source = launchKey;
    }

    if (!raw) {
      raw = storage.getItem(SLIM_LAST_ACCOUNT_KEY) || "";
      source = SLIM_LAST_ACCOUNT_KEY;
    }

    if (!raw) {
      appendDebugLog("launch-payload-missing");
      return null;
    }

    var parsed = tryParseJson(raw);
    if (!parsed || typeof parsed !== "object") {
      appendDebugLog("launch-payload-invalid", {
        source: source,
        value: summarizeValue(raw),
      });
      return null;
    }

    parsed.__storageSource = source;
    return parsed;
  }

  function normalizeSlimAuthPayload(rawPayload) {
    if (!rawPayload) {
      return null;
    }

    var payload = rawPayload;
    if (typeof payload === "string") {
      var payloadText = payload.trim();
      if (!payloadText) {
        return null;
      }
      try {
        payload = JSON.parse(payloadText);
      } catch (error) {
        return null;
      }
    }

    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return null;
    }

    var candidates = [
      payload,
      payload.authPayload,
      payload.auth_payload,
      payload.loginPayload,
      payload.login_payload,
      payload.launchContext,
      payload.launch_context,
      payload.data,
      payload.rawData,
      payload.result,
      payload.payload,
    ].filter(Boolean);

    for (var i = 0; i < candidates.length; i += 1) {
      var item = candidates[i];
      var info = tryParseJsonString(
        pickFirstDefined(item.info, item.authInfo, item.encryptUserInfo, item.userInfo, item.loginInfo),
      );
      var platformExt = pickFirstDefined(item.platformExt, item.platform_ext, item.ext);
      var serverIdRaw = pickFirstDefined(item.serverId, item.serverID, item.sid, item.realServerId);
      var serverId =
        serverIdRaw === null || serverIdRaw === undefined || serverIdRaw === ""
          ? null
          : Number(serverIdRaw);

      if (platformExt && info && (serverId === null || Number.isFinite(serverId))) {
        return {
          platform: toCleanString(item.platform || "hortor") || "hortor",
          platformExt: toCleanString(platformExt),
          info: info,
          serverId: serverId,
          scene: Number.isFinite(Number(item.scene)) ? Number(item.scene) : 0,
          referrerInfo: toCleanString(item.referrerInfo),
          type: toCleanString(item.type || "slim-launch") || "slim-launch",
        };
      }
    }

    return null;
  }

  function stringifySlimAuthInfo(info) {
    if (typeof info === "string") {
      return info;
    }

    try {
      return JSON.stringify(info == null ? {} : info);
    } catch (error) {
      return "{}";
    }
  }

  function buildSlimAuthUserParams(params, authPayload) {
    var next = Object.assign({}, params || {});
    if (authPayload.platformExt) {
      next.platformExt = authPayload.platformExt;
    }
    next.info = stringifySlimAuthInfo(authPayload.info);
    if (Number.isFinite(authPayload.serverId)) {
      next.serverId = authPayload.serverId;
    }
    if (next.scene === undefined) {
      next.scene = 0;
    }
    return next;
  }

  function buildSlimServerListParams(params, authPayload) {
    return {
      platform: "hortor",
      platformExt: authPayload.platformExt || (params && params.platformExt) || "mix",
      info: stringifySlimAuthInfo(authPayload.info),
      serverId: Number.isFinite(authPayload.serverId) ? authPayload.serverId : null,
      scene: 0,
      referrerInfo: "",
      rtt: params && Number.isFinite(Number(params.rtt)) ? Number(params.rtt) : 0,
    };
  }

  function tryRequireModule(name) {
    if (typeof window.__require !== "function") {
      return null;
    }

    try {
      return window.__require(name);
    } catch (error) {
      return null;
    }
  }

  function getDataIndexModule() {
    return tryRequireModule("data-index");
  }

  function getSlimLaunchState() {
    return window.__XYZW_SLIM_LAUNCH__ || null;
  }

  function getSlimAuthPayload() {
    var state = getSlimLaunchState();
    return state && state.authPayload ? state.authPayload : null;
  }

  function getSlimTokenPayload() {
    var state = getSlimLaunchState();
    return state && state.tokenPayload ? state.tokenPayload : null;
  }

  function normalizeSlimTokenPayload(rawToken) {
    if (!rawToken) {
      return null;
    }

    var payload = rawToken;
    if (typeof payload === "string") {
      payload = tryParseJson(payload.trim());
    }

    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return null;
    }

    var roleToken = toCleanString(payload.roleToken || payload.token);
    if (!roleToken) {
      return null;
    }

    var roleId = Number(payload.roleId || payload.roleID || payload.rid || 0);
    var sessId = Number(payload.sessId || payload.sessionId || 0);
    var connId = Number(payload.connId || payload.connectionId || 0);
    var isRestore = Number(payload.isRestore || 0);

    return {
      roleToken: roleToken,
      roleId: Number.isFinite(roleId) ? roleId : 0,
      sessId: Number.isFinite(sessId) ? sessId : 0,
      connId: Number.isFinite(connId) ? connId : 0,
      isRestore: Number.isFinite(isRestore) ? isRestore : 0,
    };
  }

  function hasSlimTokenFallback() {
    var tokenPayload = getSlimTokenPayload();
    return !getSlimAuthPayload() && !!(tokenPayload && tokenPayload.roleToken);
  }

  function createSlimAuthResultFromToken(tokenPayload) {
    var payload = tokenPayload || getSlimTokenPayload();
    if (!payload || !payload.roleToken) {
      return null;
    }

    var rawData = {
      roleToken: payload.roleToken,
      roleId: Number.isFinite(payload.roleId) ? payload.roleId : 0,
      sessId: Number.isFinite(payload.sessId) ? payload.sessId : 0,
      connId: Number.isFinite(payload.connId) ? payload.connId : 0,
      isRestore: Number.isFinite(payload.isRestore) ? payload.isRestore : 0,
    };

    return {
      code: 0,
      error: "",
      rawData: rawData,
      getData: function () {
        return rawData;
      },
    };
  }

  function getSlimResolvedPlatformExt() {
    var authPayload = getSlimAuthPayload();
    if (authPayload && authPayload.platformExt) {
      return authPayload.platformExt;
    }

    var state = getSlimLaunchState();
    var launchContext = state && state.payload && state.payload.launchContext
      ? state.payload.launchContext
      : null;
    var nextValue = pickFirstDefined(
      launchContext && launchContext.platformExt,
      launchContext && launchContext.platform_ext,
      state && state.payload && state.payload.platformExt,
      state && state.payload && state.payload.platform_ext,
      "mix"
    );
    return toCleanString(nextValue) || "mix";
  }

  function getSlimResolvedServerId() {
    var authPayload = getSlimAuthPayload();
    if (authPayload && Number.isFinite(authPayload.serverId)) {
      return authPayload.serverId;
    }

    var state = getSlimLaunchState();
    var payload = state && state.payload ? state.payload : null;
    var launchContext = payload && payload.launchContext ? payload.launchContext : null;
    var nextValue = pickFirstDefined(
      payload && payload.serverId,
      launchContext && launchContext.serverId,
      launchContext && launchContext.authPayload && launchContext.authPayload.serverId,
      launchContext && launchContext.auth_payload && launchContext.auth_payload.serverId
    );
    var numeric = Number(nextValue);
    return Number.isFinite(numeric) ? numeric : null;
  }

  function patchSlimLoginService(dataIndex) {
    if (!dataIndex || !dataIndex.LoginService) {
      return false;
    }

    var loginService = dataIndex.LoginService;
    var patched = false;

    if (typeof loginService.authUser === "function" && !loginService.authUser.__xyzwSlimPatched) {
      var originalAuthUser = loginService.authUser;
      loginService.authUser = function (params) {
        var authPayload = getSlimAuthPayload();
        if (authPayload) {
          var patchedParams = buildSlimAuthUserParams(params, authPayload);
          appendDebugLog("slim-authUser-patched", patchedParams);
          return originalAuthUser.call(this, patchedParams);
        }
        if (hasSlimTokenFallback()) {
          var fakeAuthResult = createSlimAuthResultFromToken();
          appendDebugLog("slim-authUser-roleToken-fallback", {
            roleId: fakeAuthResult && fakeAuthResult.rawData ? fakeAuthResult.rawData.roleId : 0,
          });
          return Promise.resolve(fakeAuthResult);
        }
        return originalAuthUser.call(this, params);
      };
      loginService.authUser.__xyzwSlimPatched = true;
      loginService.authUser.isSelfCreate = true;
      loginService.authUser.__xyzwSlimOriginal = originalAuthUser;
      patched = true;
    }

    if (typeof loginService.serverList === "function" && !loginService.serverList.__xyzwSlimPatched) {
      var originalServerList = loginService.serverList;
      loginService.serverList = function (params) {
        var authPayload = getSlimAuthPayload();
        if (!authPayload) {
          return originalServerList.call(this, params);
        }
        var patchedParams = buildSlimServerListParams(params, authPayload);
        appendDebugLog("slim-serverList-patched", patchedParams);
        return originalServerList.call(this, patchedParams);
      };
      loginService.serverList.__xyzwSlimPatched = true;
      loginService.serverList.isSelfCreate = true;
      loginService.serverList.__xyzwSlimOriginal = originalServerList;
      patched = true;
    }

    return patched;
  }

  function patchSlimIsolateInstance(instance) {
    if (!instance || !instance.LoginService) {
      return instance;
    }

    var loginService = instance.LoginService;

    if (typeof loginService.authUser === "function" && !loginService.authUser.__xyzwSlimPatched) {
      var originalAuthUser = loginService.authUser;
      loginService.authUser = function (params) {
        var authPayload = getSlimAuthPayload();
        if (authPayload) {
          var patchedParams = buildSlimAuthUserParams(params, authPayload);
          appendDebugLog("slim-isolate-authUser-patched", patchedParams);
          return originalAuthUser.call(this, patchedParams);
        }
        if (hasSlimTokenFallback()) {
          var fakeAuthResult = createSlimAuthResultFromToken();
          appendDebugLog("slim-isolate-authUser-roleToken-fallback", {
            roleId: fakeAuthResult && fakeAuthResult.rawData ? fakeAuthResult.rawData.roleId : 0,
          });
          return Promise.resolve(fakeAuthResult);
        }
        return originalAuthUser.call(this, params);
      };
      loginService.authUser.__xyzwSlimPatched = true;
      loginService.authUser.isSelfCreate = true;
      loginService.authUser.__xyzwSlimOriginal = originalAuthUser;
    }

    if (typeof loginService.serverList === "function" && !loginService.serverList.__xyzwSlimPatched) {
      var originalServerList = loginService.serverList;
      loginService.serverList = function (params) {
        var authPayload = getSlimAuthPayload();
        if (!authPayload) {
          return originalServerList.call(this, params);
        }
        var patchedParams = buildSlimServerListParams(params, authPayload);
        appendDebugLog("slim-isolate-serverList-patched", patchedParams);
        return originalServerList.call(this, patchedParams);
      };
      loginService.serverList.__xyzwSlimPatched = true;
      loginService.serverList.isSelfCreate = true;
      loginService.serverList.__xyzwSlimOriginal = originalServerList;
    }

    return instance;
  }

  function patchSlimIsolateModule(dataIndex) {
    if (!dataIndex || !dataIndex.Isolate) {
      return false;
    }

    var OriginalIsolate = dataIndex.Isolate;
    var patched = false;
    var authCmdPattern = /authuser|login_authuser|Login_AuthUserReq/i;
    var serverListPattern = /serverlist|login_serverlist|Login_ServerListReq/i;

    if (typeof OriginalIsolate.prototype.send === "function" && !OriginalIsolate.prototype.send.__xyzwSlimPatched) {
      var originalSend = OriginalIsolate.prototype.send;
      OriginalIsolate.prototype.send = function (cmd, params) {
        var authPayload = getSlimAuthPayload();
        if (authCmdPattern.test(String(cmd)) && authPayload) {
          var authParams = buildSlimAuthUserParams(params, authPayload);
          appendDebugLog("slim-isolate-send-auth-patched", authParams);
          return originalSend.call(this, cmd, authParams);
        }
        if (authCmdPattern.test(String(cmd)) && hasSlimTokenFallback()) {
          var fakeAuthResult = createSlimAuthResultFromToken();
          appendDebugLog("slim-isolate-send-auth-roleToken-fallback", {
            roleId: fakeAuthResult && fakeAuthResult.rawData ? fakeAuthResult.rawData.roleId : 0,
          });
          return Promise.resolve(fakeAuthResult);
        }
        if (serverListPattern.test(String(cmd)) && authPayload) {
          var serverParams = buildSlimServerListParams(params, authPayload);
          appendDebugLog("slim-isolate-send-serverList-patched", serverParams);
          return originalSend.call(this, cmd, serverParams);
        }
        return originalSend.call(this, cmd, params);
      };
      OriginalIsolate.prototype.send.__xyzwSlimPatched = true;
      patched = true;
    }

    if (typeof OriginalIsolate.prototype.sendEx === "function" && !OriginalIsolate.prototype.sendEx.__xyzwSlimPatched) {
      var originalSendEx = OriginalIsolate.prototype.sendEx;
      OriginalIsolate.prototype.sendEx = function (payload) {
        var authPayload = getSlimAuthPayload();
        if (!payload || typeof payload !== "object") {
          return originalSendEx.call(this, payload);
        }
        var nextPayload = Object.assign({}, payload);
        if (authCmdPattern.test(String(nextPayload.cmd)) && authPayload) {
          nextPayload.params = buildSlimAuthUserParams(nextPayload.params, authPayload);
          appendDebugLog("slim-isolate-sendEx-auth-patched", nextPayload);
          return originalSendEx.call(this, nextPayload);
        }
        if (authCmdPattern.test(String(nextPayload.cmd)) && hasSlimTokenFallback()) {
          var fakeAuthResult = createSlimAuthResultFromToken();
          appendDebugLog("slim-isolate-sendEx-auth-roleToken-fallback", {
            roleId: fakeAuthResult && fakeAuthResult.rawData ? fakeAuthResult.rawData.roleId : 0,
          });
          return Promise.resolve(fakeAuthResult);
        }
        if (serverListPattern.test(String(nextPayload.cmd)) && authPayload) {
          nextPayload.params = buildSlimServerListParams(nextPayload.params, authPayload);
          appendDebugLog("slim-isolate-sendEx-serverList-patched", nextPayload);
          return originalSendEx.call(this, nextPayload);
        }
        return originalSendEx.call(this, payload);
      };
      OriginalIsolate.prototype.sendEx.__xyzwSlimPatched = true;
      patched = true;
    }

    if (!OriginalIsolate.__xyzwSlimPatched) {
      function PatchedIsolate() {
        var args = Array.prototype.slice.call(arguments);
        var instance = Reflect.construct(OriginalIsolate, args, PatchedIsolate);
        return patchSlimIsolateInstance(instance);
      }
      Object.setPrototypeOf(PatchedIsolate, OriginalIsolate);
      PatchedIsolate.prototype = OriginalIsolate.prototype;
      PatchedIsolate.__xyzwSlimPatched = true;
      PatchedIsolate.isSelfCreate = true;
      dataIndex.Isolate = PatchedIsolate;
      patched = true;
    }

    return patched;
  }

  function patchSlimCompatModules() {
    var patched = false;
    var authPayload = getSlimAuthPayload();
    var tokenPayload = getSlimTokenPayload();
    var resolvedPlatformExt = getSlimResolvedPlatformExt();
    var resolvedServerId = getSlimResolvedServerId();

    var PlatformManagerModule = tryRequireModule("PlatformManager");
    var LocalStorageModule = tryRequireModule("LocalStorage");
    var LoginManagerModule = tryRequireModule("LoginManager");

    var platformManager =
      PlatformManagerModule && PlatformManagerModule.PlatformManager
        ? PlatformManagerModule.PlatformManager.instance
        : null;
    var storageManager =
      LocalStorageModule && LocalStorageModule.LocalStorage
        ? LocalStorageModule.LocalStorage.instance
        : null;
    var loginManager =
      LoginManagerModule && LoginManagerModule.LoginManager
        ? LoginManagerModule.LoginManager.instance
        : null;

    function extractClipboardText(payload) {
      if (typeof payload === "string") {
        return payload;
      }

      if (Array.isArray(payload) && payload.length > 0) {
        return extractClipboardText(payload[0]);
      }

      if (payload && typeof payload === "object") {
        if (typeof payload.data === "string") {
          return payload.data;
        }
        if (typeof payload.text === "string") {
          return payload.text;
        }
        if (typeof payload.value === "string") {
          return payload.value;
        }
      }

      return String(payload == null ? "" : payload);
    }

    function invokePlatformCallback(payload, key, value) {
      try {
        if (payload && typeof payload[key] === "function") {
          payload[key](value);
        }
      } catch (error) {}
    }

    function copyTextByExecCommand(text) {
      if (!document || !document.body || typeof document.createElement !== "function") {
        return false;
      }

      try {
        var textarea = document.createElement("textarea");
        textarea.value = String(text == null ? "" : text);
        textarea.setAttribute("readonly", "readonly");
        textarea.style.position = "fixed";
        textarea.style.left = "-9999px";
        textarea.style.top = "0";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        textarea.setSelectionRange(0, textarea.value.length);
        var copied = typeof document.execCommand === "function"
          ? document.execCommand("copy")
          : false;
        textarea.remove();
        return !!copied;
      } catch (error) {
        return false;
      }
    }

    function fallbackSetClipboardData(payload) {
      var text = extractClipboardText(payload);

      function finalize(success, extra) {
        if (success) {
          invokePlatformCallback(payload, "success", extra || { errMsg: "setClipboardData:ok" });
        } else {
          invokePlatformCallback(payload, "fail", extra || { errMsg: "setClipboardData:fail" });
        }
        invokePlatformCallback(payload, "complete", extra || { errMsg: success ? "setClipboardData:ok" : "setClipboardData:fail" });
      }

      try {
        if (navigator && navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
          return navigator.clipboard.writeText(text).then(function () {
            appendDebugLog("clipboard-fallback-navigator-success", summarizeValue(text, 80));
            finalize(true);
            return true;
          }).catch(function (error) {
            var copied = copyTextByExecCommand(text);
            appendDebugLog("clipboard-fallback-navigator-fail", {
              message: error && error.message ? error.message : String(error),
              execCommandCopied: copied,
            });
            finalize(copied, copied
              ? { errMsg: "setClipboardData:ok" }
              : { errMsg: "setClipboardData:fail" });
            return copied;
          });
        }
      } catch (error) {}

      var copied = copyTextByExecCommand(text);
      appendDebugLog("clipboard-fallback-exec", {
        copied: copied,
        value: summarizeValue(text, 80),
      });
      finalize(copied, copied
        ? { errMsg: "setClipboardData:ok" }
        : { errMsg: "setClipboardData:fail" });
      return Promise.resolve(copied);
    }

    function ensurePlatformBridgeFallbacks(rawPlatform) {
      if (!rawPlatform || rawPlatform.__xyzwWebFallbackPatched) {
        return false;
      }

      var touched = false;
      function defineIfMissing(key, value) {
        if (typeof rawPlatform[key] !== "function") {
          rawPlatform[key] = value;
          touched = true;
        }
      }

      defineIfMissing("setClipboardData", function (payload) {
        return fallbackSetClipboardData(payload);
      });
      defineIfMissing("showToast", function (payload) {
        appendDebugLog("platform-showToast-fallback", payload);
      });
      defineIfMissing("hideToast", function () {});
      defineIfMissing("showLoading", function (payload) {
        appendDebugLog("platform-showLoading-fallback", payload);
      });
      defineIfMissing("hideLoading", function () {});
      defineIfMissing("previewImage", function () {
        return Promise.resolve();
      });
      defineIfMissing("openCustomerServiceConversation", function () {
        return Promise.resolve();
      });
      defineIfMissing("setBrightness", function () {
        return Promise.resolve();
      });
      defineIfMissing("getBattery", function (callback) {
        var result = { battery: 100 };
        if (typeof callback === "function") {
          callback(result);
        }
        return Promise.resolve(result);
      });
      defineIfMissing("getNetworkType", function (callback) {
        var result = { networkType: "unknown" };
        if (typeof callback === "function") {
          callback(result);
        }
        return Promise.resolve(result);
      });

      rawPlatform.__xyzwWebFallbackPatched = true;
      return touched;
    }

    if (platformManager) {
      try {
        var rawPlatform =
          platformManager._platform ||
          platformManager.platform ||
          platformManager.platformApi ||
          null;

        if (ensurePlatformBridgeFallbacks(rawPlatform)) {
          patched = true;
          appendDebugLog("platform-bridge-fallbacks-patched");
        }

        if (
          typeof platformManager.setClipboardData === "function" &&
          !platformManager.setClipboardData.__xyzwClipboardPatched
        ) {
          var originalSetClipboardData = platformManager.setClipboardData.bind(platformManager);
          platformManager.setClipboardData = function (payload) {
            try {
              var result = originalSetClipboardData(payload);
              if (result && typeof result.then === "function") {
                return result.catch(function (error) {
                  appendDebugLog("clipboard-original-failed", {
                    message: error && error.message ? error.message : String(error),
                  });
                  return fallbackSetClipboardData(payload);
                });
              }
              return result;
            } catch (error) {
              appendDebugLog("clipboard-original-throw", {
                message: error && error.message ? error.message : String(error),
              });
              return fallbackSetClipboardData(payload);
            }
          };
          platformManager.setClipboardData.__xyzwClipboardPatched = true;
          patched = true;
        }
      } catch (error) {}

      if (authPayload) {
        platformManager.encryptUserInfo = authPayload.info;
      } else if (platformManager.encryptUserInfo == null) {
        platformManager.encryptUserInfo = {};
      }

      if (platformManager.authorizeDeferred && typeof platformManager.authorizeDeferred.resolve === "function" && !window.__XYZWSlimAuthorizeResolved) {
        try {
          platformManager.authorizeDeferred.resolve(authPayload ? authPayload.info : {});
          window.__XYZWSlimAuthorizeResolved = true;
        } catch (error) {}
      }

      if (!window.__XYZWSlimPlatformExtPatched) {
        var platformExtDescriptor =
          Object.getOwnPropertyDescriptor(platformManager, "platformExt") ||
          Object.getOwnPropertyDescriptor(Object.getPrototypeOf(platformManager || {}), "platformExt");

        try {
          Object.defineProperty(platformManager, "platformExt", {
            configurable: true,
            enumerable: false,
            get: function () {
              var current = getSlimAuthPayload();
              var nextPlatformExt = current && current.platformExt
                ? current.platformExt
                : getSlimResolvedPlatformExt();
              return nextPlatformExt
                ? nextPlatformExt
                : platformExtDescriptor && typeof platformExtDescriptor.get === "function"
                  ? platformExtDescriptor.get.call(platformManager)
                  : "mix";
            },
          });
          window.__XYZWSlimPlatformExtPatched = true;
          patched = true;
        } catch (error) {}
      }

      patched = true;
    }

    if (storageManager && Number.isFinite(resolvedServerId) && !window.__XYZWSlimStoragePatched) {
      var originalGetItem = typeof storageManager.getItem === "function" ? storageManager.getItem.bind(storageManager) : null;
      if (originalGetItem) {
        storageManager.getItem = function (key) {
          if (key === "serverId") {
            var currentServerId = getSlimResolvedServerId();
            if (Number.isFinite(currentServerId)) {
              return String(currentServerId);
            }
          }
          return originalGetItem(key);
        };
        window.__XYZWSlimStoragePatched = true;
        patched = true;
      }
    }

    if (loginManager && typeof loginManager._authUser === "function" && !loginManager._authUser.__xyzwSlimPatched) {
      var originalLoginManagerAuthUser = loginManager._authUser;
      loginManager._authUser = function () {
        if (hasSlimTokenFallback()) {
          var fakeAuthResult = createSlimAuthResultFromToken(tokenPayload);
          this._authUserResult = fakeAuthResult;
          appendDebugLog("slim-loginManager-auth-roleToken-fallback", {
            roleId: fakeAuthResult && fakeAuthResult.rawData ? fakeAuthResult.rawData.roleId : 0,
            platformExt: resolvedPlatformExt,
          });
          return Promise.resolve(fakeAuthResult);
        }
        return originalLoginManagerAuthUser.apply(this, arguments);
      };
      loginManager._authUser.__xyzwSlimPatched = true;
      loginManager._authUser.__xyzwSlimOriginal = originalLoginManagerAuthUser;
      patched = true;
    }

    if (loginManager) {
      try {
        loginManager._tryReLoginTimes = 0;
        if (hasSlimTokenFallback()) {
          loginManager._authUserResult = createSlimAuthResultFromToken(tokenPayload);
        }
        patched = true;
      } catch (error) {}
    }

    return patched;
  }

  function applySlimLaunchPatches(announce) {
    var state = getSlimLaunchState();
    if (!state || (!state.authPayload && !state.tokenPayload)) {
      return false;
    }

    var dataIndex = getDataIndexModule();
    var servicePatched = patchSlimLoginService(dataIndex);
    var isolatePatched = patchSlimIsolateModule(dataIndex);
    var compatPatched = patchSlimCompatModules();

    if (announce && (servicePatched || isolatePatched || compatPatched)) {
      appendDebugLog("slim-auth-patch-active", {
        mode: state.authPayload ? "authPayload" : "roleTokenFallback",
        platformExt: state.authPayload ? state.authPayload.platformExt : getSlimResolvedPlatformExt(),
        serverId: state.authPayload ? state.authPayload.serverId : getSlimResolvedServerId(),
        roleId: state.tokenPayload ? state.tokenPayload.roleId : 0,
        source: state.source || "",
        servicePatched: servicePatched,
        isolatePatched: isolatePatched,
        compatPatched: compatPatched,
      });
    }

    return !!(servicePatched || isolatePatched || compatPatched);
  }

  function startSlimLaunchPatchMonitor() {
    if (SLIM_RUNTIME_PATCH_TIMER) {
      clearInterval(SLIM_RUNTIME_PATCH_TIMER);
    }

    applySlimLaunchPatches(true);
    SLIM_RUNTIME_PATCH_TIMER = setInterval(function () {
      applySlimLaunchPatches(false);
    }, 200);
  }

  function initSlimLaunchIntegration() {
    if (window.__XYZWSlimLaunchInitialized) {
      return getSlimLaunchState();
    }

    window.__XYZWSlimLaunchInitialized = true;

    var payload = readSlimLaunchPayload();
    var authPayload = normalizeSlimAuthPayload(payload);
    var tokenPayload = normalizeSlimTokenPayload(payload && payload.token);
    var state = {
      payload: payload,
      authPayload: authPayload,
      tokenPayload: tokenPayload,
      accountId: payload ? toCleanString(payload.accountId) : "",
      name: payload ? toCleanString(payload.name) : "",
      source: payload ? toCleanString(payload.__storageSource) : "",
      wsUrl: payload ? toCleanString(payload.wsUrl) : "",
      token: payload ? toCleanString(payload.token) : "",
      userId: payload ? toCleanString(payload.userId) : "",
    };
    window.__XYZW_SLIM_LAUNCH__ = state;

    appendDebugLog("launch-payload-ready", {
      accountId: state.accountId,
      hasAuthPayload: !!authPayload,
      hasTokenPayload: !!tokenPayload,
      storageSource: state.source,
      hasToken: !!state.token,
      hasWsUrl: !!state.wsUrl,
    });

    if (state.userId) {
      try {
        var storage = getSlimSafeStorage();
        if (storage) {
          storage.setItem("userId", state.userId);
          storage.setItem("uid", state.userId);
        }
      } catch (error) {}
    }

    if (authPayload || tokenPayload) {
      startSlimLaunchPatchMonitor();
    } else {
      appendDebugLog("launch-auth-payload-missing");
    }

    return state;
  }

  function normalizeManifestResponse(payload) {
    if (!payload || typeof payload !== "object") {
      return null;
    }

    var body = payload.body && typeof payload.body === "object" ? payload.body : payload;
    var rawBundleVers = body.bundleVers;
    var bundleVers = rawBundleVers;

    if (typeof rawBundleVers === "string") {
      bundleVers = tryParseJson(rawBundleVers);
    }

    if (!bundleVers || typeof bundleVers !== "object") {
      bundleVers = {};
    }

    var codeVersion = "";
    if (typeof body.codeVersion === "string" && body.codeVersion) {
      codeVersion = body.codeVersion;
    } else if (typeof bundleVers.codeVersion === "string" && bundleVers.codeVersion) {
      codeVersion = bundleVers.codeVersion;
    }

    return {
      bundleVers: bundleVers,
      codeVersion: codeVersion,
      dataVers: typeof body.dataVers === "string" ? body.dataVers : "",
      dataBundleVer: typeof body.dataBundleVer === "string" ? body.dataBundleVer : "",
      serverUrl: typeof body.serverUrl === "string" ? body.serverUrl : "",
      raw: payload,
    };
  }

  function tryReadNativeManifestState(config, requestInit, originalError) {
    var bridge = window.XYNativeManifestBridge;
    if (!bridge || typeof bridge.fetchManifest !== "function") {
      return null;
    }

    var text = "";
    try {
      text = bridge.fetchManifest(config && config.url ? config.url : "");
    } catch (bridgeError) {
      throw bridgeError;
    }

    var parsed = tryParseJson(text);
    if (!parsed) {
      if (originalError) {
        throw originalError;
      }
      throw new Error("Invalid native manifest JSON");
    }

    var normalized = normalizeManifestResponse(parsed);
    if (!normalized) {
      if (originalError) {
        throw originalError;
      }
      throw new Error("Invalid native manifest payload");
    }

    normalized.url = config && config.url ? config.url : "";
    normalized.request = requestInit || null;
    normalized.via = "native-bridge";
    return normalized;
  }

  function isFileProtocolRuntime() {
    try {
      return window.location && window.location.protocol === "file:";
    } catch (error) {
      return false;
    }
  }

  function cloneManifestFetchConfig(config, url, via) {
    var next = clonePlainObject(config);
    next.headers = clonePlainObject(config && config.headers);
    next.url = url;
    next.via = via || "fetch";
    return next;
  }

  function buildManifestFetchCandidates(config) {
    var candidates = [];
    if (!config || config.enabled === false) {
      return candidates;
    }

    var proxyUrl = typeof config.proxyUrl === "string" ? config.proxyUrl.trim() : "";
    var isFile = isFileProtocolRuntime();

    if (proxyUrl && !isFile) {
      candidates.push(cloneManifestFetchConfig(config, proxyUrl, "proxy"));
    }

    if (typeof config.url === "string" && config.url) {
      candidates.push(cloneManifestFetchConfig(config, config.url, "direct"));
    }

    return candidates;
  }

  function buildManifestRequestInit(config) {
    var requestInit = {
      method: typeof config.method === "string" && config.method ? config.method : DEFAULT_MANIFEST_CONFIG.method,
      mode: typeof config.mode === "string" && config.mode ? config.mode : DEFAULT_MANIFEST_CONFIG.mode,
      credentials:
        typeof config.credentials === "string" && config.credentials
          ? config.credentials
          : DEFAULT_MANIFEST_CONFIG.credentials,
      cache: typeof config.cache === "string" && config.cache ? config.cache : DEFAULT_MANIFEST_CONFIG.cache,
      headers: clonePlainObject(config.headers),
    };

    if (config.body !== undefined) {
      requestInit.body = config.body;
    }

    return requestInit;
  }

  async function fetchManifestStateFromConfig(config) {
    var requestInit = buildManifestRequestInit(config);
    var cacheEntry = readManifestCacheEntry(config);
    if (cacheEntry && cacheEntry.isFresh) {
      appendDebugLog("manifest-cache-hit", {
        url: config.url,
        ageMs: cacheEntry.ageMs,
      });
      return buildManifestStateFromCache(config, requestInit, cacheEntry, "cache-hit");
    }

    try {
      var response = await fetchWithTimeout(
        config.url,
        requestInit,
        MANIFEST_FETCH_TIMEOUT_MS,
        "manifest"
      );
      if (!response.ok) {
        throw new Error("HTTP " + response.status + " while loading manifest " + config.url);
      }

      var parsed = null;
      if (typeof response.clone === "function") {
        try {
          parsed = await response.clone().json();
        } catch (jsonError) {
          parsed = null;
        }
      }

      if (!parsed) {
        var text = await response.text();
        parsed = tryParseJson(text);
      }

      if (!parsed) {
        throw new Error("Invalid manifest JSON from " + config.url);
      }

      var normalized = normalizeManifestResponse(parsed);
      if (!normalized) {
        throw new Error("Invalid manifest payload from " + config.url);
      }

      normalized.url = config.url;
      normalized.request = requestInit;
      normalized.via = config.via === "proxy" ? "proxy-post" : "fetch";
      writeManifestCacheEntry(config, normalized);
      return normalized;
    } catch (error) {
      try {
        var nativeState = tryReadNativeManifestState(config, requestInit, error);
        if (nativeState) {
          writeManifestCacheEntry(config, nativeState);
          return nativeState;
        }
      } catch (nativeError) {
        error = nativeError;
      }

      if (cacheEntry) {
        appendDebugLog("manifest-cache-fallback", {
          url: config.url,
          ageMs: cacheEntry.ageMs,
          error: error && error.message ? error.message : String(error),
        });
        return buildManifestStateFromCache(config, requestInit, cacheEntry, "cache-fallback");
      }

      throw error;
    }
  }

  async function fetchManifestState(payload) {
    var config = resolveManifestConfig(payload);
    if (!config || config.enabled === false) {
      return null;
    }

    var candidates = buildManifestFetchCandidates(config);
    var lastError = null;
    for (var i = 0; i < candidates.length; i += 1) {
      try {
        return await fetchManifestStateFromConfig(candidates[i]);
      } catch (error) {
        lastError = error;
        appendDebugLog("manifest-source-failed", {
          url: candidates[i].url,
          via: candidates[i].via || "fetch",
          message: error && error.message ? error.message : String(error),
        });
      }
    }

    if (lastError) {
      throw lastError;
    }

    return null;
  }

  function getManifestEligibleBundleNames(payload, manifestBundleVers) {
    var names = [];

    function appendName(name) {
      if (
        typeof name === "string" &&
        name &&
        name !== "codeVersion" &&
        name !== "COMMIT_ID" &&
        names.indexOf(name) === -1
      ) {
        names.push(name);
      }
    }

    function append(list) {
      if (!Array.isArray(list)) {
        return;
      }

      list.forEach(appendName);
    }

    if (manifestBundleVers && typeof manifestBundleVers === "object") {
      Object.keys(manifestBundleVers).forEach(appendName);
    }

    if (payload && typeof payload === "object") {
      append(payload.remoteBundles);
      append(payload.subpackages);
      append(payload.jscBundles);
      if (payload.settings && typeof payload.settings === "object") {
        append(payload.settings.remoteBundles);
        append(payload.settings.subpackages);
        append(payload.settings.jscBundles);
      }
    }

    if (names.length === 0) {
      var settings = getSettingsObject();
      if (settings && typeof settings === "object") {
        append(settings.remoteBundles);
        append(settings.subpackages);
        append(settings.jscBundles);
      }
    }

    return names;
  }

  function mergeBundleNameList(current, names) {
    var merged = [];

    function append(list) {
      if (!Array.isArray(list)) {
        return;
      }
      list.forEach(function (name) {
        if (typeof name === "string" && name && merged.indexOf(name) === -1) {
          merged.push(name);
        }
      });
    }

    append(current);
    append(names);
    return merged;
  }

  function filterManifestBundleVers(bundleVers, eligibleBundleNames) {
    var filtered = {};
    if (!bundleVers || typeof bundleVers !== "object") {
      return filtered;
    }

    var allowAll = !Array.isArray(eligibleBundleNames) || eligibleBundleNames.length === 0;
    Object.keys(bundleVers).forEach(function (name) {
      if (name === "codeVersion") {
        return;
      }

      if (allowAll || eligibleBundleNames.indexOf(name) !== -1) {
        filtered[name] = bundleVers[name];
      }
    });
    return filtered;
  }

  function mergeManifestIntoPayload(payload, manifestState) {
    if (!payload || typeof payload !== "object" || !manifestState) {
      return payload;
    }

    var eligibleBundleNames = getManifestEligibleBundleNames(payload, manifestState.bundleVers);
    var filteredBundleVers = filterManifestBundleVers(manifestState.bundleVers, eligibleBundleNames);
    manifestState.filteredBundleVers = filteredBundleVers;

    if (!payload.bundleVers || typeof payload.bundleVers !== "object") {
      payload.bundleVers = {};
    }

    Object.assign(payload.bundleVers, filteredBundleVers);
    payload.remoteBundles = mergeBundleNameList(payload.remoteBundles, Object.keys(filteredBundleVers));
    if (manifestState.codeVersion) {
      payload.version = manifestState.codeVersion;
      payload.bundleVers.codeVersion = manifestState.codeVersion;
      payload.runtimeCodeVersion = manifestState.codeVersion;
    }

    if (payload.settings && typeof payload.settings === "object") {
      if (!payload.settings.bundleVers || typeof payload.settings.bundleVers !== "object") {
        payload.settings.bundleVers = {};
      }

      Object.assign(payload.settings.bundleVers, filteredBundleVers);
      payload.settings.remoteBundles = mergeBundleNameList(payload.settings.remoteBundles, Object.keys(filteredBundleVers));
      if (manifestState.codeVersion) {
        payload.settings.version = manifestState.codeVersion;
        payload.settings.bundleVers.codeVersion = manifestState.codeVersion;
        payload.settings.runtimeCodeVersion = manifestState.codeVersion;
      }
    }

    payload.runtimeManifestMeta = {
      url: manifestState.url || "",
      dataVers: manifestState.dataVers || "",
      dataBundleVer: manifestState.dataBundleVer || "",
      serverUrl: manifestState.serverUrl || "",
      eligibleBundles: eligibleBundleNames.length,
      appliedBundles: Object.keys(filteredBundleVers).length,
      appliedBundleNames: Object.keys(filteredBundleVers),
    };

    return payload;
  }

  function applyManifestVersionSettings(manifestState) {
    var bundleVers = manifestState && manifestState.filteredBundleVers ? manifestState.filteredBundleVers : null;
    if (!bundleVers || typeof bundleVers !== "object") {
      return null;
    }

    var source = {
      bundleVers: Object.assign({}, bundleVers),
      remoteBundles: mergeBundleNameList(null, Object.keys(bundleVers)),
    };

    if (manifestState.codeVersion) {
      source.bundleVers.codeVersion = manifestState.codeVersion;
      source.runtimeCodeVersion = manifestState.codeVersion;
    }

    return applyVersionSettings(source);
  }

  function resolveLogCodeVersion(payload, manifestState) {
    if (manifestState && manifestState.codeVersion) {
      return manifestState.codeVersion;
    }

    return payload && payload.bundleVers ? payload.bundleVers.codeVersion : "";
  }

  function resolveEffectiveCodeVersion(payload, manifestState) {
    if (manifestState && typeof manifestState.codeVersion === "string" && manifestState.codeVersion) {
      return manifestState.codeVersion;
    }

    if (payload && typeof payload.runtimeCodeVersion === "string" && payload.runtimeCodeVersion) {
      return payload.runtimeCodeVersion;
    }

    if (
      payload &&
      payload.settings &&
      typeof payload.settings.runtimeCodeVersion === "string" &&
      payload.settings.runtimeCodeVersion
    ) {
      return payload.settings.runtimeCodeVersion;
    }

    if (payload && payload.bundleVers && typeof payload.bundleVers.codeVersion === "string" && payload.bundleVers.codeVersion) {
      return payload.bundleVers.codeVersion;
    }

    if (
      payload &&
      payload.settings &&
      payload.settings.bundleVers &&
      typeof payload.settings.bundleVers.codeVersion === "string" &&
      payload.settings.bundleVers.codeVersion
    ) {
      return payload.settings.bundleVers.codeVersion;
    }

    if (payload && typeof payload.version === "string" && payload.version) {
      return payload.version;
    }

    return "";
  }

  function resolveVersionUrl() {
    try {
      if (typeof window.__VERSION_CONFIG_URL__ === "string" && window.__VERSION_CONFIG_URL__) {
        return window.__VERSION_CONFIG_URL__;
      }
      var search = new URLSearchParams(window.location.search || "");
      return search.get("versionUrl") || DEFAULT_VERSION_URL;
    } catch (error) {
      console.warn("[boot] resolveVersionUrl failed, fallback to default.", error);
      return DEFAULT_VERSION_URL;
    }
  }

  function hideSplash() {
    var splash = document.getElementById("splash");
    if (splash) {
      splash.style.display = "none";
    }
  }

  function getSettingsObject() {
    var runtimeSettings = window[RUNTIME_SETTINGS_KEY];
    if (runtimeSettings && typeof runtimeSettings === "object") {
      return runtimeSettings;
    }
    return window._CCSettings || (window._CCSettings = {});
  }

  function mergeRuntimeSettings(source) {
    if (!source || typeof source !== "object") {
      return getSettingsObject();
    }

    var target = window[RUNTIME_SETTINGS_KEY];
    if (!target || typeof target !== "object") {
      target = {};
      window[RUNTIME_SETTINGS_KEY] = target;
    }

    Object.assign(target, source);
    return target;
  }

  function getRemoteBundleNames() {
    var settings = getSettingsObject();
    var names = [];

    function append(list) {
      if (!Array.isArray(list)) {
        return;
      }

      list.forEach(function (name) {
        if (typeof name === "string" && name && names.indexOf(name) === -1) {
          names.push(name);
        }
      });
    }

    append(settings.remoteBundles);
    return names;
  }

  function getJscRuntime() {
    return window.__XYZW_JSC_RUNTIME__ || null;
  }

  function snapshotEmbeddedBundleVersions() {
    if (window.__XYZW_EMBEDDED_BUNDLE_VERS__) {
      return window.__XYZW_EMBEDDED_BUNDLE_VERS__;
    }

    var settings = window._CCSettings || {};
    var embedded = {};
    if (settings.bundleVers && typeof settings.bundleVers === "object") {
      embedded = Object.assign({}, settings.bundleVers);
    }
    window.__XYZW_EMBEDDED_BUNDLE_VERS__ = embedded;
    return embedded;
  }

  function applyDefaultJscSettings() {
    var settings = getSettingsObject();
    if (settings.jscEnabled === undefined) {
      settings.jscEnabled = DEFAULT_JSC_CONFIG.enabled;
    }
    if (!Array.isArray(settings.jscBundles) || settings.jscBundles.length === 0) {
      settings.jscBundles = DEFAULT_JSC_CONFIG.bundles.slice();
    }
    if (typeof settings.jscRemoteRoot !== "string" || !settings.jscRemoteRoot) {
      settings.jscRemoteRoot = DEFAULT_JSC_CONFIG.remoteRoot;
    }
    if (settings.jscConfigPrefetch === undefined) {
      settings.jscConfigPrefetch = DEFAULT_JSC_CONFIG.configPrefetch;
    }
    if (!Number.isFinite(Number(settings.jscCacheVersionsPerBundle))) {
      settings.jscCacheVersionsPerBundle = DEFAULT_JSC_CONFIG.cacheVersionsPerBundle;
    }
    mergeRuntimeSettings(settings);
    return settings;
  }

  function shouldUseJscBundle(bundleName) {
    if (!bundleName) {
      return false;
    }

    var runtime = getJscRuntime();
    if (runtime && typeof runtime.shouldHandleBundle === "function") {
      try {
        return !!runtime.shouldHandleBundle(bundleName, getSettingsObject());
      } catch (error) {}
    }

    var settings = getSettingsObject();
    return (
      settings.jscEnabled !== false &&
      Array.isArray(settings.jscBundles) &&
      settings.jscBundles.indexOf(bundleName) !== -1
    );
  }

  function getRemoteBundleRoot() {
    var settings = getSettingsObject();
    if (!settings.server || typeof settings.server !== "string") {
      return "";
    }

    return settings.server.replace(/\/+$/, "") + "/remote";
  }

  function isAbsoluteBundleUrl(url) {
    return /^(?:https?:)?\/\//i.test(url);
  }

  function normalizeBundleName(target) {
    var raw = String(target || "");
    if (!raw) {
      return "";
    }

    var cleaned = raw.replace(/[?#].*$/, "").replace(/\/+$/, "");
    if (!cleaned) {
      return "";
    }

    var name = cc && cc.path && typeof cc.path.basename === "function" ? cc.path.basename(cleaned) : cleaned;
    if (name === "assets") {
      return "";
    }

    return name;
  }

  function resolveBundleRequestTarget(target) {
    var raw = String(target || "");
    var bundleName = normalizeBundleName(raw);
    var remoteBundles = getRemoteBundleNames();
    var remoteRoot = getRemoteBundleRoot();
    var jscRuntime = getJscRuntime();

    if (bundleName && shouldUseJscBundle(bundleName) && jscRuntime && typeof jscRuntime.resolveRemoteBundleRoot === "function") {
      try {
        return jscRuntime.resolveRemoteBundleRoot(bundleName, getSettingsObject());
      } catch (error) {}
    }

    if (bundleName && remoteRoot && remoteBundles.indexOf(bundleName) !== -1) {
      return remoteRoot + "/" + bundleName;
    }

    if (isAbsoluteBundleUrl(raw)) {
      return raw;
    }

    if (/^assets\//.test(raw)) {
      return raw;
    }

    return bundleName ? "assets/" + bundleName : raw;
  }

  function resolveRuntimeBundleVersion(bundleName) {
    if (!bundleName) {
      return "";
    }

    var settings = getSettingsObject();
    if (settings && settings.bundleVers && typeof settings.bundleVers[bundleName] === "string") {
      return settings.bundleVers[bundleName];
    }

    if (window._CCSettings && window._CCSettings.bundleVers && typeof window._CCSettings.bundleVers[bundleName] === "string") {
      return window._CCSettings.bundleVers[bundleName];
    }

    return "";
  }

  function shouldForceRemoteBundleVersion(bundleName) {
    return !!bundleName && (
      getRemoteBundleNames().indexOf(bundleName) !== -1 ||
      shouldUseJscBundle(bundleName)
    );
  }

  function patchRemoteBundleDownloader() {
    if (!window.cc || !cc.assetManager || !cc.assetManager.downloader) {
      return false;
    }

    var downloader = cc.assetManager.downloader;
    var handlers = downloader._downloaders;
    if (!handlers || typeof handlers.bundle !== "function") {
      return false;
    }

    if (handlers.bundle.__xyzwRemotePatched) {
      return true;
    }

    var jsonHandler = handlers[".json"];
    var scriptHandler = handlers[".js"];
    if (typeof jsonHandler !== "function" || typeof scriptHandler !== "function") {
      return false;
    }

    var originalBundleHandler = handlers.bundle;

    var patchedBundleHandler = function (target, options, done) {
      var bundleName = normalizeBundleName(target);
      var resolvedTarget = resolveBundleRequestTarget(target);
      var runtimeVersion = resolveRuntimeBundleVersion(bundleName);

      var version = shouldForceRemoteBundleVersion(bundleName)
        ? runtimeVersion || downloader.bundleVers[bundleName] || (options && options.version)
        : (options && options.version) || downloader.bundleVers[bundleName] || runtimeVersion;
      var finished = 0;
      var config = null;
      var error = null;
      var jscRuntime = getJscRuntime();

      if (bundleName && shouldUseJscBundle(bundleName) && jscRuntime && typeof jscRuntime.loadBundlePackage === "function") {
        jscRuntime.loadBundlePackage({
          bundleName: bundleName,
          version: version,
          remoteRoot: resolvedTarget,
          localRoot: "assets/" + bundleName,
          options: options,
          settings: getSettingsObject(),
          scriptHandler: scriptHandler,
        }).then(function (jscConfig) {
          done(null, jscConfig || null);
        }).catch(function (jscError) {
          done(jscError);
        });
        return;
      }

      jsonHandler(
        resolvedTarget + "/config." + (version ? version + "." : "") + "json",
        options,
        function (jsonError, jsonResult) {
          if (jsonError) {
            error = jsonError;
          }

          if (jsonResult) {
            config = jsonResult;
            config.base = resolvedTarget + "/";
          }

          finished += 1;
          if (finished === 2) {
            done(error, config);
          }
        }
      );

      scriptHandler(
        resolvedTarget + "/index." + (version ? version + "." : "") + "js",
        options,
        function (scriptError) {
          if (scriptError) {
            error = scriptError;
          }

          finished += 1;
          if (finished === 2) {
            done(error, config);
          }
        }
      );
    };

    patchedBundleHandler.__xyzwRemotePatched = true;
    patchedBundleHandler.__xyzwOriginal = originalBundleHandler;
    if (typeof downloader.register === "function") {
      downloader.register("bundle", patchedBundleHandler);
    }
    if (handlers) {
      handlers.bundle = patchedBundleHandler;
    }
    return true;
  }

  function patchAssetManagerLoadBundle() {
    if (!window.cc || !cc.assetManager || typeof cc.assetManager.loadBundle !== "function") {
      return false;
    }

    if (cc.assetManager.loadBundle.__xyzwRemotePatched) {
      return true;
    }

    var originalLoadBundle = cc.assetManager.loadBundle.bind(cc.assetManager);

    var patchedLoadBundle = function (target, options, onComplete) {
      var bundleName = normalizeBundleName(target);
      var resolvedTarget = resolveBundleRequestTarget(target);
      var actualOptions = options;
      var actualComplete = onComplete;
      var runtimeVersion = resolveRuntimeBundleVersion(bundleName);

      if (typeof actualOptions === "function") {
        actualComplete = actualOptions;
        actualOptions = undefined;
      }

      if (shouldForceRemoteBundleVersion(bundleName) && runtimeVersion) {
        actualOptions = Object.assign({}, actualOptions || {}, {
          version: runtimeVersion,
        });
      }

      return originalLoadBundle(resolvedTarget, actualOptions, actualComplete);
    };

    patchedLoadBundle.__xyzwRemotePatched = true;
    patchedLoadBundle.__xyzwOriginal = originalLoadBundle;
    cc.assetManager.loadBundle = patchedLoadBundle;
    return true;
  }

  function patchDownloaderDownload() {
    if (!window.cc || !cc.assetManager || !cc.assetManager.downloader) {
      return false;
    }

    var downloader = cc.assetManager.downloader;
    if (typeof downloader.download !== "function" || downloader.download.__xyzwRemotePatched) {
      return true;
    }

    var originalDownload = downloader.download.bind(downloader);

    var patchedDownload = function (id, url, type, options, onComplete) {
      var resolvedUrl = url;
      if (type === "bundle") {
        resolvedUrl = resolveBundleRequestTarget(url);
      }
      return originalDownload(id, resolvedUrl, type, options, onComplete);
    };

    patchedDownload.__xyzwRemotePatched = true;
    patchedDownload.__xyzwOriginal = originalDownload;
    downloader.download = patchedDownload;
    return true;
  }

  function ensureVersionBadge() {
    var badge = document.getElementById(VERSION_BADGE_ID);
    if (badge) {
      return badge;
    }

    badge = document.createElement("div");
    badge.id = VERSION_BADGE_ID;
    badge.style.display = "none";

    var title = document.createElement("div");
    title.setAttribute("data-role", "title");
    title.style.cssText = [
      "font-size:14px",
      "font-weight:800",
      "letter-spacing:0.2px",
      "text-shadow:0 2px 8px rgba(0,0,0,0.45)",
    ].join(";");
    badge.appendChild(title);

    var meta = document.createElement("div");
    meta.setAttribute("data-role", "meta");
    meta.style.cssText = [
      "margin-top:1px",
      "font-size:7px",
      "font-weight:700",
      "letter-spacing:0.2px",
      "color:rgba(255,244,194,0.88)",
    ].join(";");
    badge.appendChild(meta);

    document.body.appendChild(badge);
    return badge;
  }

  function ensureAppTitle() {
    var titleNode = document.getElementById(APP_TITLE_ID);
    if (titleNode) {
      return titleNode;
    }

    titleNode = document.createElement("div");
    titleNode.id = APP_TITLE_ID;
    titleNode.style.cssText = [
      "position:fixed",
      "top:max(8px, env(safe-area-inset-top))",
      "right:max(8px, env(safe-area-inset-right))",
      "z-index:999999",
      "pointer-events:none",
      "padding:3px 9px",
      "border-radius:999px",
      "background:rgba(0,0,0,0.38)",
      "border:1px solid rgba(255,255,255,0.18)",
      "box-shadow:0 4px 16px rgba(0,0,0,0.22)",
      "color:#fff7d1",
      "font-family:Arial, 'PingFang SC', 'Microsoft YaHei', sans-serif",
      "font-size:11px",
      "font-weight:800",
      "letter-spacing:0.6px",
      "line-height:1.2",
      "white-space:nowrap",
      "text-align:right",
    ].join(";");
    document.body.appendChild(titleNode);
    return titleNode;
  }

  function updateAppTitle(titleText) {
    if (!document.body) {
      return;
    }

    ensureAppTitle().textContent = titleText || "汤姆猫";
  }

  function updateVersionBadge(versionText, metaText) {
    return;
  }

  function resolveDisplayedCodeVersion(payload) {
    if (payload && typeof payload.runtimeCodeVersion === "string" && payload.runtimeCodeVersion) {
      return payload.runtimeCodeVersion;
    }

    if (
      payload &&
      payload.settings &&
      typeof payload.settings.runtimeCodeVersion === "string" &&
      payload.settings.runtimeCodeVersion
    ) {
      return payload.settings.runtimeCodeVersion;
    }

    if (payload && payload.bundleVers && typeof payload.bundleVers.codeVersion === "string") {
      return payload.bundleVers.codeVersion;
    }

    if (
      payload &&
      payload.settings &&
      payload.settings.bundleVers &&
      typeof payload.settings.bundleVers.codeVersion === "string"
    ) {
      return payload.settings.bundleVers.codeVersion;
    }

    if (
      window._CCSettings &&
      window._CCSettings.bundleVers &&
      typeof window._CCSettings.bundleVers.codeVersion === "string"
    ) {
      return window._CCSettings.bundleVers.codeVersion;
    }

    var autoResolved = resolveAutoCodeVersion(Date.now());
    return autoResolved ? autoResolved.version : null;
  }

  function renderVersionBadge(payload) {
    var codeVersion = resolveDisplayedCodeVersion(payload) || "--";
    var metaText =
      payload && payload.version
        ? "配置 " + payload.version + " · 壳 " + BOOT_PATCH_LABEL
        : "每周五自动版本 · 壳 " + BOOT_PATCH_LABEL;

    updateVersionBadge(codeVersion, metaText);
  }

  function parseVersion(version) {
    var match = /^([0-9]+)\.([0-9]+)\.([0-9]+)$/.exec(String(version || "").trim());
    if (!match) {
      return null;
    }

    return {
      major: parseInt(match[1], 10),
      minor: parseInt(match[2], 10),
      patch: parseInt(match[3], 10),
    };
  }

  function parseDateParts(dateText) {
    var match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateText || "").trim());
    if (!match) {
      return null;
    }

    return {
      year: parseInt(match[1], 10),
      month: parseInt(match[2], 10),
      day: parseInt(match[3], 10),
    };
  }

  function formatVersion(parts) {
    return [parts.major, parts.minor, parts.patch].join(".");
  }

  function addWeeklyVersion(baseVersion, weeksElapsed) {
    var parts = parseVersion(baseVersion);
    if (!parts) {
      return null;
    }

    var totalPatch = parts.patch + Math.max(0, weeksElapsed || 0);
    parts.minor += Math.floor(totalPatch / 10);
    parts.patch = totalPatch % 10;
    return formatVersion(parts);
  }

  function getChinaDayIndex(nowMs, timezoneOffsetMinutes) {
    var dayMs = 24 * 60 * 60 * 1000;
    return Math.floor((nowMs + timezoneOffsetMinutes * 60 * 1000) / dayMs);
  }

  function getAnchorDayIndex(anchorFriday) {
    var parts = parseDateParts(anchorFriday);
    if (!parts) {
      return null;
    }

    var dayMs = 24 * 60 * 60 * 1000;
    return Math.floor(Date.UTC(parts.year, parts.month - 1, parts.day) / dayMs);
  }

  function resolveAutoCodeVersion(nowMs) {
    if (!AUTO_CODE_VERSION || !AUTO_CODE_VERSION.enabled) {
      return null;
    }

    var anchorDayIndex = getAnchorDayIndex(AUTO_CODE_VERSION.anchorFriday);
    if (anchorDayIndex === null) {
      return null;
    }

    var currentDayIndex = getChinaDayIndex(nowMs, AUTO_CODE_VERSION.timezoneOffsetMinutes || 0);
    var weeksElapsed = Math.max(0, Math.floor((currentDayIndex - anchorDayIndex) / 7));
    var version = addWeeklyVersion(AUTO_CODE_VERSION.baseVersion, weeksElapsed);

    if (!version) {
      return null;
    }

    return {
      version: version,
      weeksElapsed: weeksElapsed,
      anchorFriday: AUTO_CODE_VERSION.anchorFriday,
      timezoneOffsetMinutes: AUTO_CODE_VERSION.timezoneOffsetMinutes || 0,
    };
  }

  function applyAutoCodeVersion(source) {
    if (!source || typeof source !== "object") {
      return null;
    }

    var resolved = resolveAutoCodeVersion(Date.now());
    if (!resolved) {
      return null;
    }

    if (!source.bundleVers || typeof source.bundleVers !== "object") {
      source.bundleVers = {};
    }

    source.bundleVers.codeVersion = resolved.version;
    source.runtimeCodeVersion = resolved.version;
    source.runtimeCodeVersionMeta = resolved;
    return resolved;
  }

  function applyVersionSettings(source) {
    if (!source || typeof source !== "object") {
      return null;
    }

    var settings = window._CCSettings || (window._CCSettings = {});
    var applied = {};

    if (typeof source.server === "string" && source.server) {
      settings.server = source.server;
      applied.server = source.server;
    }

    if (typeof source.platform === "string" && source.platform) {
      settings.platform = source.platform;
      applied.platform = source.platform;
    }

    if (typeof source.launchScene === "string" && source.launchScene) {
      settings.launchScene = source.launchScene;
      applied.launchScene = source.launchScene;
    }

    if (typeof source.orientation === "string" && source.orientation) {
      settings.orientation = source.orientation;
      applied.orientation = source.orientation;
    }

    if (typeof source.version === "string" && source.version) {
      settings.version = source.version;
      applied.version = source.version;
    }

    if (Array.isArray(source.remoteBundles) && source.remoteBundles.length > 0) {
      settings.remoteBundles = source.remoteBundles.slice();
      applied.remoteBundles = source.remoteBundles.length;
    }

    if (Array.isArray(source.subpackages)) {
      settings.subpackages = source.subpackages.slice();
      applied.subpackages = source.subpackages.length;
    }

    var mergedRemoteBundleNames = [];
    if (Array.isArray(settings.remoteBundles)) {
      settings.remoteBundles.forEach(function (name) {
        if (typeof name === "string" && name && mergedRemoteBundleNames.indexOf(name) === -1) {
          mergedRemoteBundleNames.push(name);
        }
      });
    }

    if (mergedRemoteBundleNames.length > 0) {
      settings.remoteBundles = mergedRemoteBundleNames;
      applied.remoteBundles = mergedRemoteBundleNames.length;
    }

    if (Array.isArray(source.jsList) && source.jsList.length > 0) {
      settings.jsList = source.jsList.slice();
      applied.jsList = source.jsList.length;
    }

    if (typeof source.hasResourcesBundle === "boolean") {
      settings.hasResourcesBundle = source.hasResourcesBundle;
      applied.hasResourcesBundle = source.hasResourcesBundle;
    }

    if (typeof source.hasStartSceneBundle === "boolean") {
      settings.hasStartSceneBundle = source.hasStartSceneBundle;
      applied.hasStartSceneBundle = source.hasStartSceneBundle;
    }

    if (typeof source.jscEnabled === "boolean") {
      settings.jscEnabled = source.jscEnabled;
      applied.jscEnabled = source.jscEnabled;
    }

    if (Array.isArray(source.jscBundles) && source.jscBundles.length > 0) {
      settings.jscBundles = source.jscBundles.slice();
      applied.jscBundles = source.jscBundles.length;
    }

    if (typeof source.jscRemoteRoot === "string" && source.jscRemoteRoot) {
      settings.jscRemoteRoot = source.jscRemoteRoot;
      applied.jscRemoteRoot = source.jscRemoteRoot;
    }

    if (typeof source.jscConfigPrefetch === "boolean") {
      settings.jscConfigPrefetch = source.jscConfigPrefetch;
      applied.jscConfigPrefetch = source.jscConfigPrefetch;
    }

    if (Number.isFinite(Number(source.jscCacheVersionsPerBundle))) {
      settings.jscCacheVersionsPerBundle = Number(source.jscCacheVersionsPerBundle);
      applied.jscCacheVersionsPerBundle = settings.jscCacheVersionsPerBundle;
    }

    if (source.bundleVers && typeof source.bundleVers === "object") {
      settings.bundleVers = Object.assign({}, settings.bundleVers || {}, source.bundleVers);
      applied.bundleVers = Object.keys(source.bundleVers).length;
    }

    if (Object.keys(applied).length > 0) {
      mergeRuntimeSettings(settings);
      return applied;
    }

    mergeRuntimeSettings(settings);
    return null;
  }

  async function loadRemoteVersionConfig() {
    var url = resolveVersionUrl();
    var response = await fetch(url, {
      cache: "no-store",
      credentials: "same-origin",
    });

    if (!response.ok) {
      throw new Error("HTTP " + response.status + " while loading " + url);
    }

    var payload = await response.json();
    var autoCodeVersion = applyAutoCodeVersion(payload);
    var applied = applyVersionSettings(payload);

    if (payload && payload.settings && typeof payload.settings === "object") {
      applyAutoCodeVersion(payload.settings);
      applied = applyVersionSettings(payload.settings) || applied;
    }

    var manifestState = null;
    try {
      manifestState = await fetchManifestState(payload);
      if (manifestState) {
        mergeManifestIntoPayload(payload, manifestState);
        applied = applyManifestVersionSettings(manifestState) || applied;
      }
    } catch (error) {
      console.warn("[boot] failed to load manifest bundle versions, fallback to version.json.", error);
    }

    window.__REMOTE_VERSION_CONFIG__ = payload;
    window.__REMOTE_MANIFEST_STATE__ = manifestState;
    window.__AUTO_CODE_VERSION__ = autoCodeVersion;
    window.__XYZW_EFFECTIVE_CODE_VERSION__ = resolveEffectiveCodeVersion(payload, manifestState);
    DEBUG_MANIFEST_STATE.loaded = true;
    DEBUG_MANIFEST_STATE.version = payload && payload.version ? String(payload.version) : "";
    DEBUG_MANIFEST_STATE.codeVersion = resolveLogCodeVersion(payload, manifestState) || "";
    DEBUG_MANIFEST_STATE.manifestUrl = manifestState && manifestState.url ? String(manifestState.url) : "";
    DEBUG_MANIFEST_STATE.manifestApplied = manifestState ? Object.keys(manifestState.bundleVers || {}).length : 0;
    DEBUG_MANIFEST_STATE.source = url;
    DEBUG_MANIFEST_STATE.updatedAt = toIsoTime();
    refreshDebugBundleTargets();
    if (DEBUG_PANEL_ENABLED) {
      renderDebugPanel();
    }
    appendDebugLog("version-config-loaded", {
      version: DEBUG_MANIFEST_STATE.version,
      codeVersion: DEBUG_MANIFEST_STATE.codeVersion,
      manifestApplied: DEBUG_MANIFEST_STATE.manifestApplied,
    });
    renderVersionBadge(payload);
    console.info("[boot] remote version config loaded:", {
      url: url,
      version: payload && payload.version ? payload.version : "",
      codeVersion: resolveLogCodeVersion(payload, manifestState),
      manifestUrl: manifestState && manifestState.url ? manifestState.url : "",
      manifestApplied: manifestState ? Object.keys(manifestState.bundleVers || {}).length : 0,
      applied: applied || "none",
    });
  }

  async function startGame() {
    console.log("All scripts loaded, preparing game...");
    window.HtmlIsLoaded = true;
    snapshotEmbeddedBundleVersions();
    applyDefaultJscSettings();
    applyEmbedModeStyles();
    patchRuntimeShellFullscreen();
    injectRuntimeUserScript();
    initSlimLaunchIntegration();
    updateAppTitle("汤姆猫");
    updateVersionBadge("读取中", "正在加载版本");

    try {
      await loadRemoteVersionConfig();
    } catch (error) {
      console.warn("[boot] failed to load remote version config, fallback to embedded settings.", error);
      DEBUG_MANIFEST_STATE.loaded = false;
      DEBUG_MANIFEST_STATE.source = "embedded-fallback";
      DEBUG_MANIFEST_STATE.updatedAt = toIsoTime();
      mergeRuntimeSettings(window._CCSettings || {});
      refreshDebugBundleTargets();
      if (DEBUG_PANEL_ENABLED) {
        renderDebugPanel();
      }
      appendDebugLog("version-config-fallback", {
        source: "embedded",
        message: error && error.message ? error.message : String(error),
      });
      renderVersionBadge(null);
    }

    mergeRuntimeSettings(window._CCSettings || {});
    applyDefaultJscSettings();

    patchRemoteBundleDownloader();
    patchAssetManagerLoadBundle();
    patchDownloaderDownload();

    hideSplash();

    if (typeof window.boot === "function") {
      window.boot();
      patchRuntimeShellFullscreen();
    } else {
      console.error("window.boot is not defined!");
    }
  }

  window.addEventListener("load", function () {
    startGame();
  });
})();
