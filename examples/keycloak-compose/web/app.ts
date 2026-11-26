import { init } from "@auththread/browser";
import { oidcBrowser } from "@auththread/oidc/browser";

const KEYCLOAK =
  "http://localhost:8081/realms/auththread/protocol/openid-connect";
const CLIENT_ID = "auththread-demo";
const REDIRECT_URI = `${window.location.origin}/callback`;

const auth = init({
  endpoint: "http://localhost:8787",
  key: "at_demo",
  tenant: "keycloak",
  provider: oidcBrowser,
});

const base64url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

const random = (): Uint8Array => crypto.getRandomValues(new Uint8Array(32));

const verifier = (): string => base64url(random());

const challenge = async (value: string): Promise<string> =>
  base64url(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
  );

const output = (text: string): void => {
  const element = document.querySelector("#status");
  if (element !== null) element.textContent = text;
};

const login = async (): Promise<void> => {
  const state = verifier();
  const codeVerifier = verifier();
  sessionStorage.setItem(`pkce:${state}`, codeVerifier);

  const url = new URL(`${KEYCLOAK}/auth`);
  url.searchParams.set("client_id", CLIENT_ID);
  url.searchParams.set("redirect_uri", REDIRECT_URI);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid profile email");
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", await challenge(codeVerifier));
  url.searchParams.set("code_challenge_method", "S256");

  const params = auth.authorizeParams();
  for (const [key, value] of Object.entries(params))
    url.searchParams.set(key, value);

  window.location.assign(url.toString());
};

const complete = async (): Promise<void> => {
  const result = auth.callback(window.location.href);
  if (!result.ok) {
    output(`Login failed: ${result.error ?? "unknown"}`);
    return;
  }

  const url = new URL(window.location.href);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const codeVerifier =
    state === null ? null : sessionStorage.getItem(`pkce:${state}`);
  if (code === null || codeVerifier === null) {
    output("Login failed: missing code or verifier");
    return;
  }

  const started = performance.now();
  const response = await fetch(`${KEYCLOAK}/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      code,
      code_verifier: codeVerifier,
    }),
  });
  auth.tokenExchange(Math.round(performance.now() - started));

  if (!response.ok) {
    output(`Token exchange failed: ${response.status}`);
    return;
  }

  const tokens = (await response.json()) as { id_token?: string };
  output(
    tokens.id_token
      ? "Login succeeded. Journey sent."
      : "Login returned no id_token.",
  );
  sessionStorage.removeItem(`pkce:${state}`);
};

const button = document.querySelector("#login");
if (button !== null) button.addEventListener("click", () => void login());

if (window.location.pathname === "/callback") void complete();

output(`Ready. Trace ${auth.traceId().slice(0, 8)}.`);
