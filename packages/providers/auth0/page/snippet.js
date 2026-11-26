(() => {
  var meta = document.querySelector('meta[name="auththread"]');
  if (!meta) return;

  var config = {};
  try {
    config = JSON.parse(meta.getAttribute("content") || "{}");
  } catch {
    return;
  }
  if (!config.endpoint) return;

  var traceId = new URLSearchParams(window.location.search).get("ext-trace_id");
  if (!traceId) return;

  var startedAt = Date.now();
  var ended = false;

  function spanId() {
    var bytes = new Uint8Array(8);
    crypto.getRandomValues(bytes);
    return Array.prototype.map
      .call(bytes, (byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  }

  function send(span) {
    var body = JSON.stringify({ spans: [span] });
    var headers = { "content-type": "application/json" };
    if (config.key) headers.authorization = `Bearer ${config.key}`;
    try {
      fetch(`${config.endpoint.replace(/\/$/, "")}/v1/compact-spans`, {
        method: "POST",
        headers: headers,
        body: body,
        keepalive: true,
      });
    } catch {
      // The login must continue even if telemetry cannot be sent.
    }
  }

  function screenSpan(status, extra) {
    var attributes = {
      "auth.provider": "auth0",
      "auth.ui.step": config.step || "identifier",
      "auth.ui.vendor_screen": config.screen || "unknown",
    };
    for (var key in extra) attributes[key] = extra[key];
    return {
      traceId: traceId,
      spanId: spanId(),
      name: "auth.ui.screen",
      startMs: startedAt,
      durationMs: Math.max(0, Date.now() - startedAt),
      attributes: attributes,
      status: status,
    };
  }

  function finish(status, extra) {
    if (ended) return;
    ended = true;
    send(screenSpan(status, extra));
  }

  window.addEventListener("submit", () => {
    finish({ code: "ok" }, {});
  });

  window.addEventListener("pagehide", () => {
    finish({ code: "unset" }, {});
  });

  window.addEventListener("error", () => {
    send(
      screenSpan(
        { code: "error", message: "page error" },
        { "auth.error.code": "ui_error", "auth.error.source": "ui" },
      ),
    );
  });
})();
