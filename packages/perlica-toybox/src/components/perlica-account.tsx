"use client"

import type { ReactNode } from "react"
import { Bell, CreditCard, RefreshCw, UserRound } from "lucide-react"
import { Badge } from "@ysu/plugin-ui/components"
import { Button } from "@ysu/plugin-ui/components"
import { Skeleton } from "@ysu/plugin-ui/components"
import type { PerlicaRaw, PerlicaRideCard, PerlicaUserInfo } from "../extras/types"
import { usePluginTranslation } from "@ysu/plugin-ui/plugin"
import { PERLICA_PLUGIN_ID } from "../constants"
import { cn } from "@ysu/plugin-ui/components"

export interface PerlicaAccountProps {
  user: PerlicaUserInfo | null
  cards: PerlicaRideCard[]
  unreadCount: number | null
  loading: boolean
  onRefresh: () => void
}

const REAL_NAME_FIELDS = [
  "realName",
  "realNameStatus",
  "isRealName",
  "realNameAuth",
  "isRealNameAuth",
  "realNameAuthentication",
  "realNameVerify",
  "realNameVerifyStatus",
  "authentication",
  "authenticationStatus",
  "authStatus",
  "certificationStatus",
]

const STUDENT_CERTIFICATION_FIELDS = [
  "studentCertification",
  "studentCertificationStatus",
  "studentCert",
  "studentCertStatus",
  "studentAuthentication",
  "studentAuth",
  "studentAuthStatus",
  "studentVerification",
  "studentVerifyStatus",
  "studentStatus",
  "isStudentCertified",
  "isStudentVerified",
  "isStudent",
  "schoolCertification",
  "schoolCertificationStatus",
  "campusCertification",
  "campusCertificationStatus",
]

const ARREARS_FIELDS = [
  "arrears",
  "arrear",
  "arrearage",
  "arrearsAmount",
  "arrearAmount",
  "arrearageAmount",
  "arrearsMoney",
  "arrearsFee",
  "arrearsBalance",
  "arrearsTotal",
  "totalArrears",
]

const DEBT_FIELDS = [
  "debt",
  "debtAmount",
  "debtMoney",
  "debtFee",
  "debtBalance",
  "totalDebt",
  "outstandingAmount",
  "owingAmount",
  "owedAmount",
  "oweAmount",
  "owedMoney",
  "oweMoney",
  "unpaidAmount",
  "amountDue",
  "dueAmount",
]

const SENSITIVE_KEY = /token|authorization|cookie|credential|secret|password|session|url/i
const SENSITIVE_TEXT = /(?:\b(?:https?|wss?):\/\/|\bTOKEN:)/i
const MISSING = "—"

function readRawField(raw: PerlicaRaw, candidates: string[]) {
  const normalizedCandidates = new Set(
    candidates.map((key) => key.toLowerCase().replace(/[^a-z0-9]/g, ""))
  )
  for (const [key, value] of Object.entries(raw)) {
    const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, "")
    const present =
      value !== null && value !== undefined && !(typeof value === "string" && !value.trim())
    if (normalizedCandidates.has(normalizedKey) && present) return value
  }
  return undefined
}

function sanitizeRawValue(value: unknown, redacted: string, seen: WeakSet<object>): unknown {
  if (typeof value === "string") return SENSITIVE_TEXT.test(value) ? redacted : value
  if (value === null || typeof value === "boolean") return value
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value)
  if (typeof value === "bigint") return String(value)
  if (value === undefined) return null
  if (typeof value !== "object" || value instanceof Error) return redacted
  if (seen.has(value)) return redacted

  seen.add(value)
  let sanitized: unknown
  if (Array.isArray(value)) {
    sanitized = value.map((item) => sanitizeRawValue(item, redacted, seen))
  } else {
    sanitized = Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        SENSITIVE_KEY.test(key) ? redacted : sanitizeRawValue(item, redacted, seen),
      ])
    )
  }
  seen.delete(value)
  return sanitized
}

function rawText(value: unknown, redacted: string) {
  if (value === null || value === undefined || (typeof value === "string" && !value.trim())) {
    return MISSING
  }
  const sanitized = sanitizeRawValue(value, redacted, new WeakSet())
  if (typeof sanitized === "string") return sanitized
  if (typeof sanitized === "number" || typeof sanitized === "boolean") return String(sanitized)
  if (sanitized === null) return "null"
  return JSON.stringify(sanitized) ?? MISSING
}

function text(value: string | null | undefined) {
  return typeof value === "string" && value.trim() ? value : MISSING
}

function count(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : MISSING
}

function Detail({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0 border-b py-4">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1.5 text-sm font-medium break-words">{value}</dd>
    </div>
  )
}

function AccountSkeleton() {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-hidden="true">
      {Array.from({ length: 9 }, (_, index) => (
        <Skeleton key={index} className="h-16" />
      ))}
    </div>
  )
}

function RideCardDetails({ card, index }: { card: PerlicaRideCard; index: number }) {
  const { t } = usePluginTranslation(PERLICA_PLUGIN_ID)
  const title = card.name || card.feeName || t("perlica.cardNumber", { number: index + 1 })
  const description = card.name && card.feeName ? card.feeName : null

  return (
    <div className="py-6 first:pt-0 last:pb-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="text-sm font-semibold break-words">{title}</h4>
          {description ? (
            <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
          ) : null}
        </div>
        <Badge variant="secondary">{t("perlica.validCard")}</Badge>
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-x-6 sm:grid-cols-3">
        <Detail label={t("perlica.cardName")} value={text(card.name)} />
        <Detail label={t("perlica.feeName")} value={text(card.feeName)} />
        <Detail label={t("perlica.cardStartDate")} value={text(card.startDate)} />
        <Detail label={t("perlica.cardDueTime")} value={text(card.dueTime)} />
        <Detail label={t("perlica.remainingCount")} value={count(card.remainingCount)} />
        <Detail label={t("perlica.maxRide")} value={count(card.maxRide)} />
        <Detail label={t("perlica.useCount")} value={count(card.useCount)} />
        <Detail label={t("perlica.timeCount")} value={count(card.timeCount)} />
        <Detail label={t("perlica.currentNum")} value={count(card.currentNum)} />
        <Detail
          label={t("perlica.isValid")}
          value={card.isValid ? t("perlica.yes") : t("perlica.no")}
        />
      </dl>
    </div>
  )
}
export function PerlicaAccount({
  user,
  cards,
  unreadCount,
  loading,
  onRefresh,
}: PerlicaAccountProps) {
  const { t } = usePluginTranslation(PERLICA_PLUGIN_ID)
  const validCards = cards.filter((card) => card.isValid)
  const redacted = t("perlica.redacted")
  const unread =
    unreadCount !== null && Number.isFinite(unreadCount) ? String(unreadCount) : MISSING

  return (
    <section className="flex flex-col gap-8" aria-label={t("perlica.tabAccount")}>
      <header className="flex items-start justify-between gap-4 border-b pb-6">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">{t("perlica.tabAccount")}</h2>
          <div className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
            <Bell className="size-4" aria-hidden="true" />
            <span>{t("perlica.unreadCount")}</span>
            <Badge variant="secondary">{unread}</Badge>
          </div>
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={onRefresh} disabled={loading}>
          <RefreshCw data-icon="inline-start" className={cn(loading && "animate-spin")} />
          {loading ? t("perlica.userLoading") : t("perlica.refresh")}
        </Button>
      </header>

      <section aria-label={t("perlica.userSection")}>
        <div className="flex items-center gap-2">
          <UserRound className="size-4 text-muted-foreground" aria-hidden="true" />
          <h3 className="text-sm font-semibold">{t("perlica.userSection")}</h3>
        </div>
        <div className="mt-3">
          {user ? (
            <dl className="grid gap-x-6 sm:grid-cols-2 xl:grid-cols-3">
              <Detail label={t("perlica.nickname")} value={text(user.nickname)} />
              <Detail label={t("perlica.phone")} value={text(user.phone)} />
              <Detail label={t("perlica.userId")} value={text(user.userId)} />
              <Detail
                label={t("perlica.balance")}
                value={Number.isFinite(user.balance) ? `¥${user.balance.toFixed(2)}` : MISSING}
              />
              <Detail
                label={t("perlica.deposit")}
                value={Number.isFinite(user.deposit) ? `¥${user.deposit.toFixed(2)}` : MISSING}
              />
              <Detail label={t("perlica.monthlyCardExpiry")} value={text(user.rideCardDate)} />
              <Detail
                label={t("perlica.realName")}
                value={rawText(readRawField(user.raw, REAL_NAME_FIELDS), redacted)}
              />
              <Detail
                label={t("perlica.studentCertification")}
                value={rawText(readRawField(user.raw, STUDENT_CERTIFICATION_FIELDS), redacted)}
              />
              <Detail
                label={t("perlica.arrears")}
                value={rawText(readRawField(user.raw, ARREARS_FIELDS), redacted)}
              />
              <Detail
                label={t("perlica.debt")}
                value={rawText(readRawField(user.raw, DEBT_FIELDS), redacted)}
              />
            </dl>
          ) : loading ? (
            <AccountSkeleton />
          ) : (
            <p className="border-y py-6 text-sm text-muted-foreground">{t("perlica.notLoaded")}</p>
          )}
        </div>
      </section>

      <section aria-label={t("perlica.rideCards")}>
        <div className="flex items-center justify-between gap-3 border-b pb-3">
          <div className="flex items-center gap-2">
            <CreditCard className="size-4 text-muted-foreground" aria-hidden="true" />
            <h3 className="text-sm font-semibold">{t("perlica.rideCards")}</h3>
          </div>
          {validCards.length > 0 ? (
            <Badge variant="outline">{t("perlica.cardCount", { count: validCards.length })}</Badge>
          ) : null}
        </div>

        {validCards.length > 0 ? (
          <div className="divide-y border-b">
            {validCards.map((card, index) => (
              <RideCardDetails
                key={`${card.name}-${card.feeName}-${card.startDate}-${card.dueTime}-${index}`}
                card={card}
                index={index}
              />
            ))}
          </div>
        ) : (
          <div className="border-b py-6 text-sm text-muted-foreground">
            {loading ? t("perlica.userLoading") : t("perlica.noRideCard")}
          </div>
        )}
      </section>
    </section>
  )
}
