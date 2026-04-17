(function () {
  var DEFAULT_VERSION_URL = "version.json";
  var VERSION_BADGE_ID = "xyzw-version-badge";
  var APP_TITLE_ID = "xyzw-app-title";
  var RUNTIME_SETTINGS_KEY = "__XYZW_RUNTIME_SETTINGS__";
  var BOOT_PATCH_LABEL = "remotefix-13";
  var HIDE_BUILTIN_CODE_VERSION = false;
  var TRACE_ENABLED = true;
  var TRACE_STORE_KEY = "__XYZW_TRACE_LOGS__";
  var TRACE_MAX = 400;
  var AUTO_CODE_VERSION = {
    enabled: true,
    baseVersion: "2.22.3",
    anchorFriday: "2026-04-03",
    timezoneOffsetMinutes: 8 * 60,
  };
  var DEFAULT_MANIFEST_CONFIG = {
    enabled: true,
    url: "https://xxz-xyzw.hortorgames.com/login/manifest?platform=hortor&version=0.32.0-ios",
    method: "POST",
    mode: "cors",
    credentials: "omit",
    cache: "no-store",
    headers: {
      Accept: "application/json, text/plain, */*",
    },
    body: "",
  };

  function safeTraceValue(value) {
    if (value === null || value === undefined) {
      return value;
    }

    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      return value;
    }

    if (Array.isArray(value)) {
      return value.slice(0, 8).map(safeTraceValue);
    }

    if (typeof value === "object") {
      var result = {};
      Object.keys(value)
        .slice(0, 20)
        .forEach(function (key) {
          result[key] = safeTraceValue(value[key]);
        });
      return result;
    }

    return String(value);
  }

  function pushTrace(level, message, payload) {
    if (!TRACE_ENABLED) {
      return;
    }

    var entry = {
      time: new Date().toISOString(),
      level: level,
      message: message,
      payload: safeTraceValue(payload),
    };

    var store = window[TRACE_STORE_KEY];
    if (!Array.isArray(store)) {
      store = [];
      window[TRACE_STORE_KEY] = store;
    }
    store.push(entry);
    if (store.length > TRACE_MAX) {
      store.splice(0, store.length - TRACE_MAX);
    }

    var logger = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
    logger("[xyzw-trace]", message, entry.payload || "");
  }

  function traceLog(message, payload) {
    pushTrace("log", message, payload);
  }

  function traceWarn(message, payload) {
    pushTrace("warn", message, payload);
  }

  function traceError(message, payload) {
    pushTrace("error", message, payload);
  }

  function shouldTraceUrl(url) {
    var text = String(url || "");
    return (
      /\/remote\//.test(text) ||
      /\/assets\//.test(text) ||
      /\/data\//.test(text) ||
      /version\.json/.test(text) ||
      /manifest/.test(text)
    );
  }

  function patchFetchAndXHRTracing() {
    if (window.fetch && !window.fetch.__xyzwTracePatched) {
      var originalFetch = window.fetch.bind(window);
      var tracedFetch = function (input, init) {
        var url = typeof input === "string" ? input : input && input.url;
        var method = (init && init.method) || "GET";
        if (shouldTraceUrl(url)) {
          traceLog("fetch start", { url: url, method: method });
        }
        return originalFetch(input, init)
          .then(function (response) {
            if (shouldTraceUrl(url)) {
              traceLog("fetch done", { url: url, status: response.status, ok: response.ok });
            }
            return response;
          })
          .catch(function (error) {
            if (shouldTraceUrl(url)) {
              traceError("fetch fail", { url: url, error: error && error.message ? error.message : String(error) });
            }
            throw error;
          });
      };
      tracedFetch.__xyzwTracePatched = true;
      tracedFetch.__xyzwOriginal = originalFetch;
      window.fetch = tracedFetch;
    }

    if (window.XMLHttpRequest && !window.XMLHttpRequest.__xyzwTracePatched) {
      var OriginalXHR = window.XMLHttpRequest;
      function TracedXHR() {
        var xhr = new OriginalXHR();
        var method = "GET";
        var url = "";
        var originalOpen = xhr.open;
        var originalSend = xhr.send;

        xhr.open = function (nextMethod, nextUrl) {
          method = nextMethod || "GET";
          url = nextUrl || "";
          return originalOpen.apply(xhr, arguments);
        };

        xhr.send = function () {
          if (shouldTraceUrl(url)) {
            traceLog("xhr start", { url: url, method: method });
            xhr.addEventListener(
              "loadend",
              function () {
                traceLog("xhr done", { url: url, method: method, status: xhr.status });
              },
              { once: true }
            );
            xhr.addEventListener(
              "error",
              function () {
                traceError("xhr fail", { url: url, method: method, status: xhr.status });
              },
              { once: true }
            );
          }
          return originalSend.apply(xhr, arguments);
        };

        return xhr;
      }
      TracedXHR.__xyzwTracePatched = true;
      TracedXHR.prototype = OriginalXHR.prototype;
      window.XMLHttpRequest = TracedXHR;
    }
  }

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

  async function fetchManifestState(payload) {
    var config = resolveManifestConfig(payload);
    if (!config || config.enabled === false) {
      return null;
    }

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

    try {
      var response = await fetch(config.url, requestInit);
      if (!response.ok) {
        throw new Error("HTTP " + response.status + " while loading manifest " + config.url);
      }

      var text = await response.text();
      var parsed = tryParseJson(text);
      if (!parsed) {
        throw new Error("Invalid manifest JSON from " + config.url);
      }

      var normalized = normalizeManifestResponse(parsed);
      if (!normalized) {
        throw new Error("Invalid manifest payload from " + config.url);
      }

      normalized.url = config.url;
      normalized.request = requestInit;
      normalized.via = "fetch";
      return normalized;
    } catch (error) {
      var nativeState = tryReadNativeManifestState(config, requestInit, error);
      if (nativeState) {
        return nativeState;
      }
      throw error;
    }
  }

  function getManifestEligibleBundleNames(payload) {
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

    if (payload && typeof payload === "object") {
      append(payload.remoteBundles);
      if (payload.settings && typeof payload.settings === "object") {
        append(payload.settings.remoteBundles);
      }
    }

    if (names.length === 0) {
      var settings = getSettingsObject();
      if (settings && typeof settings === "object") {
        append(settings.remoteBundles);
      }
    }

    return names;
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

    var eligibleBundleNames = getManifestEligibleBundleNames(payload);
    var filteredBundleVers = filterManifestBundleVers(manifestState.bundleVers, eligibleBundleNames);
    manifestState.filteredBundleVers = filteredBundleVers;

    if (!payload.bundleVers || typeof payload.bundleVers !== "object") {
      payload.bundleVers = {};
    }

    Object.assign(payload.bundleVers, filteredBundleVers);
    if (manifestState.codeVersion) {
      payload.bundleVers.codeVersion = manifestState.codeVersion;
      payload.runtimeCodeVersion = manifestState.codeVersion;
    }

    if (payload.settings && typeof payload.settings === "object") {
      if (!payload.settings.bundleVers || typeof payload.settings.bundleVers !== "object") {
        payload.settings.bundleVers = {};
      }

      Object.assign(payload.settings.bundleVers, filteredBundleVers);
      if (manifestState.codeVersion) {
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
    return !!bundleName && getRemoteBundleNames().indexOf(bundleName) !== -1;
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
      traceLog("bundle handler start", {
        bundle: bundleName,
        target: target,
        resolvedTarget: resolvedTarget,
        version: version || "",
        remote: shouldForceRemoteBundleVersion(bundleName),
      });
      var finished = 0;
      var config = null;
      var error = null;

      jsonHandler(
        resolvedTarget + "/config." + (version ? version + "." : "") + "json",
        options,
        function (jsonError, jsonResult) {
          if (jsonError) {
            error = jsonError;
            traceError("bundle config fail", {
              bundle: bundleName,
              url: resolvedTarget + "/config." + (version ? version + "." : "") + "json",
              error: jsonError && jsonError.message ? jsonError.message : String(jsonError),
            });
          }

          if (jsonResult) {
            config = jsonResult;
            config.base = resolvedTarget + "/";
            traceLog("bundle config ok", {
              bundle: bundleName,
              url: resolvedTarget + "/config." + (version ? version + "." : "") + "json",
            });
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
            traceError("bundle script fail", {
              bundle: bundleName,
              url: resolvedTarget + "/index." + (version ? version + "." : "") + "js",
              error: scriptError && scriptError.message ? scriptError.message : String(scriptError),
            });
          } else {
            traceLog("bundle script ok", {
              bundle: bundleName,
              url: resolvedTarget + "/index." + (version ? version + "." : "") + "js",
            });
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
      var actualVersion = (actualOptions && actualOptions.version) || runtimeVersion || "";
      traceLog("loadBundle request", {
        bundle: bundleName,
        target: target,
        resolvedTarget: resolvedTarget,
        version: actualVersion,
        remote: shouldForceRemoteBundleVersion(bundleName),
      });

      if (typeof actualComplete === "function") {
        var originalComplete = actualComplete;
        actualComplete = function (error, bundle) {
          if (error) {
            traceError("loadBundle fail", {
              bundle: bundleName,
              resolvedTarget: resolvedTarget,
              version: actualVersion,
              error: error && error.message ? error.message : String(error),
            });
          } else {
            traceLog("loadBundle ok", {
              bundle: bundleName,
              resolvedTarget: resolvedTarget,
              version: actualVersion,
            });
          }
          return originalComplete.apply(this, arguments);
        };
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
      if (type === "bundle" || shouldTraceUrl(resolvedUrl)) {
        traceLog("downloader request", {
          id: id,
          url: url,
          resolvedUrl: resolvedUrl,
          type: type,
        });
      }
      return originalDownload(id, resolvedUrl, type, options, onComplete);
    };

    patchedDownload.__xyzwRemotePatched = true;
    patchedDownload.__xyzwOriginal = originalDownload;
    downloader.download = patchedDownload;
    return true;
  }

  function patchBundleAssetTracing() {
    if (!window.cc || !cc.AssetManager || !cc.AssetManager.Bundle) {
      return false;
    }

    var proto = cc.AssetManager.Bundle.prototype;
    if (!proto || proto.load.__xyzwTracePatched) {
      return true;
    }

    function wrapBundleMethod(methodName) {
      if (typeof proto[methodName] !== "function" || proto[methodName].__xyzwTracePatched) {
        return;
      }

      var original = proto[methodName];
      var wrapped = function () {
        var args = Array.prototype.slice.call(arguments);
        var request = args[0];
        traceLog("bundle." + methodName + " start", {
          bundle: this && this.name ? this.name : "",
          request: request,
        });
        if (typeof args[args.length - 1] === "function") {
          var originalCallback = args[args.length - 1];
          args[args.length - 1] = function (error, asset) {
            if (error) {
              traceError("bundle." + methodName + " fail", {
                bundle: this && this.name ? this.name : "",
                request: request,
                error: error && error.message ? error.message : String(error),
              });
            } else {
              traceLog("bundle." + methodName + " ok", {
                bundle: this && this.name ? this.name : "",
                request: request,
                asset: asset && asset.name ? asset.name : "",
              });
            }
            return originalCallback.apply(this, arguments);
          };
        }
        return original.apply(this, args);
      };
      wrapped.__xyzwTracePatched = true;
      proto[methodName] = wrapped;
    }

    wrapBundleMethod("load");
    wrapBundleMethod("loadDir");
    wrapBundleMethod("loadScene");
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

    ensureAppTitle().textContent = titleText || "汤姆之王";
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

    if (payload && typeof payload.version === "string" && payload.version) {
      return payload.version;
    }

    return null;
  }

  function resolveEffectiveCodeVersion(payload) {
    return resolveDisplayedCodeVersion(payload);
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
    window.__XYZW_EFFECTIVE_CODE_VERSION__ = resolveEffectiveCodeVersion(payload);
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
    updateAppTitle("汤姆之王");
    updateVersionBadge("读取中", "正在加载版本");

    try {
      await loadRemoteVersionConfig();
    } catch (error) {
      console.warn("[boot] failed to load remote version config, fallback to embedded settings.", error);
      mergeRuntimeSettings(window._CCSettings || {});
      window.__XYZW_EFFECTIVE_CODE_VERSION__ = resolveEffectiveCodeVersion(null);
      renderVersionBadge(null);
    }

    mergeRuntimeSettings(window._CCSettings || {});

    if (HIDE_BUILTIN_CODE_VERSION) {
      globalThis.__XYZW_REAL_CODE_VERSION__ = globalThis.CODE_VERSION;
      globalThis.CODE_VERSION = "";
    }

    patchRemoteBundleDownloader();
    patchAssetManagerLoadBundle();
    patchDownloaderDownload();
    patchBundleAssetTracing();

    hideSplash();

    if (typeof window.boot === "function") {
      window.boot();
    } else {
      console.error("window.boot is not defined!");
    }
  }

  window.addEventListener("load", function () {
    startGame();
  });

  patchFetchAndXHRTracing();
})();
