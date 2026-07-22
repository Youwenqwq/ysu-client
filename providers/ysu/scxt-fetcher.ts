/**
 * Scxt data fetcher wrapper for YSU Provider.
 *
 * Wraps protocol/scxt.ts functions with error mapping to ProviderError.
 * scxt 会话不持久化（SDK 同样如此），每次启动首次查询重新走平台桥握手。
 */
import {
  ScxtError,
  ScxtNotLoggedInError,
  ScxtProtocolError,
  queryAllCreditRecords as _queryAllCreditRecords,
  queryCompetitions as _queryCompetitions,
  queryCreditBatches as _queryCreditBatches,
  queryCreditDeclarations as _queryCreditDeclarations,
  queryCreditRecords as _queryCreditRecords,
  queryCreditSummary as _queryCreditSummary,
  queryLibraryActivities as _queryLibraryActivities,
} from "./protocol/scxt";
import type {
  CatalogPage as ScxtCatalogPage,
  Competition as ScxtCompetition,
  CreditBatch as ScxtCreditBatch,
  CreditDeclaration as ScxtCreditDeclaration,
  CreditRecord as ScxtCreditRecord,
  CreditSummary as ScxtCreditSummary,
  LibraryActivity as ScxtLibraryActivity,
} from "./protocol/scxt";
import { ProviderError, ProviderErrorCode, wrapError } from "../errors";

function mapScxtError(e: unknown): ProviderError {
  if (e instanceof ScxtNotLoggedInError) {
    return new ProviderError(ProviderErrorCode.AUTH_SESSION_EXPIRED, e.message, e, 401);
  }
  if (e instanceof ScxtProtocolError) {
    return new ProviderError(ProviderErrorCode.BACKEND_PROTOCOL_ERROR, e.message, e, 500);
  }
  if (e instanceof ScxtError) {
    return new ProviderError(ProviderErrorCode.BACKEND_PROTOCOL_ERROR, e.message, e, 500);
  }
  return wrapError(e);
}

async function withScxt<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    throw mapScxtError(e);
  }
}

export async function queryCreditBatches(): Promise<ScxtCreditBatch[]> {
  return withScxt(() => _queryCreditBatches());
}

export async function queryCreditDeclarations(opts?: {
  batchId?: string;
  itemName?: string;
}): Promise<ScxtCreditDeclaration[]> {
  return withScxt(() => _queryCreditDeclarations(opts));
}

export async function queryCreditRecords(opts?: {
  batchId?: string;
  itemName?: string;
  year?: string;
}): Promise<ScxtCreditRecord[]> {
  return withScxt(() => _queryCreditRecords(opts));
}

export async function queryAllCreditRecords(): Promise<ScxtCreditRecord[]> {
  return withScxt(() => _queryAllCreditRecords());
}

export async function queryCreditSummary(): Promise<ScxtCreditSummary> {
  return withScxt(() => _queryCreditSummary());
}

export async function queryCompetitions(opts?: {
  itemName?: string;
  pageIndex?: number;
}): Promise<ScxtCatalogPage<ScxtCompetition>> {
  return withScxt(() => _queryCompetitions(opts));
}

export async function queryLibraryActivities(opts?: {
  name?: string;
  pageIndex?: number;
}): Promise<ScxtCatalogPage<ScxtLibraryActivity>> {
  return withScxt(() => _queryLibraryActivities(opts));
}
