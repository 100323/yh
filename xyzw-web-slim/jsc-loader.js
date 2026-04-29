(function () {
  /**
   * Optional Android bridge contract:
   * window.XYZWNativeJsc.fetchScript(bundleName, version, remoteJscUrl) => Promise<string>|string
   * window.XYZWNativeJsc.fetchConfig(bundleName, version, remoteConfigUrl) => Promise<string>|string
   *
   * Android 宿主可在 shouldInterceptRequest 之外额外暴露以上 bridge，
   * 让 file:// WebView 或极端跨域场景优先走 native 缓存/解密结果。
   */
  if (window.__XYZW_JSC_RUNTIME__) {
    return;
  }

  var DEFAULT_BUNDLES = ["launcher", "game", "TEST_REMOTE_MODULE"];
  var DEFAULT_REMOTE_ROOT = "remote";
  var DEFAULT_CACHE_KEEP = 3;
  var JSC_DECODER_REV = "20260429-r2";
  var JSC_CACHE_DB = "xyzw-slim-jsc-cache";
  var JSC_CACHE_STORE = "bundleFiles";
  var JSC_KEY = "0Aed5E79bbEa69f8";
  var JSC_OFFSETS = [0, 4, 8, 16];
  var JS_KEYWORDS = ["function", "let", "var", "const", "window", "require", "class"];
  var memoryPackageCache = Object.create(null);
  var scriptLoadState = Object.create(null);
  var logger = null;

  function log(label, payload) {
    try {
      if (typeof logger === "function") {
        logger(label, payload);
      }
    } catch (error) {}
  }

  function toArray(value) {
    return Array.isArray(value) ? value.slice() : [];
  }

  function getSettings(settingsOverride) {
    var source = settingsOverride && typeof settingsOverride === "object"
      ? settingsOverride
      : window.__XYZW_RUNTIME_SETTINGS__ || window._CCSettings || {};

    return {
      enabled: source.jscEnabled !== false,
      bundles: Array.isArray(source.jscBundles) && source.jscBundles.length > 0
        ? source.jscBundles.slice()
        : DEFAULT_BUNDLES.slice(),
      remoteRoot: typeof source.jscRemoteRoot === "string" && source.jscRemoteRoot
        ? source.jscRemoteRoot
        : DEFAULT_REMOTE_ROOT,
      cacheKeep: Number.isFinite(Number(source.jscCacheVersionsPerBundle))
        ? Math.max(1, Number(source.jscCacheVersionsPerBundle))
        : DEFAULT_CACHE_KEEP,
      configPrefetch: source.jscConfigPrefetch !== false,
      server: typeof source.server === "string" ? source.server : "",
    };
  }

  function shouldHandleBundle(bundleName, settingsOverride) {
    if (!bundleName) {
      return false;
    }
    var settings = getSettings(settingsOverride);
    return settings.enabled && settings.bundles.indexOf(bundleName) !== -1;
  }

  function trimSlash(value) {
    return String(value == null ? "" : value).replace(/\/+$/, "");
  }

  function trimBothSlash(value) {
    return String(value == null ? "" : value).replace(/^\/+|\/+$/g, "");
  }

  function resolveRemoteBundleRoot(bundleName, settingsOverride) {
    var settings = getSettings(settingsOverride);
    var root = trimSlash(settings.remoteRoot || DEFAULT_REMOTE_ROOT);
    if (!root) {
      root = DEFAULT_REMOTE_ROOT;
    }

    if (/^(?:https?:)?\/\//i.test(root)) {
      return trimSlash(root) + "/" + bundleName;
    }

    if (root.charAt(0) === "/") {
      if (settings.server) {
        return trimSlash(settings.server) + root + "/" + bundleName;
      }
      return trimSlash(root) + "/" + bundleName;
    }

    if (settings.server) {
      return trimSlash(settings.server) + "/" + trimBothSlash(root) + "/" + bundleName;
    }

    return trimBothSlash(root) + "/" + bundleName;
  }

  function resolveLocalBundleRoot(bundleName) {
    return "assets/" + bundleName;
  }

  function resolveEmbeddedBundleVersion(bundleName) {
    var source = window.__XYZW_EMBEDDED_BUNDLE_VERS__ || {};
    return source && source[bundleName] ? String(source[bundleName]) : "";
  }

  function makeCacheKey(bundleName, version) {
    return String(bundleName || "") + "@" + String(version || "") + "@" + JSC_DECODER_REV;
  }

  function safeJsonParse(text) {
    if (typeof text !== "string") {
      return null;
    }
    try {
      return JSON.parse(text);
    } catch (error) {
      return null;
    }
  }

  function decodeUtf8(bytes) {
    if (typeof TextDecoder !== "undefined") {
      try {
        return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
      } catch (error) {}
    }

    var chunk = [];
    for (var i = 0; i < bytes.length; i += 1) {
      chunk.push(String.fromCharCode(bytes[i]));
    }
    try {
      return decodeURIComponent(escape(chunk.join("")));
    } catch (error) {
      return chunk.join("");
    }
  }

  function sanitizeJsText(text) {
    var normalized = String(text == null ? "" : text).replace(/^\uFEFF/, "");
    var nulIndex = normalized.indexOf("\0");
    if (nulIndex !== -1) {
      normalized = normalized.slice(0, nulIndex);
    }

    var terminators = ["\"]);", "']);", "]);", "})();", "});", ";"];
    for (var i = 0; i < terminators.length; i += 1) {
      var marker = terminators[i];
      var endIndex = normalized.lastIndexOf(marker);
      if (endIndex === -1) {
        continue;
      }

      var tail = normalized.slice(endIndex + marker.length);
      if (!tail) {
        normalized = normalized.slice(0, endIndex + marker.length);
        break;
      }

      if (/[^\s]/.test(tail) && (tail.length < 64 || tail.indexOf("�") !== -1 || /[\0-\x08\x0b\x0c\x0e-\x1f]/.test(tail))) {
        normalized = normalized.slice(0, endIndex + marker.length);
        break;
      }
    }

    return normalized.trim();
  }

  function looksLikeJavaScript(text) {
    if (typeof text !== "string") {
      return false;
    }

    var normalized = sanitizeJsText(text);
    if (!normalized || normalized.length < 32) {
      return false;
    }

    var matched = 0;
    for (var i = 0; i < JS_KEYWORDS.length; i += 1) {
      if (normalized.indexOf(JS_KEYWORDS[i]) !== -1) {
        matched += 1;
      }
    }

    return matched > 0;
  }

  function stringToBytes(value) {
    var text = String(value == null ? "" : value);
    var bytes = new Uint8Array(text.length);
    for (var i = 0; i < text.length; i += 1) {
      bytes[i] = text.charCodeAt(i) & 0xff;
    }
    return bytes;
  }

  function bytesToUint32(bytes, includeLength, truncateToWord) {
    var length = bytes.length;
    var n = truncateToWord ? Math.floor(length / 4) : Math.ceil(length / 4);
    var result = new Array(includeLength ? n + 1 : n);
    for (var i = 0; i < result.length; i += 1) {
      result[i] = 0;
    }
    if (includeLength) {
      result[n] = truncateToWord ? n * 4 : length;
    }
    var maxLength = truncateToWord ? n * 4 : length;
    for (var index = 0; index < maxLength; index += 1) {
      result[index >>> 2] = (result[index >>> 2] | (bytes[index] << ((index & 3) << 3))) >>> 0;
    }
    return result;
  }

  function uint32ToBytes(values, includeLength) {
    var n = values.length << 2;
    var m = n;
    if (includeLength) {
      m = values[values.length - 1];
      if (m < n - 3 || m > n) {
        return null;
      }
    }

    var result = new Uint8Array(includeLength ? m : n);
    for (var i = 0; i < result.length; i += 1) {
      result[i] = (values[i >>> 2] >>> ((i & 3) << 3)) & 0xff;
    }
    return result;
  }

  function toUint32(value) {
    return value >>> 0;
  }

  function xxteaDecrypt(bytes, keyBytes) {
    if (!(bytes instanceof Uint8Array) || bytes.length === 0) {
      return new Uint8Array(0);
    }

    var v = bytesToUint32(bytes, false, true);
    if (v.length < 2) {
      return new Uint8Array(0);
    }

    var k = bytesToUint32(keyBytes, false, true);
    while (k.length < 4) {
      k.push(0);
    }

    var n = v.length - 1;
    var delta = 0x9e3779b9 >>> 0;
    var rounds = Math.floor(6 + 52 / (n + 1)) >>> 0;
    var sum = Math.imul(rounds, delta) >>> 0;
    var z = v[n] >>> 0;

    while (sum !== 0) {
      var e = (sum >>> 2) & 3;
      for (var p = n; p > 0; p -= 1) {
        z = v[p - 1] >>> 0;
        var y = v[p === n ? 0 : (p + 1)] >>> 0;
        var mx =
          ((((z >>> 5) ^ ((y << 2) >>> 0)) + ((y >>> 3) ^ ((z << 4) >>> 0))) ^
            ((sum ^ y) + ((k[(p & 3) ^ e] >>> 0) ^ z))) >>> 0;
        v[p] = (v[p] - mx) >>> 0;
      }
      z = v[n] >>> 0;
      var headY = v[1] >>> 0;
      var headMx =
        ((((z >>> 5) ^ ((headY << 2) >>> 0)) + ((headY >>> 3) ^ ((z << 4) >>> 0))) ^
          ((sum ^ headY) + ((k[e] >>> 0) ^ z))) >>> 0;
      v[0] = (v[0] - headMx) >>> 0;
      sum = (sum - delta) >>> 0;
    }

    return uint32ToBytes(v, false);
  }

  function decryptJscToText(inputBytes) {
    var bytes = inputBytes instanceof Uint8Array ? inputBytes : new Uint8Array(inputBytes || 0);
    if (!bytes.length) {
      throw new Error("empty_jsc_payload");
    }

    var plainText = sanitizeJsText(decodeUtf8(bytes));
    if (looksLikeJavaScript(plainText)) {
      return {
        text: plainText,
        offset: 0,
        mode: "plain",
      };
    }

    var keyBytes = stringToBytes(JSC_KEY);
    var lastError = null;

    for (var i = 0; i < JSC_OFFSETS.length; i += 1) {
      var offset = JSC_OFFSETS[i];
      if (offset >= bytes.length) {
        continue;
      }

      try {
        var decryptedBytes = xxteaDecrypt(bytes.subarray(offset), keyBytes);
        if (!decryptedBytes || !decryptedBytes.length) {
          continue;
        }

        var text = sanitizeJsText(decodeUtf8(decryptedBytes));
        if (looksLikeJavaScript(text)) {
          return {
            text: text,
            offset: offset,
            mode: "xxtea",
          };
        }
      } catch (error) {
        lastError = error;
      }
    }

    throw new Error(
      "decrypt_failed" + (lastError && lastError.message ? ":" + lastError.message : "")
    );
  }

  function openDatabase() {
    if (typeof indexedDB === "undefined") {
      return Promise.resolve(null);
    }

    return new Promise(function (resolve, reject) {
      var request = indexedDB.open(JSC_CACHE_DB, 1);

      request.onupgradeneeded = function () {
        var db = request.result;
        if (!db.objectStoreNames.contains(JSC_CACHE_STORE)) {
          var store = db.createObjectStore(JSC_CACHE_STORE, { keyPath: "cacheKey" });
          store.createIndex("bundle", "bundle", { unique: false });
          store.createIndex("updatedAt", "updatedAt", { unique: false });
        }
      };

      request.onsuccess = function () {
        resolve(request.result || null);
      };

      request.onerror = function () {
        reject(request.error || new Error("indexeddb_open_failed"));
      };
    }).catch(function (error) {
      log("indexeddb-open-failed", error && error.message ? error.message : String(error));
      return null;
    });
  }

  function withStore(mode, action) {
    return openDatabase().then(function (db) {
      if (!db) {
        return null;
      }

      return new Promise(function (resolve, reject) {
        var tx = db.transaction(JSC_CACHE_STORE, mode);
        var store = tx.objectStore(JSC_CACHE_STORE);
        var result = action(store, resolve, reject);
        tx.onabort = function () {
          reject(tx.error || new Error("indexeddb_tx_abort"));
        };
        tx.onerror = function () {
          reject(tx.error || new Error("indexeddb_tx_error"));
        };
        if (result !== undefined) {
          resolve(result);
        }
      }).finally(function () {
        try {
          db.close();
        } catch (error) {}
      });
    });
  }

  function cacheGet(cacheKey) {
    return withStore("readonly", function (store, resolve, reject) {
      var request = store.get(cacheKey);
      request.onsuccess = function () {
        resolve(request.result || null);
      };
      request.onerror = function () {
        reject(request.error || new Error("indexeddb_get_failed"));
      };
    }).catch(function () {
      return null;
    });
  }

  function cachePut(record) {
    if (!record || !record.cacheKey) {
      return Promise.resolve();
    }

    return withStore("readwrite", function (store, resolve, reject) {
      var request = store.put(record);
      request.onsuccess = function () {
        resolve();
      };
      request.onerror = function () {
        reject(request.error || new Error("indexeddb_put_failed"));
      };
    }).catch(function (error) {
      log("indexeddb-put-failed", error && error.message ? error.message : String(error));
    });
  }

  function cacheListByBundle(bundleName) {
    return withStore("readonly", function (store, resolve, reject) {
      var index = store.index("bundle");
      var request = index.getAll(IDBKeyRange.only(bundleName));
      request.onsuccess = function () {
        resolve(Array.isArray(request.result) ? request.result : []);
      };
      request.onerror = function () {
        reject(request.error || new Error("indexeddb_list_failed"));
      };
    }).catch(function () {
      return [];
    });
  }

  function cacheDelete(cacheKey) {
    return withStore("readwrite", function (store, resolve, reject) {
      var request = store.delete(cacheKey);
      request.onsuccess = function () {
        resolve();
      };
      request.onerror = function () {
        reject(request.error || new Error("indexeddb_delete_failed"));
      };
    }).catch(function () {});
  }

  function pruneBundleCache(bundleName, keepCount) {
    return cacheListByBundle(bundleName).then(function (records) {
      if (!Array.isArray(records) || records.length <= keepCount) {
        return;
      }

      records.sort(function (a, b) {
        return Number(b.updatedAt || 0) - Number(a.updatedAt || 0);
      });

      var removals = records.slice(keepCount).map(function (item) {
        return cacheDelete(item.cacheKey);
      });

      return Promise.all(removals);
    });
  }

  function createBlobUrl(jsText) {
    var blob = new Blob([jsText], { type: "application/javascript;charset=utf-8" });
    return URL.createObjectURL(blob);
  }

  function ensureTrailingSlash(value) {
    var text = String(value == null ? "" : value);
    return /\/$/.test(text) ? text : text + "/";
  }

  function joinRemotePath(root, nextPath) {
    var left = trimSlash(root);
    var right = trimBothSlash(nextPath);
    return right ? left + "/" + right : left;
  }

  function normalizeBundleConfig(config, baseRoot) {
    if (!config || typeof config !== "object") {
      return config;
    }

    var normalized = Object.assign({}, config);
    var rootWithSlash = ensureTrailingSlash(trimSlash(baseRoot));
    normalized.base = rootWithSlash;
    normalized.importBase = trimBothSlash(config.importBase || "import");
    normalized.nativeBase = trimBothSlash(config.nativeBase || "native");
    normalized.__xyzwRemoteBundle = /^(?:https?:)?\/\//i.test(String(baseRoot || ""));
    normalized.__xyzwResolvedBase = rootWithSlash;
    return normalized;
  }

  async function fetchTextViaBridge(methodName, args) {
    var bridge = window.XYZWNativeJsc;
    if (!bridge || typeof bridge[methodName] !== "function") {
      return null;
    }

    try {
      var result = bridge[methodName].apply(bridge, args || []);
      if (result && typeof result.then === "function") {
        result = await result;
      }
      return typeof result === "string" ? result : null;
    } catch (error) {
      log("bridge-fetch-failed", {
        method: methodName,
        message: error && error.message ? error.message : String(error),
      });
      return null;
    }
  }

  async function fetchArrayBuffer(url) {
    var response = await fetch(url, {
      cache: "no-store",
      credentials: "omit",
    });
    if (!response.ok) {
      throw new Error("HTTP " + response.status + " @ " + url);
    }
    return response.arrayBuffer();
  }

  async function fetchJson(url) {
    var response = await fetch(url, {
      cache: "no-store",
      credentials: "omit",
    });
    if (!response.ok) {
      throw new Error("HTTP " + response.status + " @ " + url);
    }
    return response.json();
  }

  async function fetchRemoteConfig(bundleName, version, remoteRoot) {
    var configUrl = trimSlash(remoteRoot) + "/config." + (version ? version + "." : "") + "json";
    log("remote-config-request", {
      bundle: bundleName,
      version: version,
      url: configUrl,
    });
    var bridgeText = await fetchTextViaBridge("fetchConfig", [bundleName, version, configUrl]);
    if (bridgeText) {
      var parsed = safeJsonParse(bridgeText);
      if (parsed && typeof parsed === "object") {
        log("remote-config-ok", {
          bundle: bundleName,
          version: version,
          via: "bridge",
          url: configUrl,
        });
        return {
          config: parsed,
          configUrl: configUrl,
          via: "bridge",
        };
      }
    }

    var remoteConfig = await fetchJson(configUrl);
    log("remote-config-ok", {
      bundle: bundleName,
      version: version,
      via: "remote",
      url: configUrl,
    });
    return {
      config: remoteConfig,
      configUrl: configUrl,
      via: "remote",
    };
  }

  async function fetchRemoteScript(bundleName, version, remoteRoot) {
    var jscUrl = trimSlash(remoteRoot) + "/index." + (version ? version + "." : "") + "jsc";
    log("remote-script-request", {
      bundle: bundleName,
      version: version,
      url: jscUrl,
    });
    var bridgeText = await fetchTextViaBridge("fetchScript", [bundleName, version, jscUrl]);
    if (bridgeText && looksLikeJavaScript(bridgeText)) {
      log("decrypt-ok", {
        bundle: bundleName,
        version: version,
        mode: "bridge",
        offset: 0,
        url: jscUrl,
      });
      return {
        jsText: sanitizeJsText(bridgeText),
        jscUrl: jscUrl,
        decryptMeta: { mode: "bridge", offset: 0 },
        via: "bridge",
      };
    }

    var bytes = new Uint8Array(await fetchArrayBuffer(jscUrl));
    var decrypted = decryptJscToText(bytes);
    log("decrypt-ok", {
      bundle: bundleName,
      version: version,
      mode: decrypted.mode,
      offset: decrypted.offset,
      byteLength: bytes.length,
      url: jscUrl,
    });
    return {
      jsText: decrypted.text,
      jscUrl: jscUrl,
      decryptMeta: {
        mode: decrypted.mode,
        offset: decrypted.offset,
      },
      via: "remote",
    };
  }

  async function fetchLocalPackage(bundleName, version, localRoot) {
    var localVersion = String(version || "");
    var configUrl = trimSlash(localRoot) + "/config." + (localVersion ? localVersion + "." : "") + "json";
    var scriptUrl = trimSlash(localRoot) + "/index." + (localVersion ? localVersion + "." : "") + "js";
    var config = await fetchJson(configUrl);
    log("local-package-ok", {
      bundle: bundleName,
      version: localVersion,
      scriptUrl: scriptUrl,
      configUrl: configUrl,
    });
    return {
      cacheKey: makeCacheKey(bundleName, localVersion),
      bundleName: bundleName,
      version: localVersion,
      source: "local",
      mode: "url",
      scriptUrl: scriptUrl,
      config: normalizeBundleConfig(config, localRoot),
      baseRoot: trimSlash(localRoot),
      configUrl: configUrl,
    };
  }

  async function getRemotePackage(bundleName, version, remoteRoot, settingsOverride) {
    var cacheKey = makeCacheKey(bundleName, version);
    var cachedRecord = memoryPackageCache[cacheKey];
    if (cachedRecord && cachedRecord.jsText && cachedRecord.configJson) {
      log("bundle-cache-hit", {
        bundle: bundleName,
        version: version,
        cache: "memory",
      });
    }
    if (!cachedRecord) {
      cachedRecord = await cacheGet(cacheKey);
      if (cachedRecord && cachedRecord.jsText && cachedRecord.configJson) {
        log("bundle-cache-hit", {
          bundle: bundleName,
          version: version,
          cache: "indexeddb",
        });
      }
    }

    if (cachedRecord && cachedRecord.jsText && cachedRecord.configJson) {
      memoryPackageCache[cacheKey] = cachedRecord;
      return {
        cacheKey: cacheKey,
        bundleName: bundleName,
        version: version,
        source: cachedRecord.source || "cache",
        mode: "blob",
        jsText: cachedRecord.jsText,
        blobUrl: cachedRecord.blobUrl || createBlobUrl(cachedRecord.jsText),
        config: normalizeBundleConfig(cachedRecord.configJson, remoteRoot),
        baseRoot: trimSlash(remoteRoot),
        configUrl: cachedRecord.configUrl || "",
      };
    }

    var remoteResults = await Promise.all([
      fetchRemoteScript(bundleName, version, remoteRoot),
      fetchRemoteConfig(bundleName, version, remoteRoot),
    ]);

    var scriptResult = remoteResults[0];
    var configResult = remoteResults[1];
    var record = {
      cacheKey: cacheKey,
      bundle: bundleName,
      version: version,
      source: scriptResult.via === "bridge" || configResult.via === "bridge" ? "bridge" : "remote",
      jsText: scriptResult.jsText,
      configJson: configResult.config,
      configUrl: configResult.configUrl,
      jscUrl: scriptResult.jscUrl,
      updatedAt: Date.now(),
    };

    memoryPackageCache[cacheKey] = record;
    cachePut(record);
    log("cache-store-ok", {
      bundle: bundleName,
      version: version,
      source: record.source,
    });
    pruneBundleCache(bundleName, getSettings(settingsOverride).cacheKeep);

    return {
      cacheKey: cacheKey,
      bundleName: bundleName,
      version: version,
      source: record.source,
      mode: "blob",
      jsText: scriptResult.jsText,
      blobUrl: createBlobUrl(scriptResult.jsText),
      config: normalizeBundleConfig(configResult.config, remoteRoot),
      baseRoot: trimSlash(remoteRoot),
      configUrl: configResult.configUrl,
    };
  }

  async function getBestLocalPackage(bundleName, requestedVersion, localRoot) {
    var candidates = [];
    if (requestedVersion) {
      candidates.push(String(requestedVersion));
    }
    var embeddedVersion = resolveEmbeddedBundleVersion(bundleName);
    if (embeddedVersion && candidates.indexOf(embeddedVersion) === -1) {
      candidates.push(embeddedVersion);
    }

    var lastError = null;
    for (var i = 0; i < candidates.length; i += 1) {
      try {
        return await fetchLocalPackage(bundleName, candidates[i], localRoot);
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError || new Error("local_bundle_not_found");
  }

  function ensureScriptLoaded(pkg, scriptHandler, options) {
    var stateKey = pkg.cacheKey + ":" + pkg.source;
    if (scriptLoadState[stateKey]) {
      return scriptLoadState[stateKey];
    }

    var scriptUrl = pkg.mode === "blob"
      ? (pkg.blobUrl || (pkg.blobUrl = createBlobUrl(pkg.jsText)))
      : pkg.scriptUrl;

    scriptLoadState[stateKey] = new Promise(function (resolve, reject) {
      scriptHandler(scriptUrl, options, function (error) {
        if (error) {
          delete scriptLoadState[stateKey];
          reject(error);
          return;
        }
        log("bundle-script-loaded", {
          bundle: pkg.bundleName,
          version: pkg.version,
          source: pkg.source,
          mode: pkg.mode,
          scriptUrl: scriptUrl,
        });
        resolve();
      });
    });

    return scriptLoadState[stateKey];
  }

  async function loadBundlePackage(params) {
    var bundleName = String(params && params.bundleName ? params.bundleName : "");
    var version = String(params && params.version ? params.version : "");
    var settings = getSettings(params && params.settings ? params.settings : null);
    var scriptHandler = params && params.scriptHandler;
    var options = (params && params.options) || {};
    var remoteRoot = trimSlash(params && params.remoteRoot ? params.remoteRoot : resolveRemoteBundleRoot(bundleName, settings));
    var localRoot = trimSlash(params && params.localRoot ? params.localRoot : resolveLocalBundleRoot(bundleName));

    if (!bundleName || typeof scriptHandler !== "function") {
      throw new Error("invalid_bundle_request");
    }

    var lastError = null;
    log("bundle-load-start", {
      bundle: bundleName,
      version: version,
      remoteRoot: remoteRoot,
      localRoot: localRoot,
    });

    try {
      var remotePackage = await getRemotePackage(bundleName, version, remoteRoot, settings);
      await ensureScriptLoaded(remotePackage, scriptHandler, options);
      log("bundle-remote-ok", {
        bundle: bundleName,
        version: version,
        source: remotePackage.source,
      });
      return remotePackage.config;
    } catch (error) {
      lastError = error;
      log("bundle-remote-failed", {
        bundle: bundleName,
        version: version,
        message: error && error.message ? error.message : String(error),
      });
    }

    var localPackage = await getBestLocalPackage(bundleName, version, localRoot);
    await ensureScriptLoaded(localPackage, scriptHandler, options);
    log("bundle-local-fallback", {
      bundle: bundleName,
      requestedVersion: version,
      actualVersion: localPackage.version,
      remoteError: lastError && lastError.message ? lastError.message : "",
    });
    return localPackage.config;
  }

  window.__XYZW_JSC_RUNTIME__ = {
    setLogger: function (nextLogger) {
      logger = typeof nextLogger === "function" ? nextLogger : null;
    },
    getSettings: getSettings,
    shouldHandleBundle: shouldHandleBundle,
    resolveRemoteBundleRoot: resolveRemoteBundleRoot,
    resolveLocalBundleRoot: resolveLocalBundleRoot,
    resolveEmbeddedBundleVersion: resolveEmbeddedBundleVersion,
    decryptJscToText: decryptJscToText,
    loadBundlePackage: loadBundlePackage,
  };
})();
