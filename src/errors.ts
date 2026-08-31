export class AppError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly statusCode: number,
    readonly expose = true,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidMediaRequestError extends AppError {
  constructor(message = "Unsupported or malformed media request") {
    super(message, "INVALID_MEDIA_REQUEST", 400);
  }
}

export class MetadataUnavailableError extends AppError {
  constructor(message = "Metadata is unavailable for this title") {
    super(message, "METADATA_UNAVAILABLE", 404);
  }
}

export class AppConfigurationError extends AppError {
  constructor(message: string) {
    super(message, "CONFIGURATION_ERROR", 503);
  }
}

export class UpstreamHttpError extends AppError {
  constructor(
    readonly upstream: string,
    readonly upstreamStatus: number,
  ) {
    super(`${upstream} returned HTTP ${upstreamStatus}`, "UPSTREAM_HTTP_ERROR", 502);
  }
}

export class UpstreamTimeoutError extends AppError {
  constructor(readonly upstream: string) {
    super(`${upstream} request timed out`, "UPSTREAM_TIMEOUT", 504);
  }
}

export class UpstreamNetworkError extends AppError {
  constructor(readonly upstream: string) {
    super(`${upstream} could not be reached`, "UPSTREAM_NETWORK_ERROR", 502);
  }
}

export class UpstreamPayloadError extends AppError {
  constructor(readonly upstream: string, message = "Unexpected upstream response") {
    super(`${upstream}: ${message}`, "UPSTREAM_PAYLOAD_ERROR", 502);
  }
}
