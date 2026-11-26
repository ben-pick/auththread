import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type {
  ProviderAdapter,
  Sink,
  TenantSettings,
} from "@auththread/adapter-kit";
import { createMemoryBuffer } from "@auththread/adapter-kit";
import {
  type Clock,
  createStitcher,
  type Stitcher,
  type StitcherOptions,
} from "@auththread/stitcher";
import { createNodeScheduler, type NodeScheduler } from "./scheduler.ts";

export interface NodeServerOptions {
  readonly providers: readonly ProviderAdapter<unknown>[];
  readonly sinks: readonly Sink[];
  readonly settings: StitcherOptions["settings"];
  readonly quietMs?: number;
  readonly correlationWindowMs?: number;
  readonly ttlMs?: number;
  readonly scheduler?: NodeScheduler;
  readonly clock?: Clock;
  readonly onError?: (error: unknown) => void;
  readonly captureBatches?: boolean;
}

export interface NodeServer {
  readonly stitcher: Stitcher;
  readonly scheduler: NodeScheduler;
  listen(port: number, host?: string): Promise<{ port: number }>;
  close(): Promise<void>;
  readonly server: Server;
}

const MAX_BODY_BYTES = 256 * 1024;

class PayloadTooLarge extends Error {}

const bodyOf = async (
  request: IncomingMessage,
): Promise<string | undefined> => {
  if (request.method === "GET" || request.method === "HEAD") return undefined;
  const declared = Number(request.headers["content-length"] ?? "0");
  if (declared > MAX_BODY_BYTES) throw new PayloadTooLarge();

  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new PayloadTooLarge();
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
};

const toRequest = async (request: IncomingMessage): Promise<Request> => {
  const host = request.headers.host ?? "localhost";
  const url = `http://${host}${request.url ?? "/"}`;
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (value === undefined) continue;
    for (const entry of Array.isArray(value) ? value : [value])
      headers.append(name, entry);
  }
  const body = await bodyOf(request);
  return new Request(url, {
    method: request.method ?? "GET",
    headers,
    ...(body === undefined ? {} : { body }),
  });
};

const toNodeResponse = async (
  response: Response,
  target: ServerResponse,
): Promise<void> => {
  target.statusCode = response.status;
  response.headers.forEach((value, name) => {
    target.setHeader(name, value);
  });
  target.end(Buffer.from(await response.arrayBuffer()));
};

export function createNodeServer(options: NodeServerOptions): NodeServer {
  const scheduler = options.scheduler ?? createNodeScheduler();
  const stitcher = createStitcher({
    providers: options.providers,
    sinks: options.sinks,
    settings: options.settings,
    buffer: createMemoryBuffer(),
    scheduler,
    ...(options.quietMs === undefined ? {} : { quietMs: options.quietMs }),
    ...(options.correlationWindowMs === undefined
      ? {}
      : { correlationWindowMs: options.correlationWindowMs }),
    ...(options.ttlMs === undefined ? {} : { ttlMs: options.ttlMs }),
    ...(options.clock === undefined ? {} : { clock: options.clock }),
    ...(options.captureBatches === undefined
      ? {}
      : { captureBatches: options.captureBatches }),
    ...(options.onError === undefined ? {} : { onError: options.onError }),
  });

  const server = createServer((request, response) => {
    void (async () => {
      try {
        const fetchRequest = await toRequest(request);
        await toNodeResponse(await stitcher.fetch(fetchRequest), response);
      } catch (error) {
        if (error instanceof PayloadTooLarge) {
          response.statusCode = 413;
          response.end("payload too large");
          return;
        }
        options.onError?.(error);
        response.statusCode = 500;
        response.end("internal");
      }
    })();
  });

  return {
    stitcher,
    scheduler,
    server,
    listen(port, host = "0.0.0.0") {
      return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, () => {
          const address = server.address();
          resolve({
            port:
              typeof address === "object" && address !== null
                ? address.port
                : port,
          });
        });
      });
    },
    close() {
      scheduler.stop();
      return new Promise((resolve, reject) => {
        server.close((error) =>
          error === undefined ? resolve() : reject(error),
        );
      });
    },
  };
}

export type { TenantSettings };
