import { describe, expect, it } from "vitest"
import { ProviderErrorCode } from "../errors"
import { mapCASSessionError } from "./cas-auth"
import { NotAuthenticatedError } from "./protocol/cas"

describe("CAS session error mapping", () => {
  it("converts a CAS login bounce into a user-facing session error", () => {
    const error = mapCASSessionError(
      new NotAuthenticatedError("CAS bounced back to login page; TGC missing or expired")
    )

    expect(error?.code).toBe(ProviderErrorCode.AUTH_SESSION_EXPIRED)
    expect(error?.status).toBe(401)
    expect(error?.message).not.toContain("CAS bounced back")
  })

  it("leaves unrelated errors for their owning mapper", () => {
    expect(mapCASSessionError(new Error("network failure"))).toBeUndefined()
  })
})
