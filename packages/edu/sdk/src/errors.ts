export enum ProviderErrorCode {
  AUTH_REQUIRED = "AUTH_REQUIRED",
  AUTH_INVALID_CREDENTIAL = "AUTH_INVALID_CREDENTIAL",
  AUTH_CAPTCHA_REQUIRED = "AUTH_CAPTCHA_REQUIRED",
  AUTH_MFA_REQUIRED = "AUTH_MFA_REQUIRED",
  AUTH_SESSION_EXPIRED = "AUTH_SESSION_EXPIRED",
  NETWORK_ERROR = "NETWORK_ERROR",
  TIMEOUT = "TIMEOUT",
  FEATURE_NOT_SUPPORTED = "FEATURE_NOT_SUPPORTED",
  DATA_NOT_FOUND = "DATA_NOT_FOUND",
  BACKEND_BUSINESS_ERROR = "BACKEND_BUSINESS_ERROR",
  BACKEND_PROTOCOL_ERROR = "BACKEND_PROTOCOL_ERROR",
  RATE_LIMITED = "RATE_LIMITED",
  UNKNOWN = "UNKNOWN",
}

export class ProviderError extends Error {
  readonly code: ProviderErrorCode
  readonly cause?: unknown
  readonly status?: number
  readonly details?: unknown

  constructor(
    code: ProviderErrorCode,
    message: string,
    cause?: unknown,
    status?: number,
    details?: unknown
  ) {
    super(message, { cause })
    this.name = "ProviderError"
    this.code = code
    this.cause = cause
    this.status = status
    this.details = details
  }
}

const PROVIDER_ERROR_CODES: ReadonlySet<string> = new Set(Object.values(ProviderErrorCode))

function isProviderErrorCode(value: unknown): value is ProviderErrorCode {
  return typeof value === "string" && PROVIDER_ERROR_CODES.has(value)
}

/**
 * Recognizes `ProviderError` values regardless of which copy of this package
 * produced them. ZIP-bundled providers ship their own SDK copy, so an
 * `instanceof` check alone would drop a real `AUTH_SESSION_EXPIRED` (or any
 * other code) at the host boundary. Non-`ProviderError` instances are rejected
 * structurally by `name`, `message`, and `code`.
 */
export function isProviderError(error: unknown): error is ProviderError {
  if (error instanceof ProviderError) return true
  if (!(error instanceof Error)) return false
  const candidate = error as Error & { readonly code?: unknown }
  return (
    candidate.name === "ProviderError" &&
    typeof candidate.message === "string" &&
    isProviderErrorCode(candidate.code)
  )
}

export function wrapError(error: unknown): ProviderError {
  if (isProviderError(error)) {
    return error
  }

  if (error instanceof Error) {
    return new ProviderError(ProviderErrorCode.UNKNOWN, error.message, error)
  }

  return new ProviderError(
    ProviderErrorCode.UNKNOWN,
    typeof error === "string" ? error : "An unknown error occurred",
    error
  )
}
