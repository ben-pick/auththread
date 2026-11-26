import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";

const PORT = Number(process.env.PORT ?? "8788");
const SECRET = process.env.PROBE_SECRET;

interface ActionProbe {
  readonly ext_trace_id?: string;
  readonly transaction_id?: string;
  readonly session_id?: string;
  readonly client_id?: string;
}

const actions: ActionProbe[] = [];
const MAX_ACTIONS = 50;

const readBody = async (request: IncomingMessage): Promise<string> => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
};

const respond = (
  response: ServerResponse,
  status: number,
  body: string,
): void => {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify({ ok: status < 400, body }));
};

const authorized = (request: IncomingMessage): boolean => {
  if (SECRET === undefined) return true;
  const custom = request.headers["x-probe-secret"];
  const authorization = request.headers.authorization;
  return (
    custom === SECRET ||
    authorization === SECRET ||
    authorization === `Bearer ${SECRET}`
  );
};

const parseEvents = (body: string): unknown[] => {
  try {
    const parsed = JSON.parse(body) as unknown;
    if (Array.isArray(parsed)) return parsed;
    return [parsed];
  } catch {
    return body
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .flatMap((line) => {
        try {
          return [JSON.parse(line) as unknown];
        } catch {
          return [];
        }
      });
  }
};

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};

const stringOf = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

const handleStream = (body: string): void => {
  for (const raw of parseEvents(body)) {
    const event = asRecord(raw);
    const details = asRecord(event.details);
    const references = asRecord(event.references);
    const executions = asRecord(details.actions).executions;
    const transactionId = stringOf(details.transaction_id);
    const sessionId = stringOf(details.session_id);
    const traceId = stringOf(references.trace_id);

    console.log(
      `STREAM type=${stringOf(event.type) ?? "?"} log=${stringOf(event.log_id) ?? "?"}` +
        ` transaction=${transactionId ?? "-"} session=${sessionId ?? "-"}` +
        ` refs_trace=${traceId ?? "-"} executions=${Array.isArray(executions) ? executions.length : "-"}`,
    );
    console.log(`STREAM_RAW ${JSON.stringify(event)}`);

    const action = actions.find(
      (candidate) =>
        (transactionId !== undefined &&
          candidate.transaction_id === transactionId) ||
        (sessionId !== undefined && candidate.session_id === sessionId),
    );
    if (action === undefined) {
      console.log(
        "MATCH none (no Action probe shares the transaction or session)",
      );
      continue;
    }

    const extTraceInStream =
      action.ext_trace_id !== undefined && body.includes(action.ext_trace_id);
    console.log(
      `MATCH transaction=${action.transaction_id === transactionId ? "yes" : "no"}` +
        ` session=${action.session_id === sessionId ? "yes" : "no"}` +
        ` ext_trace_in_stream=${extTraceInStream ? "yes" : "no"}` +
        ` refs_trace_equals_ext=${traceId !== undefined && traceId === action.ext_trace_id ? "yes" : "no"}`,
    );
  }
};

const handleAction = (body: string): void => {
  try {
    const payload = JSON.parse(body) as ActionProbe;
    if (actions.length >= MAX_ACTIONS) actions.shift();
    actions.push(payload);
    console.log(
      `ACTION transaction=${payload.transaction_id ?? "-"} session=${payload.session_id ?? "-"}` +
        ` ext_trace=${payload.ext_trace_id ?? "-"} client=${payload.client_id ?? "-"}`,
    );
  } catch {
    console.log(`ACTION_RAW ${body}`);
  }
};

const server = createServer((request, response) => {
  void (async () => {
    if (request.method === "GET" && request.url === "/healthz") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true }));
      return;
    }
    if (request.method !== "POST") {
      respond(response, 405, "POST only");
      return;
    }
    if (!authorized(request)) {
      respond(response, 401, "bad probe secret");
      return;
    }

    const body = await readBody(request);
    if (request.url === "/action") {
      handleAction(body);
      respond(response, 202, "action recorded");
      return;
    }
    handleStream(body);
    respond(response, 202, "stream recorded");
  })().catch((error) => {
    console.error("probe error", error);
    respond(response, 500, "probe error");
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Auth0 probe listening on :${PORT}`);
  console.log(`Log stream URL: http://localhost:${PORT}/log-stream`);
  console.log(`Action URL:     http://localhost:${PORT}/action`);
  if (SECRET !== undefined)
    console.log("Probe secret accepted in x-probe-secret or Authorization");
});
