"use client"

import type { ReactNode } from "react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useTranslation } from "@/lib/i18n/use-translation"
import { ProviderErrorCode } from "@/providers/errors"

interface OverviewQuery {
  data: unknown
  isLoading: boolean
  isValidating: boolean
  isStale: boolean
  error?: { code: string }
  mutate: () => Promise<unknown>
}

/** Keep failures local and never present a failed request as an empty result. */
export function QueryState({
  queries,
  children,
  compact = false,
}: {
  queries: OverviewQuery[]
  children: ReactNode
  compact?: boolean
}) {
  const { t } = useTranslation()
  const missing = queries.filter((query) => query.data == null)
  const errors = queries.filter((query) => query.error)
  const refreshing = queries.some((query) => query.isValidating)
  const stale = queries.some((query) => query.isStale)
  const authExpired = errors.some(
    (query) =>
      query.error?.code === ProviderErrorCode.AUTH_SESSION_EXPIRED ||
      query.error?.code === ProviderErrorCode.AUTH_REQUIRED
  )
  const unsupported = errors.some(
    (query) => query.error?.code === ProviderErrorCode.FEATURE_NOT_SUPPORTED
  )
  if (compact) {
    if (missing.some((query) => query.isLoading)) {
      return <Skeleton className="h-6 w-14" aria-label={t("overviewData.loading")} />
    }
    if (missing.length > 0) {
      const message = t(
        unsupported
          ? "overviewData.unsupported"
          : authExpired
            ? "app.sessionExpired"
            : errors.length
              ? "overviewData.failed"
              : "overviewData.loading"
      )
      return (
        <span
          role="status"
          title={message}
          aria-label={message}
          className="text-sm text-muted-foreground"
        >
          {t(errors.length ? "overviewData.unavailableShort" : "overviewData.loading")}
        </span>
      )
    }
    return (
      <span className="flex flex-col gap-0.5">
        {children}
        {(stale || errors.length > 0) && (
          <span
            role="status"
            title={t("overviewData.stale")}
            className="text-xs text-muted-foreground"
          >
            {t("overviewData.staleShort")}
          </span>
        )}
      </span>
    )
  }
  if (missing.some((query) => query.isLoading)) {
    return (
      <div className="flex flex-col gap-2" aria-label={t("overviewData.loading")}>
        <Skeleton className="h-6 w-2/3" />
        <Skeleton className="h-4 w-full" />
      </div>
    )
  }
  return (
    <div className="flex min-w-0 flex-col gap-3">
      {errors.length > 0 && (
        <Alert>
          <AlertDescription className="flex flex-wrap items-center gap-2">
            <span>
              {t(
                unsupported
                  ? "overviewData.unsupported"
                  : authExpired
                    ? "app.sessionExpired"
                    : stale || missing.length === 0
                      ? "overviewData.stale"
                      : "overviewData.failed"
              )}
            </span>
            {!unsupported && !authExpired && (
              <Button
                size="sm"
                variant="ghost"
                disabled={refreshing}
                onClick={() => void Promise.allSettled(queries.map((query) => query.mutate()))}
              >
                {t("overviewData.retry")}
              </Button>
            )}
          </AlertDescription>
        </Alert>
      )}
      {missing.length === 0
        ? children
        : errors.length === 0 && (
            <p className="text-sm text-muted-foreground">{t("overviewData.loading")}</p>
          )}
      {stale && errors.length === 0 && (
        <p role="status" className="text-xs text-muted-foreground">
          {t("overviewData.stale")}
        </p>
      )}
    </div>
  )
}
