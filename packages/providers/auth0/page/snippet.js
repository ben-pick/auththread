(() => {
  var meta = document.querySelector('meta[name="auththread"]');
  if (!meta) return;

  var config = {};
  try {
    config = JSON.parse(meta.getAttribute("content") || "{}");
  } catch {
    config = {};
  }

  function setting(name) {
    var value = meta.getAttribute("data-" + name);
    return value === null ? config[name] : value;
  }

  var endpoint = setting("endpoint");
  var key = setting("key");
  var traceId = setting("traceId") || setting("trace-id");
  var screen = setting("screen") || config.screen;
  var legacyStep = setting("step") || config.step;
  var clientId = setting("clientId") || setting("client-id") || config.clientId;
  var locale = setting("locale") || config.locale;

  if (!endpoint || typeof traceId !== "string") return;
  if (!/^[0-9a-f]{32}$/.test(traceId)) return;

  var path = location.pathname;
  var startedAt = Math.round(
    typeof performance !== "undefined" &&
      typeof performance.timeOrigin === "number"
      ? performance.timeOrigin
      : Date.now(),
  );
  var sent = false;
  var sentCount = 0;
  var submitted = false;
  var submittedAt = 0;
  var submits = 0;
  var firstInputAt = null;
  var autofill = false;
  var hiddenSince = 0;
  var hiddenMs = 0;
  var visibilityChanges = 0;
  var exceptions = 0;
  var exceptionName = null;
  var passkeyAttempts = 0;
  var passkeyMs = 0;
  var passkeyResult = null;
  var delegated = false;
  var method = null;
  var methodVendorName = null;

  var STATE_KEY = "auththread.ui";
  var previous = null;
  try {
    previous = JSON.parse(sessionStorage.getItem(STATE_KEY) || "null");
  } catch {
    previous = null;
  }
  var repeat =
    previous !== null &&
    previous.screen === screen &&
    typeof previous.submittedAt === "number";
  var transitionMs =
    previous !== null && typeof previous.submittedAt === "number"
      ? Math.max(0, startedAt - previous.submittedAt)
      : null;

  try {
    sessionStorage.setItem(
      STATE_KEY,
      JSON.stringify({ screen: screen || "", startedAt: startedAt }),
    );
  } catch {
    // Storage may be blocked. Telemetry is still best effort.
  }

  var nav = null;
  try {
    nav = performance.getEntriesByType("navigation")[0] || null;
  } catch {
    nav = null;
  }
  var dcl = nav ? nav.domContentLoadedEventEnd : 0;
  var loadMs = dcl > 0 ? Math.round(dcl) : 0;
  var ttfbMs =
    nav && nav.responseStart > 0 && nav.requestStart >= 0
      ? Math.round(nav.responseStart - nav.requestStart)
      : 0;

  function now() {
    return typeof performance !== "undefined" &&
      typeof performance.now === "function"
      ? performance.now()
      : Date.now() - startedAt;
  }

  function spanId() {
    var bytes = new Uint8Array(8);
    crypto.getRandomValues(bytes);
    return Array.prototype.map
      .call(bytes, (byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  }

  function endHidden() {
    if (hiddenSince > 0) {
      hiddenMs += Math.max(0, now() - hiddenSince);
      hiddenSince = 0;
    }
  }

  function primaryForm(target) {
    if (!target || target.tagName !== "FORM") return false;
    return (
      target.querySelector(
        'input[type="password"],input[type="email"],input[type="tel"],input[name="username"],input[name="email"],input[name="phone_number"],input[name="code"],input[name="otp"],input[autocomplete="one-time-code"]',
      ) !== null
    );
  }

  function validationErrors() {
    var nodes = document.querySelectorAll(
      '[role="alert"], [aria-live="assertive"]',
    );
    var i;
    for (i = 0; i < nodes.length; i += 1) {
      if ((nodes[i].textContent || "").trim().length > 0) return 1;
    }
    return 0;
  }

  function attributes(abandoned) {
    endHidden();
    var attrs = {
      "auth.provider": "auth0",
      "auth.ui.vendor_path": path,
      "auth.ui.abandoned": abandoned,
      "auth.ui.load_ms": loadMs,
      "auth.ui.ttfb_ms": ttfbMs,
      "auth.ui.submits": submits,
      "auth.ui.validation_errors": validationErrors(),
      "auth.ui.exceptions": exceptions,
      "auth.ui.hidden_ms": Math.round(hiddenMs),
      "auth.ui.visibility_changes": visibilityChanges,
      "auth.ui.repeat": repeat,
      "auth.ui.autofill": autofill,
      "auth.ui.delegated": delegated,
    };
    if (clientId) attrs["auth.client_id"] = clientId;
    if (locale) attrs["auth.ui.locale"] = locale;
    if (screen) attrs["auth.ui.vendor_screen"] = screen;
    else if (legacyStep) attrs["auth.ui.step"] = legacyStep;
    if (transitionMs !== null) attrs["auth.ui.transition_ms"] = transitionMs;
    if (firstInputAt !== null) {
      attrs["auth.ui.first_input_ms"] = Math.round(
        Math.max(0, firstInputAt - dcl),
      );
    }
    if (exceptionName) attrs["auth.ui.exception"] = exceptionName;
    if (passkeyAttempts > 0) {
      attrs["auth.ui.passkey_attempts"] = passkeyAttempts;
      attrs["auth.ui.passkey_ms"] = Math.round(passkeyMs);
      if (passkeyResult) attrs["auth.passkey.result"] = passkeyResult;
    }
    if (method) attrs["auth.method"] = method;
    if (methodVendorName) attrs["auth.method.vendor_name"] = methodVendorName;
    return attrs;
  }

  function send(abandoned) {
    if (sent || sentCount >= 10) return;
    sent = true;
    sentCount += 1;

    var span = {
      traceId: traceId,
      spanId: spanId(),
      name: "auth.ui.screen",
      startMs: startedAt,
      durationMs: Math.max(0, Math.round(now())),
      attributes: attributes(abandoned),
      status: { code: "unset" },
    };
    var headers = { "content-type": "application/json" };
    if (key) headers.authorization = `Bearer ${key}`;
    try {
      fetch(`${endpoint.replace(/\/$/, "")}/v1/compact-spans`, {
        method: "POST",
        headers: headers,
        body: JSON.stringify({ spans: [span] }),
        keepalive: true,
      }).catch(() => undefined);
    } catch {
      // The login must continue even if telemetry cannot be sent.
    }
  }

  function remember(submittedAtMs) {
    try {
      sessionStorage.setItem(
        STATE_KEY,
        JSON.stringify({
          screen: screen || "",
          startedAt: startedAt,
          ...(submittedAtMs === undefined
            ? {}
            : { submittedAt: submittedAtMs }),
        }),
      );
    } catch {
      // Ignore storage failures.
    }
  }

  document.addEventListener(
    "submit",
    (event) => {
      if (!primaryForm(event.target)) return;
      submits += 1;
      submitted = true;
      submittedAt = Math.round(startedAt + now());
      remember(submittedAt);
      send(false);
    },
    true,
  );

  document.addEventListener(
    "input",
    (event) => {
      if (firstInputAt === null && primaryForm(event.target.form)) {
        firstInputAt = now();
        if (
          event.inputType === "insertReplacementText" ||
          event.inputType === "insertFromPaste"
        ) {
          autofill = true;
        }
      }
    },
    true,
  );

  document.addEventListener(
    "click",
    (event) => {
      var target = event.target;
      var element =
        target && target.closest ? target.closest("a,button") : null;
      if (!element) return;
      var href = element.getAttribute("href") || "";
      var connection = element.getAttribute("data-connection") || "";
      var external = false;
      try {
        external =
          href !== "" &&
          new URL(href, location.href).origin !== location.origin;
      } catch {
        external = false;
      }
      if (!external && connection === "") return;
      delegated = true;
      if (connection !== "") {
        methodVendorName = connection;
        method = /^(samlp|waad|adfs|okta|ping|azure)/i.test(connection)
          ? "enterprise_sso"
          : "social";
      }
    },
    true,
  );

  document.addEventListener("visibilitychange", () => {
    visibilityChanges += 1;
    if (document.visibilityState === "hidden") hiddenSince = now();
    else endHidden();
  });

  window.addEventListener("pagehide", (event) => {
    if (event.persisted) return;
    if (!submitted) remember(undefined);
    send(!submitted);
  });

  window.addEventListener(
    "error",
    (event) => {
      if (event.target && event.target !== window) return;
      exceptions += 1;
      if (!exceptionName && event.error?.name) {
        exceptionName = String(event.error.name).slice(0, 64);
      }
    },
    true,
  );

  window.addEventListener("unhandledrejection", (event) => {
    exceptions += 1;
    var reason = event.reason;
    if (!exceptionName && reason?.name) {
      exceptionName = String(reason.name).slice(0, 64);
    }
  });

  try {
    if (navigator.credentials) {
      ["get", "create"].forEach((name) => {
        var original = navigator.credentials[name];
        if (typeof original !== "function") return;
        navigator.credentials[name] = function (...args) {
          var start = now();
          passkeyAttempts += 1;
          var finish = (result) => {
            passkeyMs += Math.max(0, now() - start);
            passkeyResult = result;
          };
          var value;
          try {
            value = original.apply(this, args);
            if (value && typeof value.then === "function") {
              return value.then(
                (result) => {
                  finish("ok");
                  return result;
                },
                (error) => {
                  finish(error?.name ? String(error.name) : "UnknownError");
                  throw error;
                },
              );
            }
            finish("ok");
            return value;
          } catch (error) {
            finish(error?.name ? String(error.name) : "UnknownError");
            throw error;
          }
        };
      });
    }
  } catch {
    // Wrapping is best effort; never break passkeys.
  }
})();
