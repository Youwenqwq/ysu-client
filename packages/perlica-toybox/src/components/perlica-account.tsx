"use client"

import type { ReactNode } from "react"
import { Bell, CalendarDays, ChevronDown, UserRound } from "lucide-react"
import { Avatar, AvatarFallback, AvatarImage, Badge, Skeleton } from "@orahako/plugin-ui/components"
import type { PerlicaRaw, PerlicaRideCard, PerlicaUserInfo } from "../extras/types"
import { usePluginTranslation } from "@orahako/plugin-ui/plugin"
import { PERLICA_PLUGIN_ID } from "../constants"

export interface PerlicaAccountProps {
  user: PerlicaUserInfo | null
  cards: PerlicaRideCard[]
  unreadCount: number | null
  loading: boolean
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
    <div className="min-w-0 py-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-sm font-medium break-words">{value}</dd>
    </div>
  )
}

function AccountSkeleton() {
  return (
    <div className="space-y-4" aria-hidden="true">
      <Skeleton className="h-44 rounded-2xl" />
      <Skeleton className="h-32 rounded-2xl" />
      <Skeleton className="h-20 rounded-2xl" />
    </div>
  )
}

function RideCardDetails({ card, index }: { card: PerlicaRideCard; index: number }) {
  const { t } = usePluginTranslation(PERLICA_PLUGIN_ID)
  const title = card.name || card.feeName || t("perlica.cardNumber", { number: index + 1 })
  const description = card.name && card.feeName ? card.feeName : null

  return (
    <article className="rounded-2xl bg-card p-4 ring-1 ring-foreground/10">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold break-words">{title}</h3>
          {description ? (
            <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
          ) : null}
        </div>
        <Badge variant="secondary">{t("perlica.validCard")}</Badge>
      </div>
      <p className="mt-4 flex items-center gap-2 text-sm">
        <CalendarDays className="size-4 text-muted-foreground" />
        <span className="text-muted-foreground">{t("perlica.cardDueTime")}</span>
        <span className="ml-auto font-medium">{text(card.dueTime)}</span>
      </p>
      <dl className="mt-4 grid grid-cols-3 gap-2 rounded-xl bg-muted/50 p-3 text-center">
        <Detail label={t("perlica.remainingCount")} value={count(card.remainingCount)} />
        <Detail label={t("perlica.useCount")} value={count(card.useCount)} />
        <Detail label={t("perlica.maxRide")} value={count(card.maxRide)} />
      </dl>
      <details className="group mt-3">
        <summary className="flex cursor-pointer list-none items-center justify-center gap-1 text-xs text-muted-foreground">
          {t("perlica.cardMoreDetails")}
          <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" />
        </summary>
        <dl className="mt-2 grid grid-cols-2 gap-x-4 border-t pt-2">
          <Detail label={t("perlica.cardStartDate")} value={text(card.startDate)} />
          <Detail
            label={t("perlica.timeCount")}
            value={
              Number.isFinite(card.timeCount)
                ? t("perlica.cardFreeDurationMinutes", { value: card.timeCount })
                : MISSING
            }
          />
        </dl>
      </details>
    </article>
  )
}
export function PerlicaAccountVerification({ user }: { user: PerlicaUserInfo }) {
  const { t } = usePluginTranslation(PERLICA_PLUGIN_ID)
  const redacted = t("perlica.redacted")

  return (
    <details className="group">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-medium">
        {t("perlica.accountInformation")}
        <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>
      <dl className="mt-2 grid grid-cols-2 gap-x-4 border-t pt-2">
        <Detail label={t("perlica.userId")} value={text(user.userId)} />
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
    </details>
  )
}

export function PerlicaAccount({ user, cards, unreadCount, loading }: PerlicaAccountProps) {
  const { t } = usePluginTranslation(PERLICA_PLUGIN_ID)
  const validCards = cards.filter((card) => card.isValid)
  const unread =
    unreadCount !== null && Number.isFinite(unreadCount) ? String(unreadCount) : MISSING

  if (!user && loading) return <AccountSkeleton />

  return (
    <div className="flex flex-col gap-5" aria-label={t("perlica.tabAccount")}>
      {user ? (
        <section className="rounded-2xl bg-muted/55 p-5">
          <div className="flex items-center gap-3">
            <Avatar className="size-14" aria-label={text(user.nickname)}>
              {user.avatarUrl ? <AvatarImage src={user.avatarUrl} alt="" /> : null}
              <AvatarFallback>
                <UserRound className="size-6" />
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-lg font-semibold">{text(user.nickname)}</h2>
              <p className="mt-0.5 text-sm text-muted-foreground">{text(user.phone)}</p>
            </div>
            <Badge variant="outline" className="shrink-0 bg-background/60">
              <Bell className="size-3.5" />
              <span className="sr-only">{t("perlica.unreadCount")}</span>
              {unread}
            </Badge>
          </div>
          <dl className="mt-5 grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-background/65 p-3">
              <dt className="text-xs text-muted-foreground">{t("perlica.balance")}</dt>
              <dd className="mt-1 text-xl font-semibold tabular-nums">
                {Number.isFinite(user.balance) ? `¥${user.balance.toFixed(2)}` : MISSING}
              </dd>
            </div>
            <div className="rounded-xl bg-background/65 p-3">
              <dt className="text-xs text-muted-foreground">{t("perlica.deposit")}</dt>
              <dd className="mt-1 text-xl font-semibold tabular-nums">
                {Number.isFinite(user.deposit) ? `¥${user.deposit.toFixed(2)}` : MISSING}
              </dd>
            </div>
          </dl>
        </section>
      ) : (
        <p className="rounded-2xl bg-muted/50 p-6 text-center text-sm text-muted-foreground">
          {t("perlica.notLoaded")}
        </p>
      )}

      <section className="space-y-3" aria-label={t("perlica.rideCards")}>
        <div className="flex items-center justify-between gap-3 px-1">
          <h2 className="text-base font-semibold">{t("perlica.rideCards")}</h2>
          {validCards.length > 0 ? (
            <Badge variant="outline">{t("perlica.cardCount", { count: validCards.length })}</Badge>
          ) : null}
        </div>
        {validCards.length > 0 ? (
          <div className="space-y-3">
            {validCards.map((card, index) => (
              <RideCardDetails
                key={`${card.name}-${card.feeName}-${card.startDate}-${card.dueTime}-${index}`}
                card={card}
                index={index}
              />
            ))}
          </div>
        ) : (
          <p className="rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">
            {loading ? t("perlica.userLoading") : t("perlica.noRideCard")}
          </p>
        )}
      </section>
    </div>
  )
}
