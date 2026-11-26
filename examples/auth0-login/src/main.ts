import { auth0Browser } from "@auththread/auth0/browser";
import { init } from "@auththread/browser";

const status = document.querySelector<HTMLSpanElement>("#status");
const trace = document.querySelector<HTMLElement>("#trace");
const identity = document.querySelector<HTMLElement>("#identity");
const button = document.querySelector<HTMLButtonElement>("#login");

if (status === null || trace === null || identity === null || button === null) {
  throw new Error("missing page elements");
}

const required = (name: string): string => {
  const value = import.meta.env[name] as string | undefined;
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`${name} is missing; copy .env.example to .env.local`);
  }
  return value.trim();
};

const domain = required("VITE_AUTH0_DOMAIN")
  .replace(/^https?:\/\//, "")
  .replace(/\/$/, "");
const clientId = required("VITE_AUTH0_CLIENT_ID");
const endpoint = required("VITE_AUTHTHREAD_ENDPOINT");
const key = required("VITE_AUTHTHREAD_KEY");
const tenant = required("VITE_AUTHTHREAD_TENANT");
const redirectUri = `${window.location.origin}/callback`;

const thread = init({
  endpoint,
  key,
  tenant,
  provider: auth0Browser,
});

trace.textContent = thread.traceId();

const setStatus = (value: string): void => {
  status.textContent = value;
};

const main = (): void => {
  if (window.location.pathname === "/callback") {
    const result = thread.callback(window.location.href);
    window.history.replaceState({}, "", "/");
    setStatus(result.ok ? "logged in" : `callback error: ${result.error}`);
    identity.textContent = result.ok
      ? "Callback recorded. The trace is complete on the browser side."
      : "The callback was recorded as an error.";
  } else {
    setStatus("not logged in");
  }

  button.disabled = false;
  button.addEventListener("click", () => {
    button.disabled = true;
    setStatus("redirecting to Universal Login…");

    const params = new URLSearchParams({
      client_id: clientId,
      response_type: "code",
      scope: "openid profile email",
      redirect_uri: redirectUri,
      state: crypto.randomUUID(),
      ...thread.authorizeParams(),
    });

    window.location.assign(`https://${domain}/authorize?${params.toString()}`);
  });
};

main();
