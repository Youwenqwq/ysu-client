"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import useSWR, { type KeyedMutator, type SWRConfiguration } from "swr";
import { useAuthStore } from "@/lib/stores/auth";
import { getSchoolConfigScope } from "@/lib/server-config";
import { cacheGetStale, cacheKey, cacheSet, DEFAULT_TTL_MS, LONG_TTL_MS } from "@/lib/storage/cache";
import { useRefreshStore } from "@/lib/stores/refresh";
import { hasCapability } from "../capabilities";
import { ProviderError, ProviderErrorCode } from "../errors";
import { useProvider, useProviderReady } from "../use-provider";
import type { AcademicCapabilities } from "../types";

export interface ProviderQueryResult<T> {
  data: T | undefined;
  isLoading: boolean;
  isValidating: boolean;
  isError: boolean;
  error: ProviderError | undefined;
  mutate: KeyedMutator<T>;
  isStale: boolean;
}

interface ProviderCachePolicy {
  ttl: number;
  persist: boolean;
}

const SHORT_TTL_MS = 1000 * 60 * 60 * 12;

const CACHE_POLICIES: Record<string, ProviderCachePolicy> = {
  "student-info": { ttl: LONG_TTL_MS, persist: true },
  schedule: { ttl: LONG_TTL_MS, persist: true },
  "class-periods": { ttl: LONG_TTL_MS, persist: true },
  "term-calendar": { ttl: LONG_TTL_MS, persist: true },
  "training-plan": { ttl: LONG_TTL_MS, persist: true },
  "current-week": { ttl: SHORT_TTL_MS, persist: true },
  grades: { ttl: DEFAULT_TTL_MS, persist: true },
  "gpa-stats": { ttl: DEFAULT_TTL_MS, persist: true },
  "grade-statistics": { ttl: DEFAULT_TTL_MS, persist: true },
  "grade-distribution": { ttl: DEFAULT_TTL_MS, persist: true },
  "grade-ranking": { ttl: DEFAULT_TTL_MS, persist: true },
  exams: { ttl: DEFAULT_TTL_MS, persist: true },
  "academic-completion": { ttl: DEFAULT_TTL_MS, persist: true },
  "academic-warnings": { ttl: DEFAULT_TTL_MS, persist: true },
};

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(obj[key])}`)
    .join(",")}}`;
}

function getCachePolicy(feature: string): ProviderCachePolicy {
  return CACHE_POLICIES[feature] ?? { ttl: DEFAULT_TTL_MS, persist: false };
}

export function providerQueryKey(
  providerId: string,
  schoolConfigScope: string,
  username: string | null,
  feature: string,
  params?: unknown,
): readonly unknown[] {
  return ["provider", providerId, schoolConfigScope, username ?? null, feature, params ?? null] as const;
}

export function providerCacheKey(
  providerId: string,
  schoolConfigScope: string,
  username: string,
  feature: string,
  params?: unknown,
): string {
  return cacheKey([
    "provider",
    providerId,
    schoolConfigScope,
    username,
    feature,
    stableStringify(params ?? null),
  ]);
}

export function useProviderQuery<T>(
  capability: keyof AcademicCapabilities,
  feature: string,
  fetcher: () => Promise<T>,
  params?: unknown,
  config?: SWRConfiguration<T, ProviderError>,
): ProviderQueryResult<T> {
  const provider = useProvider();
  const isReady = useProviderReady();
  const username = useAuthStore((state) => state.username);
  const schoolConfigScope = getSchoolConfigScope();
  const capabilityError = useMemo(
    () =>
      hasCapability(provider.capabilities, capability)
        ? undefined
        : new ProviderError(
            ProviderErrorCode.FEATURE_NOT_SUPPORTED,
            `Provider "${provider.id}" does not support ${capability}`,
            undefined,
            501,
          ),
    [provider.capabilities, provider.id, capability],
  );

  const policy = getCachePolicy(feature);
  const canPersist = !capabilityError && policy.persist && !!username;
  const persistentKey = useMemo(
    () =>
      username
        ? providerCacheKey(provider.id, schoolConfigScope, username, feature, params)
        : null,
    [provider.id, schoolConfigScope, username, feature, params],
  );
  const cached = useMemo(
    () => (canPersist && persistentKey ? cacheGetStale<T>(persistentKey, policy.ttl) : null),
    [canPersist, persistentKey, policy.ttl],
  );
  const [servedStale, setServedStale] = useState(() => cached?.stale ?? false);

  useEffect(() => {
    setServedStale(cached?.stale ?? false);
    // Only reset from the persistent cache when the query key changes. If a
    // revalidation fails and falls back to a still-valid cache entry, keep the
    // stale marker instead of immediately clearing it on the next render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [persistentKey]);

  const swr = useSWR<T, ProviderError>(
    isReady && !capabilityError
      ? providerQueryKey(provider.id, schoolConfigScope, username, feature, params)
      : null,
    async () => {
      try {
        const result = await fetcher();
        if (canPersist && persistentKey) {
          cacheSet(persistentKey, result);
        }
        setServedStale(false);
        return result;
      } catch (err) {
        if (canPersist && persistentKey) {
          const fallback = cacheGetStale<T>(persistentKey, policy.ttl);
          if (fallback) {
            setServedStale(true);
            return fallback.data;
          }
        }
        throw err;
      }
    },
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: true,
      dedupingInterval: 5000,
      fallbackData: cached?.data,
      ...config,
    },
  );

  const { data, error, isLoading, isValidating, mutate } = swr;
  const hasData = data !== undefined;
  const isInitialLoading = isLoading && !hasData;
  const isStale = hasData && servedStale;
  const contributedRefresh = useRef(false);
  const contributedStale = useRef(false);

  useEffect(() => {
    if (isValidating && data !== undefined) {
      if (!contributedRefresh.current) {
        contributedRefresh.current = true;
        useRefreshStore.getState().start();
      }
    } else if (contributedRefresh.current) {
      contributedRefresh.current = false;
      useRefreshStore.getState().end();
    }

    return () => {
      if (contributedRefresh.current) {
        contributedRefresh.current = false;
        useRefreshStore.getState().end();
      }
    };
  }, [isValidating, data]);

  useEffect(() => {
    if (isStale) {
      if (!contributedStale.current) {
        contributedStale.current = true;
        useRefreshStore.getState().markStale();
      }
    } else if (contributedStale.current) {
      contributedStale.current = false;
      useRefreshStore.getState().markFresh();
    }

    return () => {
      if (contributedStale.current) {
        contributedStale.current = false;
        useRefreshStore.getState().markFresh();
      }
    };
  }, [isStale]);

  return {
    data,
    isLoading: capabilityError ? false : isInitialLoading,
    isValidating,
    isError: !!capabilityError || !!error,
    error: capabilityError ?? error ?? undefined,
    mutate,
    isStale,
  };
}
