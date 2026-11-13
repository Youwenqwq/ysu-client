"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { Bike, Check, LogOut } from "lucide-react"
import { toast } from "@orahako/plugin-sdk/host"
import { pluginPageHref, type PluginPageProps } from "@orahako/plugin-sdk"
import { PerlicaSectionNav } from "./components/perlica-section-nav"
import { PERLICA_PLUGIN_ID, PERLICA_PAGE_INDEX } from "./constants"
import { usePerlicaAppNav, type PerlicaTab } from "./extras/app-nav"
import { Button } from "@orahako/plugin-ui/components"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@orahako/plugin-ui/components"
import { Input } from "@orahako/plugin-ui/components"
import { Skeleton } from "@orahako/plugin-ui/components"
import { Textarea } from "@orahako/plugin-ui/components"
import { clearPerlicaSnapshot, readPerlicaSnapshot } from "./extras/cache"
import { PerlicaClient, PerlicaError } from "./extras/client"
import { usePerlicaStore } from "./extras/store"
import { parsePerlicaToken } from "./extras/types"
import { usePluginTranslation } from "@orahako/plugin-ui/plugin"

export function PerlicaSettingsPage({ navigate }: PluginPageProps) {
  const { t } = usePluginTranslation(PERLICA_PLUGIN_ID)
  const activeTab = usePerlicaAppNav((state) => state.tab)
  const token = usePerlicaStore((state) => state.token)
  const accountId = usePerlicaStore((state) => state.accountId)
  const adAccountId = usePerlicaStore((state) => state.adAccountId)
  const hasHydrated = usePerlicaStore((state) => state.hasHydrated)
  const login = usePerlicaStore((state) => state.login)
  const logout = usePerlicaStore((state) => state.logout)

  const [input, setInput] = useState("")
  const [adAccountInput, setAdAccountInput] = useState("11423")
  const [validating, setValidating] = useState(false)
  const mountedRef = useRef(false)
  const validationGenerationRef = useRef(0)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      validationGenerationRef.current += 1
    }
  }, [])

  useEffect(() => {
    validationGenerationRef.current += 1
  }, [accountId, token])

  useEffect(() => {
    if (!hasHydrated) return
    setInput(token)
    setAdAccountInput(adAccountId || "11423")
  }, [adAccountId, hasHydrated, token])

  const selectAppTab = useCallback(
    (value: PerlicaTab) => {
      navigate(PERLICA_PAGE_INDEX, { tab: value })
    },
    [navigate]
  )

  const debugSnapshot = useMemo(() => {
    if (!hasHydrated || !accountId) return null
    return readPerlicaSnapshot(accountId)
  }, [accountId, hasHydrated])
  const debugJson = useMemo(() => {
    if (!debugSnapshot) return ""
    return JSON.stringify(debugSnapshot, null, 2)
      .replace(/TOKEN:[^\s"&?#]+/gi, "TOKEN:[redacted]")
      .replace(/https?:\/\/\S+/gi, "[URL removed]")
  }, [debugSnapshot])

  async function handleCopyDebug() {
    if (!debugJson) return
    try {
      await navigator.clipboard.writeText(debugJson)
      toast.success(t("perlica.debugCopied"))
    } catch {
      toast.error(t("perlica.debugCopyFailed"))
    }
  }

  async function handleValidateAndSave() {
    if (validating) return
    const generation = ++validationGenerationRef.current
    setValidating(true)
    try {
      const parsed = parsePerlicaToken(input)
      const config = {
        token: parsed.token,
        accountId: parsed.accountId,
        adAccountId: adAccountInput.trim() || "11423",
      }
      const client = new PerlicaClient(config)
      const info = await client.userInfo()
      if (!mountedRef.current || generation !== validationGenerationRef.current) return
      if (accountId !== parsed.accountId) {
        clearPerlicaSnapshot(accountId)
        clearPerlicaSnapshot(parsed.accountId)
      }
      setValidating(false)
      login(config)
      const nickname =
        typeof info.nickname === "string" && info.nickname.trim()
          ? info.nickname
          : t("perlica.accountVerified")
      toast.success(t("perlica.validationSuccess", { nickname }))
    } catch (error) {
      if (!mountedRef.current || generation !== validationGenerationRef.current) return
      toast.error(
        error instanceof PerlicaError
          ? t("perlica.validationFailedRet", {
              ret: error.ret,
              message:
                error.message
                  .replace(/TOKEN:[^\s&?#]+/gi, "[redacted]")
                  .replace(/https?:\/\/\S+/gi, "[URL removed]")
                  .trim() || "—",
            })
          : t("perlica.validationFailed")
      )
    } finally {
      if (mountedRef.current && generation === validationGenerationRef.current) {
        setValidating(false)
      }
    }
  }

  function handleLogout() {
    validationGenerationRef.current += 1
    setValidating(false)
    clearPerlicaSnapshot(accountId)
    logout()
    setInput("")
    setAdAccountInput("11423")
    toast.success(t("perlica.loggedOut"))
  }

  if (!hasHydrated) {
    return (
      <div className="p-4">
        <Skeleton className="h-80 w-full" />
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <PerlicaSectionNav active="account" onSelect={selectAppTab} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-6 pb-[calc(var(--mobile-bottom-nav-height,5rem)+2rem)] sm:px-6 md:py-10 md:pb-10">
          <header className="border-b pb-6">
            <div className="flex items-center gap-2.5">
              <Bike className="size-5 text-muted-foreground" />
              <h2 className="text-2xl font-semibold tracking-tight">
                {t("perlica.settingsTitle")}
              </h2>
            </div>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              {t("perlica.settingsDescription")}
            </p>
          </header>

          <section className="border-b pb-8">
            <FieldGroup>
              <Field>
                <FieldLabel>{t("perlica.tokenLabel")}</FieldLabel>
                <Textarea
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  placeholder={t("perlica.tokenPlaceholder")}
                  rows={5}
                  autoComplete="off"
                  autoCapitalize="off"
                  spellCheck={false}
                />
                <FieldDescription>{t("perlica.tokenHint")}</FieldDescription>
              </Field>
              <Field>
                <FieldLabel>{t("perlica.adAccountLabel")}</FieldLabel>
                <Input
                  value={adAccountInput}
                  onChange={(event) => setAdAccountInput(event.target.value)}
                  inputMode="numeric"
                  autoComplete="off"
                />
                <FieldDescription>{t("perlica.adAccountHint")}</FieldDescription>
              </Field>
              <div className="flex flex-wrap gap-2">
                <Button
                  onClick={() => void handleValidateAndSave()}
                  disabled={validating || !input.trim()}
                >
                  <Check data-icon="inline-start" />
                  {validating ? t("perlica.validating") : t("perlica.validateAndSave")}
                </Button>
                {token ? (
                  <Button variant="outline" onClick={handleLogout} disabled={validating}>
                    <LogOut data-icon="inline-start" />
                    {t("perlica.logout")}
                  </Button>
                ) : null}
              </div>
            </FieldGroup>
          </section>

          <section>
            <h3 className="text-sm font-semibold">{t("perlica.debugData")}</h3>
            <p className="mt-1.5 text-sm leading-6 text-muted-foreground">
              {t("perlica.debugDataHint")}
            </p>
            <div className="mt-4">
              {debugJson ? (
                <details className="border-y py-3">
                  <summary className="cursor-pointer text-sm font-medium">
                    {t("perlica.showDebugData")}
                  </summary>
                  <pre className="mt-4 max-h-72 overflow-auto rounded-lg bg-muted/50 p-3 font-mono text-[11px] leading-relaxed break-all whitespace-pre-wrap">
                    {debugJson}
                  </pre>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="mt-3 mb-1"
                    onClick={() => void handleCopyDebug()}
                  >
                    {t("perlica.copyDebugData")}
                  </Button>
                </details>
              ) : (
                <p className="border-y py-5 text-sm text-muted-foreground">
                  {t("perlica.debugEmpty")}
                </p>
              )}
            </div>
          </section>

          <Button asChild variant="ghost" className="self-start">
            <Link href={pluginPageHref(PERLICA_PLUGIN_ID, PERLICA_PAGE_INDEX, { tab: activeTab })}>
              {t("perlica.backToPerlica")}
            </Link>
          </Button>
        </div>
      </div>
    </div>
  )
}
