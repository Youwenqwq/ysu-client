/**
 * Ldxt data fetcher wrapper for YSU Provider.
 *
 * Wraps protocol/ldxt.ts functions with error mapping to ProviderError.
 * ldxt 会话不持久化（SDK 同样如此），每次启动首次查询重新走 SSO 握手。
 */
import {
  LdxtError,
  LdxtNotLoggedInError,
  LdxtProtocolError,
} from "./protocol/ldxt"
import type { LdxtProtocol } from "./protocol/ldxt"
import type {
  EnrollableActivity as LdxtEnrollableActivity,
  LaborRecord as LdxtLaborRecord,
  LaborSummary as LdxtLaborSummary,
} from "./protocol/ldxt"
import { ProviderError, ProviderErrorCode, wrapError } from "@orahako/plugin-sdk/provider-errors"

export type LdxtFetcher = Pick<
  LdxtProtocol,
  "queryLaborRecords" | "queryLaborSummary" | "queryEnrollableActivities"
>

export function createLdxtFetcher(
  ldxt: LdxtProtocol,
  mapCASSessionError: (error: unknown) => ProviderError | undefined
): LdxtFetcher {
  const {
    queryLaborRecords: _queryLaborRecords,
    queryLaborSummary: _queryLaborSummary,
    queryEnrollableActivities: _queryEnrollableActivities,
  } = ldxt

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

async function queryLaborRecords(opts?: {
  termCode?: string
  batchId?: string
  pageSize?: number
}): Promise<LdxtLaborRecord[]> {
  return withLdxt(() => _queryLaborRecords(opts))
}

async function queryLaborSummary(): Promise<LdxtLaborSummary> {
  return withLdxt(() => _queryLaborSummary())
}

async function queryEnrollableActivities(): Promise<LdxtEnrollableActivity[]> {
  return withLdxt(() => _queryEnrollableActivities())
}

  return {
    queryLaborRecords,
    queryLaborSummary,
    queryEnrollableActivities,
  }
}
