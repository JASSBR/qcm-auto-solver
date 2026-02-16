// inject.js — MAIN world, runs BEFORE any page/framework scripts
// Handles: isTrusted spoofing, anti-fingerprinting, and DOM interaction bridge

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

  // ---- 3. Save & lock native setters ----
  const nativeCheckedSet = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "checked"
  )?.set;
  const nativeValueSet = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value"
  )?.set;

  try {
    Object.defineProperty(HTMLInputElement.prototype, "checked", {
      get: Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "checked").get,
      set: nativeCheckedSet,
      configurable: false,
    });
  } catch (e) {}

  // ---- 4. Anti-fingerprinting ----
  try {
    Object.defineProperty(navigator, "webdriver", {
      get: () => false,
      configurable: false,
    });
  } catch (e) {}

  try {
    if (window.chrome?.runtime?.id) delete window.chrome.runtime.id;
  } catch (e) {}

  // ---- 5. Block page from re-defining overrides ----
  const origDefine = Object.defineProperty;
  Object.defineProperty = function (obj, prop, descriptor) {
    if (obj === HTMLInputElement.prototype && (prop === "checked" || prop === "value")) return obj;
    if (obj === EventTarget.prototype && (prop === "dispatchEvent" || prop === "addEventListener")) return obj;
    if (obj === Event.prototype && prop === "isTrusted") return obj;
    if (obj === navigator && prop === "webdriver") return obj;
    return origDefine.call(this, obj, prop, descriptor);
  };
  Object.defineProperty.toString = () =>
    "function defineProperty() { [native code] }";

  // ==================================================================
  //  6. MAIN WORLD BRIDGE — receives commands from content.js (ISOLATED)
  //     and performs DOM interaction in the MAIN world where Vue/React live
  // ==================================================================

  window.addEventListener("message", (e) => {
    if (e.source !== window) return;
    if (!e.data || e.data.__qcm !== true) return;

    const { action, selector, clickSelector } = e.data;

    if (action === "check") {
      // Set checked + dispatch change/input in MAIN world
      const el = document.querySelector(selector);
      if (!el) return;

      if (nativeCheckedSet) {
        nativeCheckedSet.call(el, true);
      } else {
        el.checked = true;
      }

      // Dispatch events in MAIN world — Vue's v-model WILL react to these
      el.dispatchEvent(new Event("change", { bubbles: true }));
      el.dispatchEvent(new Event("input", { bubbles: true }));

      // Also try Vue's _vei direct invoker (only accessible from MAIN world)
      try {
        if (el._vei) {
          const invoker = el._vei.onChange || el._vei.onchange;
          if (invoker) {
            const evt = new Event("change", { bubbles: true });
            Object.defineProperty(evt, "target", { value: el, writable: false });
            invoker(evt);
          }
        }
      } catch (err) {}
    }

    if (action === "click") {
      // Click an element (button, div) in MAIN world
      const el = document.querySelector(clickSelector || selector);
      if (!el) return;

      el.click();

      // Try Vue's _vei onClick
      try {
        if (el._vei) {
          const invoker = el._vei.onClick || el._vei.onclick;
          if (invoker) invoker(new MouseEvent("click", { bubbles: true }));
        }
      } catch (err) {}
    }
  });
})();
