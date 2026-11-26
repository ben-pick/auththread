import { Effect } from "effect";
import * as HttpRouter from "effect/http/HttpRouter";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import { Stitcher } from "./stitcher.ts";

export { BadRequest, NotFound, Unauthorized } from "./errors.ts";
export type {
  StitcherOptions,
  StitcherService,
  StitcherStats,
} from "./stitcher.ts";
export { Stitcher, stitcherLayer } from "./stitcher.ts";
export {
  decodeCompactSpans,
  decodeJourneyItem,
  decodeOtlpSpans,
  decodeProviderEvent,
  decodeProviderEventBatch,
  decodeSpan,
} from "./wire.ts";

/** Adapter from an Effect HTTP request to the stitcher's web-request port. */
export const serveHttp = (
  request: HttpServerRequest.HttpServerRequest,
): Effect.Effect<HttpServerResponse.HttpServerResponse, never, Stitcher> =>
  Effect.gen(function* () {
    const stitcher = yield* Stitcher;
    const web = yield* HttpServerRequest.toWeb(request).pipe(
      Effect.orElseSucceed(() => new Request("http://localhost/")),
    );
    return HttpServerResponse.fromWeb(yield* stitcher.handle(web));
  });

/** Registers the stitcher as the catch-all route of an Effect HTTP router. */
export const httpRoutes = HttpRouter.use((router) =>
  router.add("*", "/*", (request) => serveHttp(request)),
);
