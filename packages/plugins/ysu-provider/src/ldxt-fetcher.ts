/**
 * Ldxt data fetcher wrapper for YSU Provider.
 */
import { ProviderError, ProviderErrorCode, wrapError } from "@orahako/academic-sdk"
import {
  LdxtError,
  LdxtNotLoggedInError,
  LdxtProtocolError,
  type EnrollableActivity as LdxtEnrollableActivity,
  type LaborRecord as LdxtLaborRecord,
  type LaborSummary as LdxtLaborSummary,
  type LdxtProtocol,
} from "./protocol/ldxt"

export type LdxtFetcher = Pick<
  LdxtProtocol,
  "queryLaborRecords" | "queryLaborSummary" | "queryEnrollableActivities"
>

export function createLdxtFetcher(
  ldxt: LdxtProtocol,
  mapCASSessionError: (error: unknown) => ProviderError | undefined
): LdxtFetcher {
  function mapLdxtError(e: unknown): ProviderError {
    const sessionError = mapCASSessionError(e)
    if (sessionError) return sessionError

    if (e instanceof LdxtNotLoggedInError) {
      return new ProviderError(ProviderErrorCode.AUTH_SESSION_EXPIRED, e.message, e, 401)
    }
    if (e instanceof LdxtProtocolError) {
      return new ProviderError(ProviderErrorCode.BACKEND_PROTOCOL_ERROR, e.message, e, 500)
    }
    if (e instanceof LdxtError) {
      return new ProviderError(ProviderErrorCode.BACKEND_PROTOCOL_ERROR, e.message, e, 500)
    }
    return wrapError(e)
  }

  async function withLdxt<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn()
    } catch (e) {
      throw mapLdxtError(e)
    }
  }

  return {
    queryLaborRecords: (opts): Promise<LdxtLaborRecord[]> =>
      withLdxt(() => ldxt.queryLaborRecords(opts)),
    queryLaborSummary: (): Promise<LdxtLaborSummary> => withLdxt(() => ldxt.queryLaborSummary()),
    queryEnrollableActivities: (): Promise<LdxtEnrollableActivity[]> =>
      withLdxt(() => ldxt.queryEnrollableActivities()),
  }
}
