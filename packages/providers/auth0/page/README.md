# Auth0 Universal Login page snippet

Adds one `auth.ui.screen` span per rendered Universal Login screen: how long the screen was
visible, whether the user submitted, retried or left, how long the tab was hidden, and the
passkey outcome. It sends the raw Auth0 screen name; the adapter maps it to a neutral stage
and method in the stitcher.

## Install

1. Build or copy `snippet.js` to a URL your login page can reach.
2. Add the meta tag and the script to the page template, inside `<head>`.

```html
<meta name="auththread"
      data-endpoint="https://auth.example.com"
      data-key="at_pub_..."
      data-trace-id="{{ transaction.params.ext-trace_id | escape }}"
      data-screen="{{ prompt.screen.name | escape }}"
      data-client-id="{{ application.id | escape }}"
      data-locale="{{ locale | escape }}">
<script src="https://cdn.example.com/auththread-page.js"
        integrity="sha384-..."
        crossorigin="anonymous"></script>
```

`ext-` values are attacker-controlled. HTML-escape every one of them, and never interpolate
them into a `<script>` block or an event handler. The snippet validates the trace ID as 32
lower-case hex before sending anything.

The screen name comes from `prompt.screen.name`; the browser path (`location.pathname`) is
sent as a fallback. `auth.ui.step` is still read from a `data-step` attribute for old
installs, but new installs should not set it.

## What it captures

- screen load (`load_ms`, `ttfb_ms`) and dwell time
- submit attempts, same-screen retries, and the submit-to-next-screen transition
- abandonment on `pagehide`, without treating a same-tab bfcache restore as an exit
- tab-hidden time and visibility changes, useful for SMS/push/email-code screens
- first input time and a coarse autofill hint; **no field values and no keystrokes**
- passkey result (`ok` or the `DOMException.name`) and duration
- UI exceptions by class name only, plus resource-error exclusion
- social/enterprise delegation via an external link or `data-connection`

It never sends field values, key presses, clipboard content, email, username or DOM text.

## Known gaps

- Standard Universal Login has no page-level event bus, so a wrong password is not visible to
  the snippet. The Log Stream is authoritative for `invalid_password`; the snippet's
  `auth.ui.repeat` is only a UI retry proxy.
- Reset-password pages do not accept `ext-` params, so those journeys carry no trace ID.
- Registration Actions do not receive `event.request.query`; the hidden-field fallback is
  still needed.
- ACUL without `use_page_template: true` has no Liquid context. Set `use_page_template` so the
  surrounding page template can render the meta tag, or wait for the explicit
  `window.auththread` handoff.
- `fetch(keepalive)` is used on `pagehide`. `navigator.sendBeacon` cannot carry the bearer
  key, so a beacon-friendly auth path is a server change.
- The passkey result needs a wrapper around `navigator.credentials`. It passes the call
  through untouched and is skipped if the API cannot be wrapped.
- Requires a custom domain on the Auth0 tenant. Without one, page templates cannot load the
  script.
- The `key` is a write-only tenant key. It is public by design, like any browser telemetry
  key. Rotate it if it is abused.
