"use client"

import { useCallback } from "react"
import useSWR from "swr"
import type { EcardSessionStatus } from "@orahako/plugin-sdk/academic"
import { hasCapability } from "@orahako/plugin-sdk/provider-capabilities"
import { ProviderError, ProviderErrorCode } from "@orahako/plugin-sdk/provider-errors"
import { usePluginServices } from "@/components/plugin-context"
import type { AcademicPluginContext } from "@orahako/plugin-sdk"
import { useProvider, useProviderReady } from "./use-provider"
import { useProviderAccount } from "./use-provider-account"
import { providerQueryKey } from "./use-provider-query"

interface EcardBalanceSnapshot {
  status: EcardSessionStatus
  updatedAt: number
}

export function useEcardBalance() {
  const provider = useProvider()
  const isReady = useProviderReady()
  const { session: sessionService, provider: providerService } =
    usePluginServices<AcademicPluginContext>()
  const {
    session: { hasHydrated, username, credential, isAuthenticated },
    providerScope,
  } = useProviderAccount()
  const ecard = provider.ecard
  const available = hasCapability(provider.capabilities, "ecard") && ecard !== undefined
  const enabled =
    available && isReady && hasHydrated && !!username && !!credential && isAuthenticated
  const isCurrentAccount = useCallback(() => {
    const snapshot = sessionService.getSnapshot()
    if (
      snapshot.username !== username ||
      snapshot.credential !== credential ||
      !snapshot.isAuthenticated
    ) {
      return false
    }
    const providerSnapshot = providerService.getSnapshot()
    return `${providerSnapshot.schoolId ?? "none"}:${providerSnapshot.generation}` === providerScope
  }, [providerService, sessionService, username, credential, providerScope])
  const {
    data: snapshot,
    error: queryError,
    isLoading,
    isValidating,
    mutate,
  } = useSWR<EcardBalanceSnapshot, ProviderError>(
    enabled
      ? providerQueryKey(provider.id, providerScope, username, "ecard", { credential })
      : null,
    async () => {
      if (!ecard) {
        throw new ProviderError(ProviderErrorCode.FEATURE_NOT_SUPPORTED, "当前学校不支持一卡通查询")
      }
      if (!isCurrentAccount()) {
        throw new ProviderError(ProviderErrorCode.AUTH_REQUIRED, "一卡通查询账户已切换")
      }
      const status = await ecard.fetchBalance()
      if (!isCurrentAccount()) {
        throw new ProviderError(ProviderErrorCode.AUTH_REQUIRED, "一卡通查询账户已切换")
      }
      // Keep the successful timestamp with its data in SWR, including across mounts.
      return { status, updatedAt: Date.now() }
    },
    {
      refreshInterval: 0,
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      shouldRetryOnError: false,
      keepPreviousData: false,
    }
  )
  const data = enabled ? snapshot?.status : undefined
  const error = enabled ? queryError : undefined
  const noAuth =
    !isAuthenticated ||
    !credential ||
    error?.code === ProviderErrorCode.AUTH_REQUIRED ||
    error?.code === ProviderErrorCode.AUTH_SESSION_EXPIRED
  const refresh = useCallback(async () => {
    if (!enabled) return
    // SWR retains errors and the last successful snapshot for this account's key.
    await mutate().catch(() => undefined)
  }, [enabled, mutate])

  return {
    data,
    balance: data?.balance ?? null,
    updatedAt: enabled ? snapshot?.updatedAt : undefined,
    error,
    loading: enabled && (isLoading || isValidating),
    initializing: !hasHydrated || (available && !!username && !isReady),
    noAccount: hasHydrated && !username,
    noAuth,
    available,
    enabled,
    isStale: !!data && !!error,
    refresh,
  }
}
