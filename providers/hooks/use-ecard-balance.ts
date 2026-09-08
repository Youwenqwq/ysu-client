"use client"

import { useCallback } from "react"
import useSWR from "swr"
import { getSchoolConfigScope } from "@/lib/server-config"
import { useAuthStore } from "@/lib/stores/auth"
import { ProviderError, ProviderErrorCode } from "../errors"
import { useProvider, useProviderReady } from "../use-provider"
import { fetchEcardBalance, type EcardSessionStatus } from "../ysu/ecard-access"
import { providerQueryKey } from "./use-provider-query"

interface EcardBalanceSnapshot {
  status: EcardSessionStatus
  updatedAt: number
}

export function useEcardBalance() {
  const provider = useProvider()
  const isReady = useProviderReady()
  const hasHydrated = useAuthStore((s) => s.hasHydrated)
  const username = useAuthStore((s) => s.username)
  const credential = useAuthStore((s) => s.credential)
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const schoolConfigScope = getSchoolConfigScope()
  const available = provider.id === "ysu"
  const enabled =
    available && isReady && hasHydrated && !!username && !!credential && isAuthenticated
  const {
    data: snapshot,
    error: queryError,
    isLoading,
    isValidating,
    mutate,
  } = useSWR<EcardBalanceSnapshot, ProviderError>(
    enabled
      ? providerQueryKey(provider.id, schoolConfigScope, username, "ecard", { credential })
      : null,
    async () => {
      const account = useAuthStore.getState()
      if (
        account.username !== username ||
        account.credential !== credential ||
        !account.isAuthenticated ||
        getSchoolConfigScope() !== schoolConfigScope
      ) {
        throw new ProviderError(ProviderErrorCode.AUTH_REQUIRED, "一卡通查询账户已切换")
      }
      const status = await fetchEcardBalance()
      const current = useAuthStore.getState()
      if (
        current.username !== username ||
        current.credential !== credential ||
        !current.isAuthenticated ||
        getSchoolConfigScope() !== schoolConfigScope
      ) {
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
