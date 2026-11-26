# Auth0 login test app

A minimal app that starts Auth0 Universal Login, carries an auththread trace
through `/authorize`, and records the callback. It uses the raw OAuth redirect
flow, so it has no Auth0 SDK dependency.

## Auth0 application settings

Create or reuse an Auth0 **Single Page Application** and add:

- Allowed Callback URLs: `http://localhost:5173/callback`
- Allowed Logout URLs: `http://localhost:5173`
- Allowed Web Origins: `http://localhost:5173`

## Configure

From the repository root:

```sh
set -a
. ~/.auththread/dogfood.env
set +a

cat > examples/auth0-login/.env.local <<ENV
VITE_AUTH0_DOMAIN=$AUTH0_DOMAIN
VITE_AUTH0_CLIENT_ID=PASTE_YOUR_SPA_CLIENT_ID
VITE_AUTHTHREAD_ENDPOINT=https://perhaps-pie-had-moved.trycloudflare.com
VITE_AUTHTHREAD_KEY=$AUTHTHREAD_KEY
VITE_AUTHTHREAD_TENANT=$AUTHTHREAD_TENANT
ENV
```

Replace `VITE_AUTH0_CLIENT_ID` with the SPA application's Client ID.

## Run

```sh
pnpm --filter @auththread/example-auth0-login dev
```

Open:

```text
http://localhost:5173
```

Click **Log in with Auth0**. The app redirects to Universal Login with an
`ext-trace_id` parameter and returns to `/callback`.

After the callback, the server should receive `auth.app.login_start` and
`auth.app.callback` spans for the same trace. The wide event appears after the
configured quiet period.

## What this app does not do

It does not exchange the authorization code for tokens. That is deliberate:
this is a tracing test app, not an Auth0 client implementation. It proves the
trace ID, redirect, callback and Log Stream path. Use your real Auth0 client for
production login.
