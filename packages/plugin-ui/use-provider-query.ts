"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import useSWR, { type KeyedMutator, type SWRConfiguration } from "swr"
import type { AcademicCapabilities } from "@orahako/plugin-sdk/academic"
import { hasCapability } from "@orahako/plugin-sdk/provider-capabilities"
import { ProviderError, ProviderErrorCode } from "@orahako/plugin-sdk/provider-errors"
import { useRefreshStore } from "@/plugins/official/runtime/query/refresh-store"
import { usePluginServices } from "@/components/plugin-context"
import type { AcademicPluginContext } from "@orahako/plugin-sdk"
import { useProviderAccount } from "./use-provider-account"
import { useProvider, useProviderReady } from "./use-provider"

export { providerCacheKey, providerQueryKey } from "@/plugins/official/runtime/query"

export interface ProviderQueryResult<T> {
  data: T | undefined
  isLoading: boolean
  isValidating: boolean
  isError: boolean
  error: ProviderError | undefined
  mutate: KeyedMutator<T>
  isStale: boolean
}

export function useProviderQuery<T>(
  capability: keyof AcademicCapabilities,
  feature: string,
  fetcher: () => Promise<T>,
  params?: unknown,
  config?: SWRConfiguration<T, ProviderError>,
  enabled = true
): ProviderQueryResult<T> {
  const provider = useProvider()
  const isReady = useProviderReady()
  const { query, session: sessionService } = usePluginServices<AcademicPluginContext>()
  const {
    session: { username },
    providerScope,
  } = useProviderAccount()
  const capabilityError = useMemo(
    () =>
      hasCapability(provider.capabilities, capability)
        ? undefined
        : new ProviderError(
            ProviderErrorCode.FEATURE_NOT_SUPPORTED,
            `Provider "${provider.id}" does not support ${capability}`,
            undefined,
            501
          ),
    [provider.capabilities, provider.id, capability]
  )

  const policy = query.policy(feature)
  const canPersist = enabled && !capabilityError && policy.persist && !!username
  const persistentKey = useMemo(
    () =>
      username
        ? query.cacheKey({
            providerId: provider.id,
            providerScope,
            username,
            feature,
            params,
          })
        : null,
    [query, provider.id, providerScope, username, feature, params]
  )
  const cached = useMemo(() => {
    if (!canPersist || !persistentKey) return null
    const value = query.readPersistent<T>(persistentKey)
    if (!value) return null
    return { data: value.data, updatedAt: value.updatedAt }
  }, [canPersist, persistentKey, query])
  const [servedStale, setServedStale] = useState(false)

  useEffect(() => {
    setServedStale(cached ? Date.now() - cached.updatedAt > policy.ttl : false)
    // Only reset from the persistent cache when the query key changes. If a
    // revalidation fails and falls back to a still-valid cache entry, keep the
    // stale marker instead of immediately clearing it on the next render.
  }, [cached, policy.ttl, persistentKey])

  const swr = useSWR<T, ProviderError>(
    isReady && enabled && !capabilityError
      ? query.key({
          providerId: provider.id,
          providerScope,
          username,
          feature,
          params,
        })
      : null,
    async () => {
      try {
        const result = await fetcher()
        if (canPersist && persistentKey) {
          query.writePersistent(persistentKey, { data: result, updatedAt: Date.now() })
        }
        setServedStale(false)
        return result
      } catch (err) {
        if (
          err instanceof ProviderError &&
          err.code === ProviderErrorCode.AUTH_SESSION_EXPIRED &&
          sessionService.getSnapshot().isAuthenticated
        ) {
          sessionService.setSessionExpired(true)
        }
        if (canPersist && persistentKey) {
          const fallback = query.readPersistent<T>(persistentKey)
          if (fallback) {
            setServedStale(true)
            return fallback.data
          }
        }
        throw err
      }
    },
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: true,
      dedupingInterval: 5000,
      fallbackData: cached?.data,
      ...config,
    }
  )

  const { data, error, isLoading, isValidating, mutate } = swr
  const hasData = data !== undefined
  const isInitialLoading = isLoading && !hasData
  const isStale = hasData && servedStale
  const contributedRefresh = useRef(false)
  const contributedStale = useRef(false)

  useEffect(() => {
    if (isValidating && data !== undefined) {
      if (!contributedRefresh.current) {
        contributedRefresh.current = true
        useRefreshStore.getState().start()
      }
    } else if (contributedRefresh.current) {
      contributedRefresh.current = false
      useRefreshStore.getState().end()
    }

    return () => {
      if (contributedRefresh.current) {
        contributedRefresh.current = false
        useRefreshStore.getState().end()
      }
    }
  }, [isValidating, data])

  useEffect(() => {
    if (isStale) {
      if (!contributedStale.current) {
        contributedStale.current = true
        useRefreshStore.getState().markStale()
      }
    } else if (contributedStale.current) {
      contributedStale.current = false
      useRefreshStore.getState().markFresh()
    }

    return () => {
      if (contributedStale.current) {
        contributedStale.current = false
        useRefreshStore.getState().markFresh()
      }
    }
  }, [isStale])

  return {
    data,
    isLoading: capabilityError ? false : isInitialLoading,
    isValidating,
    isError: !!capabilityError || !!error,
    error: capabilityError ?? error ?? undefined,
    mutate,
    isStale,
  }
}
