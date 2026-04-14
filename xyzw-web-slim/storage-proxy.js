(function () {
  try {
    var search = new URLSearchParams(window.location.search || "");
    var sessionId = String(search.get("sessionId") || "").trim();
    if (!sessionId || !window.localStorage) {
      return;
    }

    var storage = window.localStorage;
    if (storage.__xyzwSessionScoped) {
      return;
    }

    var prefix = "xyzw:sess:" + sessionId + ":";
    var bypassExact = {
      "xyzw-slim-launch-account": true,
      "xyzw-slim-launch-accounts": true,
    };
    var bypassPrefixes = ["xyzw-slim-launch:"];

    function shouldBypass(key) {
      var text = String(key == null ? "" : key);
      if (!text) return true;
      if (bypassExact[text]) return true;
      for (var index = 0; index < bypassPrefixes.length; index += 1) {
        if (text.indexOf(bypassPrefixes[index]) === 0) {
          return true;
        }
      }
      return false;
    }

    function wrapKey(key) {
      var text = String(key == null ? "" : key);
      return shouldBypass(text) ? text : prefix + text;
    }

    var originalGetItem = storage.getItem.bind(storage);
    var originalSetItem = storage.setItem.bind(storage);
    var originalRemoveItem = storage.removeItem.bind(storage);
    var originalClear = storage.clear.bind(storage);
    var originalKey = storage.key.bind(storage);
    var originalLengthDescriptor = Object.getOwnPropertyDescriptor(Storage.prototype, "length");

    function getRawLength() {
      try {
        return originalLengthDescriptor && typeof originalLengthDescriptor.get === "function"
          ? originalLengthDescriptor.get.call(storage)
          : 0;
      } catch (error) {
        return 0;
      }
    }

    storage.getItem = function (key) {
      return originalGetItem(wrapKey(key));
    };

    storage.setItem = function (key, value) {
      return originalSetItem(wrapKey(key), value);
    };

    storage.removeItem = function (key) {
      return originalRemoveItem(wrapKey(key));
    };

    storage.clear = function () {
      var keysToRemove = [];
      for (var index = 0; index < getRawLength(); index += 1) {
        var currentKey = originalKey(index);
        if (currentKey && currentKey.indexOf(prefix) === 0) {
          keysToRemove.push(currentKey);
        }
      }
      keysToRemove.forEach(function (item) {
        originalRemoveItem(item);
      });
    };

    storage.key = function (index) {
      var scopedKeys = [];
      for (var cursor = 0; cursor < getRawLength(); cursor += 1) {
        var currentKey = originalKey(cursor);
        if (currentKey && currentKey.indexOf(prefix) === 0) {
          scopedKeys.push(currentKey.slice(prefix.length));
        }
      }
      return scopedKeys[index] || null;
    };

    try {
      Object.defineProperty(storage, "length", {
        configurable: true,
        enumerable: false,
        get: function () {
          var size = 0;
          for (var index = 0; index < getRawLength(); index += 1) {
            var currentKey = originalKey(index);
            if (currentKey && currentKey.indexOf(prefix) === 0) {
              size += 1;
            }
          }
          return size;
        },
      });
    } catch (error) {}

    storage.__xyzwSessionScoped = true;
    window.__XYZW_STORAGE_SESSION_ID__ = sessionId;
  } catch (error) {
    console.warn("[xyzw-storage-proxy] init failed", error);
  }
})();
