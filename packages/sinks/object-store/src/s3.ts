import { compareStrings, sha256Hex } from "@auththread/schema";
import type { ObjectStore } from "./store.ts";

export interface S3StoreOptions {
  /** For R2: https://<account>.r2.cloudflarestorage.com */
  readonly endpoint: string;
  /** For R2: "auto". For AWS: the bucket region. */
  readonly region: string;
  readonly bucket: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly sessionToken?: string;
  /** Path style works for R2, MinIO and most S3-compatible stores. */
  readonly forcePathStyle?: boolean;
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => Date;
}

export interface SignRequestInput {
  readonly method: string;
  readonly url: URL;
  readonly headers: Readonly<Record<string, string>>;
  readonly payloadHash: string;
  readonly region: string;
  readonly service?: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly sessionToken?: string;
  readonly now: Date;
}

const encoder = new TextEncoder();

const hex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

/** Copy into an ArrayBuffer-backed view so WebCrypto accepts it. */
const copy = (value: Uint8Array): Uint8Array<ArrayBuffer> => {
  const out = new Uint8Array(value.byteLength);
  out.set(value);
  return out;
};

const hmac = async (
  key: Uint8Array | string,
  data: string,
): Promise<Uint8Array> => {
  const raw = typeof key === "string" ? encoder.encode(key) : key;
  const imported = await crypto.subtle.importKey(
    "raw",
    copy(raw),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    imported,
    copy(encoder.encode(data)),
  );
  return new Uint8Array(signature);
};

const amzDate = (date: Date): string =>
  date.toISOString().replace(/[:-]|\.\d{3}/g, "");

const encodePath = (path: string): string =>
  path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");

/** AWS Signature Version 4 for S3-compatible stores. */
export async function signRequest(
  input: SignRequestInput,
): Promise<Record<string, string>> {
  const service = input.service ?? "s3";
  const date = amzDate(input.now);
  const dateStamp = date.slice(0, 8);

  const headers: Record<string, string> = {
    ...input.headers,
    host: input.url.host,
    "x-amz-content-sha256": input.payloadHash,
    "x-amz-date": date,
    ...(input.sessionToken === undefined
      ? {}
      : { "x-amz-security-token": input.sessionToken }),
  };

  const normalized: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    normalized[name.toLowerCase()] = value.trim().replace(/\s+/g, " ");
  }
  const names = Object.keys(normalized).sort(compareStrings);
  const canonicalHeaders = names
    .map((name) => `${name}:${normalized[name]}\n`)
    .join("");
  const signedHeaders = names.join(";");

  const query = [...input.url.searchParams.entries()]
    .sort(([a], [b]) => compareStrings(a, b))
    .map(
      ([name, value]) =>
        `${encodeURIComponent(name)}=${encodeURIComponent(value)}`,
    )
    .join("&");

  const canonicalRequest = [
    input.method,
    input.url.pathname,
    query,
    canonicalHeaders,
    signedHeaders,
    input.payloadHash,
  ].join("\n");

  const scope = `${dateStamp}/${input.region}/${service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    date,
    scope,
    sha256Hex(canonicalRequest),
  ].join("\n");

  const kDate = await hmac(`AWS4${input.secretAccessKey}`, dateStamp);
  const kRegion = await hmac(kDate, input.region);
  const kService = await hmac(kRegion, service);
  const kSigning = await hmac(kService, "aws4_request");
  const signature = hex(await hmac(kSigning, stringToSign));

  return {
    ...headers,
    authorization:
      `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}

/** An ObjectStore backed by any S3-compatible HTTP endpoint. */
export function createS3Store(options: S3StoreOptions): ObjectStore {
  const endpoint = new URL(options.endpoint);
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const now = options.now ?? (() => new Date());
  const forcePathStyle = options.forcePathStyle ?? true;

  return {
    async put(key, body, contentType) {
      const url = new URL(endpoint);
      const base = url.pathname.replace(/\/+$/, "");

      if (forcePathStyle) {
        url.pathname = `${base}/${encodePath(options.bucket)}/${encodePath(key)}`;
      } else {
        url.host = `${options.bucket}.${url.host}`;
        url.pathname = `${base}/${encodePath(key)}`;
      }

      const payloadHash = sha256Hex(body);
      const signed = await signRequest({
        method: "PUT",
        url,
        headers: {},
        payloadHash,
        region: options.region,
        accessKeyId: options.accessKeyId,
        secretAccessKey: options.secretAccessKey,
        ...(options.sessionToken === undefined
          ? {}
          : { sessionToken: options.sessionToken }),
        now: now(),
      });

      const { host: _host, ...headers } = signed;
      const response = await fetchImpl(url, {
        method: "PUT",
        headers: { ...headers, "content-type": contentType },
        body,
      });

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(
          `object store responded ${response.status}${
            text.length === 0 ? "" : `: ${text.slice(0, 200)}`
          }`,
        );
      }
    },
  };
}
