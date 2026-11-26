# Universal Login page snippet

Adds a screen span with how long the user spent on the page, plus UI error events.

## Install

1. Build or copy `snippet.js` to a URL your login page can reach.
2. Add the meta tag and the script to the page template, inside `<head>`:

```html
<meta name="auththread" content='{"endpoint":"https://auth.example.com","key":"at_pub_...","step":"identifier","screen":"login"}'>
<script src="https://cdn.example.com/auththread-page.js" integrity="sha384-..." crossorigin="anonymous"></script>
```

The content is read from the page, so set `step` and `screen` per template. Use the
neutral step names from the schema: `identifier`, `password`, `mfa_challenge`,
`consent`, `signup`, `reset`.

## Requirements and known gaps

- Requires a custom domain on the Auth0 tenant. Without one, page templates cannot
  load the script.
- Registration Actions do not receive `event.request.query`, so the hidden field
  fallback is needed there.
- Reset-password pages do not accept `ext-` params, so those journeys carry no
  trace ID and are not stitched.
- The passkey result is not captured yet. Recording it needs a hook around the
  page's own WebAuthn call, not a probe from this script.
- The `key` is a write-only tenant key. It is public by design, like any browser
  telemetry key. Rotate it if it is abused.
