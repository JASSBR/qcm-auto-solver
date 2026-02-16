// inject.js — MAIN world, runs BEFORE any page/framework scripts
// Handles: isTrusted spoofing, React compatibility, anti-fingerprinting

(() => {
  // ---- 1. Wrap addEventListener: every handler sees isTrusted = true ----
  const origAdd = EventTarget.prototype.addEventListener;
  const origRemove = EventTarget.prototype.removeEventListener;

  EventTarget.prototype.addEventListener = function (type, callback, options) {
    if (typeof callback !== "function") {
      return origAdd.call(this, type, callback, options);
    }

    const wrapped = function (event) {
      const spoofed = new Proxy(event, {
        get(target, prop) {
          if (prop === "isTrusted") return true;
          const val = target[prop];
          return typeof val === "function" ? val.bind(target) : val;
        },
      });
      return callback.call(this, spoofed);
    };

    callback._qcmW = wrapped;
    return origAdd.call(this, type, wrapped, options);
  };

  // Preserve native toString to avoid detection
  EventTarget.prototype.addEventListener.toString = () =>
    "function addEventListener() { [native code] }";

  EventTarget.prototype.removeEventListener = function (
    type,
    callback,
    options
  ) {
    return origRemove.call(this, type, callback?._qcmW || callback, options);
  };

  // ---- 2. Lock dispatchEvent ----
  const origDispatch = EventTarget.prototype.dispatchEvent;
  try {
    Object.defineProperty(EventTarget.prototype, "dispatchEvent", {
      value: origDispatch,
      writable: false,
      configurable: false,
    });
  } catch (e) {}

  // ---- 3. Lock native setters (checked, value) ----
  // Save references so content.js can use them via window.__nativeSetters
  try {
    const checkedDesc = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "checked"
    );
    const valueDesc = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value"
    );

    // Expose native setters for React-compatible triggering
    window.__nativeSetters = {
      checked: checkedDesc.set,
      value: valueDesc.set,
    };

    Object.defineProperty(HTMLInputElement.prototype, "checked", {
      get: checkedDesc.get,
      set: checkedDesc.set,
      configurable: false,
    });

    Object.defineProperty(HTMLInputElement.prototype, "value", {
      get: valueDesc.get,
      set: valueDesc.set,
      configurable: false,
    });
  } catch (e) {}

  // ---- 4. Anti-fingerprinting: hide automation signals ----

  // Hide webdriver flag (Puppeteer/Selenium detection)
  try {
    Object.defineProperty(navigator, "webdriver", {
      get: () => false,
      configurable: false,
    });
  } catch (e) {}

  // Hide chrome.runtime from page context (extension detection)
  // Note: only in MAIN world — content script still has access
  try {
    if (window.chrome && window.chrome.runtime && window.chrome.runtime.id) {
      delete window.chrome.runtime.id;
    }
  } catch (e) {}

  // ---- 5. Block page from re-defining our overrides ----
  const origDefine = Object.defineProperty;
  Object.defineProperty = function (obj, prop, descriptor) {
    // Block re-hooks on critical properties
    if (obj === HTMLInputElement.prototype && (prop === "checked" || prop === "value")) return obj;
    if (obj === EventTarget.prototype && (prop === "dispatchEvent" || prop === "addEventListener")) return obj;
    if (obj === Event.prototype && prop === "isTrusted") return obj;
    if (obj === navigator && prop === "webdriver") return obj;
    return origDefine.call(this, obj, prop, descriptor);
  };
  Object.defineProperty.toString = () =>
    "function defineProperty() { [native code] }";
})();
