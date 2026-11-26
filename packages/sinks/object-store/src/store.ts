import type { SinkError } from "@auththread/adapter-kit";
import type { Effect } from "effect";

/** The storage port. S3, R2 and MinIO use the bundled adapter; others implement this. */
export interface ObjectStore {
  put(
    key: string,
    body: string,
    contentType: string,
  ): Effect.Effect<void, SinkError>;
}
