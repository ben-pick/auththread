export class BadRequest extends Error {
  override readonly name = "BadRequest";
}

export class Unauthorized extends Error {
  override readonly name = "Unauthorized";
}

export class NotFound extends Error {
  override readonly name = "NotFound";
}
