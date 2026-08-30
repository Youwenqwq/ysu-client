"use client"

import { useEffect, useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { useTranslation } from "@/lib/i18n/use-translation"
import { SkbirdClient, generateDeviceId } from "@/lib/extras/skbird/client"
import { useSkbirdStore } from "@/lib/extras/skbird/store"

export default function SkbirdSettingsPage() {
  const { t } = useTranslation()
  const { token, deviceId, alias, hasHydrated, setConfig } = useSkbirdStore()

  const [tokenInput, setTokenInput] = useState("")
  const [deviceIdInput, setDeviceIdInput] = useState("")
  const [aliasInput, setAliasInput] = useState("ysu")
  const [testing, setTesting] = useState(false)

  useEffect(() => {
    if (!hasHydrated) return
    setTokenInput(token)
    setDeviceIdInput(deviceId)
    setAliasInput(alias)
  }, [hasHydrated, token, deviceId, alias])

  function handleSave() {
    setConfig({ token: tokenInput, deviceId: deviceIdInput, alias: aliasInput })
    toast.success(t("skbird.saved"))
  }

  async function handleTest() {
    setTesting(true)
    try {
      const client = new SkbirdClient({
        token: tokenInput.trim(),
        deviceId: deviceIdInput.trim() || generateDeviceId(),
        alias: aliasInput.trim() || "ysu",
      })
      const info = await client.userInfo()
      const nickname = typeof info.nickname === "string" && info.nickname ? info.nickname : "OK"
      toast.success(t("skbird.testSuccess", { nickname }))
    } catch (e) {
      toast.error(
        t("skbird.testFailed", {
          message: e instanceof Error ? e.message : String(e),
        })
      )
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="p-4">
      <Card>
        <CardHeader>
          <CardTitle>{t("skbird.settingsTitle")}</CardTitle>
          <CardDescription>{t("skbird.noTokenHint")}</CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Field>
              <FieldLabel>{t("skbird.tokenLabel")}</FieldLabel>
              <Textarea
                value={tokenInput}
                onChange={(e) => setTokenInput(e.target.value)}
                placeholder="X-Sc-Token"
                rows={3}
                autoComplete="off"
              />
            </Field>
            <Field>
              <FieldLabel>{t("skbird.deviceIdLabel")}</FieldLabel>
              <Input
                value={deviceIdInput}
                onChange={(e) => setDeviceIdInput(e.target.value)}
                autoComplete="off"
              />
            </Field>
            <Field>
              <FieldLabel>{t("skbird.aliasLabel")}</FieldLabel>
              <Input
                value={aliasInput}
                onChange={(e) => setAliasInput(e.target.value)}
                autoComplete="off"
              />
              <FieldDescription>{t("skbird.aliasHint")}</FieldDescription>
            </Field>
            <div className="flex gap-2">
              <Button onClick={handleSave}>{t("skbird.save")}</Button>
              <Button
                variant="outline"
                onClick={handleTest}
                disabled={testing || !tokenInput.trim()}
              >
                {t("skbird.testConnection")}
              </Button>
            </div>
          </FieldGroup>
        </CardContent>
      </Card>
    </div>
  )
}
