// inject.js — MAIN world, runs BEFORE page scripts
// Spoofs isTrusted via Proxy on addEventListener callbacks

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

    callback._qcmWrapped = wrapped;
    return origAdd.call(this, type, wrapped, options);
  };

  EventTarget.prototype.removeEventListener = function (type, callback, options) {
    return origRemove.call(this, type, callback?._qcmWrapped || callback, options);
  };

  // ---- 2. Lock dispatchEvent so the page can't hook it ----
  const origDispatch = EventTarget.prototype.dispatchEvent;
  try {
    Object.defineProperty(EventTarget.prototype, "dispatchEvent", {
      value: origDispatch,
      writable: false,
      configurable: false,
    });
  } catch (e) {}

  // ---- 3. Lock HTMLInputElement.checked setter ----
  try {
    const desc = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "checked"
    );
    Object.defineProperty(HTMLInputElement.prototype, "checked", {
      get: desc.get,
      set: desc.set,
      configurable: false,
    });
  } catch (e) {}

  // ---- 4. Block page from re-defining our overrides ----
  const origDefine = Object.defineProperty;
  Object.defineProperty = function (obj, prop, descriptor) {
    if (obj === HTMLInputElement.prototype && prop === "checked") return obj;
    if (obj === EventTarget.prototype && prop === "dispatchEvent") return obj;
    if (obj === Event.prototype && prop === "isTrusted") return obj;
    return origDefine.call(this, obj, prop, descriptor);
  };
  Object.defineProperty.toString = () =>
    "function defineProperty() { [native code] }";
})();
