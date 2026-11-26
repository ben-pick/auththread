import { Schema } from "effect";

/** A buffer, scheduler or settings backend failed. The login path ignores it. */
export class StorageError extends Schema.TaggedError<StorageError>()(
  "StorageError",
  {
    operation: Schema.String,
    cause: Schema.Defect(),
  },
) {}

/** A sink could not render or deliver a journey. */
export class SinkError extends Schema.TaggedError<SinkError>()("SinkError", {
  sink: Schema.String,
  message: Schema.String,
  cause: Schema.optionalKey(Schema.Defect()),
}) {}

/** A provider feed rejected its payload or settings. */
export class FeedError extends Schema.TaggedError<FeedError>()("FeedError", {
  message: Schema.String,
  cause: Schema.optionalKey(Schema.Defect()),
}) {}

/** A provider's management API call failed. */
export class ProviderError extends Schema.TaggedError<ProviderError>()(
  "ProviderError",
  {
    provider: Schema.String,
    message: Schema.String,
    cause: Schema.optionalKey(Schema.Defect()),
  },
) {}

/** Tenant settings could not be read or decoded. */
export class SettingsError extends Schema.TaggedError<SettingsError>()(
  "SettingsError",
  {
    message: Schema.String,
    cause: Schema.optionalKey(Schema.Defect()),
  },
) {}
