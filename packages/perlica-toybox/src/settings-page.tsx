"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { Check, LogOut } from "lucide-react"
import { toast } from "@orahako/plugin-sdk/host"
import { pluginPageHref, type PluginPageProps } from "@orahako/plugin-sdk"
import { PERLICA_PLUGIN_ID, PERLICA_PAGE_INDEX } from "./constants"
import { perlicaTab } from "./extras/app-nav"
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  Input,
  Skeleton,
  Textarea,
} from "@orahako/plugin-ui/components"
import { PerlicaAccountVerification } from "./components/perlica-account"
import { clearPerlicaSnapshot, readPerlicaSnapshot } from "./extras/cache"
import { PerlicaClient, PerlicaError } from "./extras/client"
import { usePerlicaStore } from "./extras/store"
import { parsePerlicaToken } from "./extras/types"
import { usePluginTranslation } from "@orahako/plugin-ui/plugin"

export function PerlicaSettingsPage({ params }: PluginPageProps) {
  const { t } = usePluginTranslation(PERLICA_PLUGIN_ID)
  const activeTab = perlicaTab(params)
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
    <div className="flex flex-col gap-4 p-4">
      <Card>
        <CardHeader>
          <CardTitle>{t("perlica.settingsTitle")}</CardTitle>
          <CardDescription>{t("perlica.settingsDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
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
        </CardContent>
      </Card>

      {debugSnapshot?.user ? (
        <Card>
          <CardHeader>
            <CardTitle>{t("perlica.accountInformation")}</CardTitle>
          </CardHeader>
          <CardContent>
            <PerlicaAccountVerification user={debugSnapshot.user} />
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{t("perlica.debugData")}</CardTitle>
          <CardDescription>{t("perlica.debugDataHint")}</CardDescription>
        </CardHeader>
        <CardContent>
          {debugJson ? (
            <details>
              <summary className="cursor-pointer text-sm font-medium">
                {t("perlica.showDebugData")}
              </summary>
              <pre className="mt-3 max-h-72 overflow-auto rounded-md bg-muted p-3 font-mono text-xs break-all whitespace-pre-wrap">
                {debugJson}
              </pre>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="mt-3"
                onClick={() => void handleCopyDebug()}
              >
                {t("perlica.copyDebugData")}
              </Button>
            </details>
          ) : (
            <p className="text-sm text-muted-foreground">{t("perlica.debugEmpty")}</p>
          )}
        </CardContent>
      </Card>

      <Button asChild variant="ghost" className="self-start">
        <Link href={pluginPageHref(PERLICA_PLUGIN_ID, PERLICA_PAGE_INDEX, { tab: activeTab })}>
          {t("perlica.backToPerlica")}
        </Link>
      </Button>
    </div>
  )
}
