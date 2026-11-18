import { useEffect, useState } from "react"
import { toast } from "sonner"
import type { DerivedComponentProps, SlotComponent } from "@orahako/sdk"
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  Input,
  SettingsSection,
} from "@orahako/ui-primitives"
import {
  isValidHttpBaseUrl,
  normalizeEndpointBaseUrl,
  ysuSettingsDictionary,
  type YsuEndpointCategoryInject,
  type YsuEndpointStoreInstance,
} from "./endpoints"

export type YsuEndpointSettingsPanelProps = DerivedComponentProps<
  Record<string, never>,
  typeof ysuSettingsDictionary,
  undefined,
  YsuEndpointStoreInstance,
  YsuEndpointCategoryInject
>

export const YsuEndpointSettingsPanel: SlotComponent<YsuEndpointSettingsPanelProps> = ({
  t,
  useStore,
  actions,
  defaultCerBaseUrl,
  defaultJwxtBaseUrl,
  onEndpointsChanged,
}) => {
  const storedCer = useStore((state) => state.customCerBaseUrl)
  const storedJwxt = useStore((state) => state.customJwxtBaseUrl)

  const [cerDraft, setCerDraft] = useState(storedCer)
  const [jwxtDraft, setJwxtDraft] = useState(storedJwxt)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setCerDraft(storedCer)
  }, [storedCer])

  useEffect(() => {
    setJwxtDraft(storedJwxt)
  }, [storedJwxt])

  const effectiveCer = normalizeEndpointBaseUrl(cerDraft, defaultCerBaseUrl)
  const effectiveJwxt = normalizeEndpointBaseUrl(jwxtDraft, defaultJwxtBaseUrl)

  const handleSave = async () => {
    if (!isValidHttpBaseUrl(cerDraft) || !isValidHttpBaseUrl(jwxtDraft)) {
      toast.error(t("invalidUrlToast"))
      return
    }
    const nextCer = cerDraft.trim().replace(/\/+$/, "")
    const nextJwxt = jwxtDraft.trim().replace(/\/+$/, "")
    const changed = nextCer !== storedCer || nextJwxt !== storedJwxt
    actions.setEndpoints({
      customCerBaseUrl: nextCer,
      customJwxtBaseUrl: nextJwxt,
    })
    setCerDraft(nextCer)
    setJwxtDraft(nextJwxt)
    if (changed) {
      setSaving(true)
      try {
        await onEndpointsChanged()
      } finally {
        setSaving(false)
      }
    }
    toast.success(t("savedToast"))
  }

  const handleReset = async () => {
    const hadCustom = storedCer.length > 0 || storedJwxt.length > 0
    actions.resetEndpoints()
    setCerDraft("")
    setJwxtDraft("")
    if (hadCustom) {
      setSaving(true)
      try {
        await onEndpointsChanged()
      } finally {
        setSaving(false)
      }
    }
    toast.success(t("resetToast"))
  }

  return (
    <SettingsSection title={t("sectionTitle")}>
      <Card>
        <CardHeader>
          <CardDescription>{t("sectionDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="ysu-cer-base-url">{t("cerLabel")}</FieldLabel>
              <Input
                id="ysu-cer-base-url"
                type="url"
                value={cerDraft}
                placeholder={t("cerPlaceholder", { url: defaultCerBaseUrl })}
                onChange={(event) => setCerDraft(event.target.value)}
              />
              <FieldDescription>{t("cerHint", { url: effectiveCer })}</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="ysu-jwxt-base-url">{t("jwxtLabel")}</FieldLabel>
              <Input
                id="ysu-jwxt-base-url"
                type="url"
                value={jwxtDraft}
                placeholder={t("jwxtPlaceholder", { url: defaultJwxtBaseUrl })}
                onChange={(event) => setJwxtDraft(event.target.value)}
              />
              <FieldDescription>{t("jwxtHint", { url: effectiveJwxt })}</FieldDescription>
            </Field>
          </FieldGroup>
        </CardContent>
        <CardFooter className="flex justify-end gap-2">
          <Button type="button" variant="outline" disabled={saving} onClick={handleReset}>
            {t("reset")}
          </Button>
          <Button type="button" disabled={saving} onClick={handleSave}>
            {t("save")}
          </Button>
        </CardFooter>
      </Card>
    </SettingsSection>
  )
}
