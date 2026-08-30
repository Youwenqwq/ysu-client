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
  queryEnrollableActivities as _queryEnrollableActivities,
  queryLaborRecords as _queryLaborRecords,
  queryLaborSummary as _queryLaborSummary,
} from "./protocol/ldxt"
import type {
  EnrollableActivity as LdxtEnrollableActivity,
  LaborRecord as LdxtLaborRecord,
  LaborSummary as LdxtLaborSummary,
} from "./protocol/ldxt"
import { ProviderError, ProviderErrorCode, wrapError } from "../errors"

function mapLdxtError(e: unknown): ProviderError {
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

export async function queryLaborRecords(opts?: {
  termCode?: string
  batchId?: string
  pageSize?: number
}): Promise<LdxtLaborRecord[]> {
  return withLdxt(() => _queryLaborRecords(opts))
}

export async function queryLaborSummary(): Promise<LdxtLaborSummary> {
  return withLdxt(() => _queryLaborSummary())
}

export async function queryEnrollableActivities(): Promise<LdxtEnrollableActivity[]> {
  return withLdxt(() => _queryEnrollableActivities())
}
