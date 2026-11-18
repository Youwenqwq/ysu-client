import {
  AlertCircle,
  CheckCircle2,
  CircleFadingArrowUp,
  Download,
  RotateCcw,
  Settings,
} from "lucide-react"
import { useCallback, useState } from "react"
import type {
  DerivedComponentProps,
  ObservableSource,
  PluginUpdateService,
  SlotComponent,
  UpdateChannel,
  UpdateInfo,
} from "@orahako/sdk"
import {
  blurActiveElement,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Separator,
  Spinner,
  ToggleGroup,
  ToggleGroupItem,
  useLongPress,
} from "@orahako/ui-primitives"
import type { UpdaterDictionary } from "./dictionary"
import type { PwaInstallState } from "./pwa"
import { isUpdateChannel, type UpdaterPreferencesStore } from "./store"

type CheckPhase = "idle" | "checking" | "up-to-date" | "error"

const toMirrorToggleValue = (mirror: string): string => (mirror === "" ? "__direct__" : mirror)

export interface UpdaterSettingsInject {
  readonly updater: PluginUpdateService
  readonly isNative: () => boolean
  readonly onPresentUpdate: (info: UpdateInfo) => void
}

export type UpdaterSettingsControlProps = DerivedComponentProps<
  Record<string, never>,
  UpdaterDictionary,
  undefined,
  UpdaterPreferencesStore,
  UpdaterSettingsInject
>

export const UpdaterSettingsControl: SlotComponent<UpdaterSettingsControlProps> = (props) => {
  const { t, useStore, actions, updater, isNative, onPresentUpdate } = props
  const mirror = useStore((s) => s.mirror)
  const channel = useStore((s) => s.channel)
  const mirrors = updater.getMirrors()
  const native = isNative()

  const [dialogOpen, setDialogOpen] = useState(false)
  const [preset, setPreset] = useState("")
  const [customMirror, setCustomMirror] = useState("")
  const [draftChannel, setDraftChannel] = useState<UpdateChannel>("stable")
  const [checking, setChecking] = useState(false)

  if (!native) return null

  const openMirrorDialog = () => {
    const isPreset = mirrors.some((item) => item.value === mirror)
    if (isPreset) {
      setPreset(toMirrorToggleValue(mirror))
      setCustomMirror("")
    } else {
      setPreset("__custom__")
      setCustomMirror(mirror)
    }
    setDraftChannel(channel)
    setDialogOpen(true)
  }

  const confirmMirror = () => {
    if (preset === "__custom__") {
      actions.setMirror(customMirror.trim())
    } else {
      actions.setMirror(preset === "__direct__" ? "" : preset)
    }
    actions.setChannel(draftChannel)
    setDialogOpen(false)
  }

  const handleManualCheck = async () => {
    if (checking) return
    setChecking(true)
    try {
      const info = await updater.checkForUpdate({
        automatic: false,
        mirror,
        channel,
      })
      if (info.available || info.apkUpdateAvailable) {
        blurActiveElement()
        onPresentUpdate(info)
      }
    } catch {
      // Errors surface explicitly in About check section; settings row stays compact.
    } finally {
      setChecking(false)
    }
  }

  return (
    <>
      <div data-updater-settings="" className="flex items-center gap-3 border-t border-border py-3">
        <CircleFadingArrowUp className="size-5 shrink-0 text-muted-foreground" />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="text-sm">{t("channel")}</span>
          <span className="truncate text-xs text-muted-foreground">
            {channel === "prerelease" ? t("channelPrerelease") : t("channelStable")}
          </span>
        </div>
        <Button size="sm" variant="outline" onClick={openMirrorDialog}>
          <Settings className="size-3.5" />
          {t("mirrorSettings")}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={checking}
          onClick={() => void handleManualCheck()}
        >
          {checking ? <Spinner className="size-4" /> : t("checkUpdate")}
        </Button>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("mirrorSettings")}</DialogTitle>
            <DialogDescription>{t("mirrorSettingsDesc")}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <ToggleGroup
              type="single"
              value={preset}
              onValueChange={(v) => {
                if (v) setPreset(v)
              }}
              variant="outline"
              size="sm"
              className="flex flex-wrap"
            >
              {mirrors.map((m) => (
                <ToggleGroupItem
                  key={m.value}
                  value={toMirrorToggleValue(m.value)}
                  className="text-xs"
                >
                  {m.label}
                </ToggleGroupItem>
              ))}
              <ToggleGroupItem value="__custom__" className="text-xs">
                {t("mirrorCustom")}
              </ToggleGroupItem>
            </ToggleGroup>
            {preset === "__custom__" && (
              <Input
                placeholder={t("mirrorPlaceholder")}
                value={customMirror}
                onChange={(e) => setCustomMirror(e.target.value)}
                className="text-xs"
              />
            )}
            <Separator />
            <div className="flex flex-col gap-2">
              <div className="flex flex-col gap-1">
                <span className="text-sm font-medium">{t("channel")}</span>
                <span className="text-xs text-muted-foreground">{t("channelDesc")}</span>
              </div>
              <ToggleGroup
                type="single"
                value={draftChannel}
                onValueChange={(v) => {
                  if (isUpdateChannel(v)) setDraftChannel(v)
                }}
                variant="outline"
                size="sm"
                className="flex flex-wrap"
              >
                <ToggleGroupItem value="stable" className="text-xs">
                  {t("channelStable")}
                </ToggleGroupItem>
                <ToggleGroupItem value="prerelease" className="text-xs">
                  {t("channelPrerelease")}
                </ToggleGroupItem>
              </ToggleGroup>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={confirmMirror}>{t("confirm")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

export interface UpdaterAboutInject {
  readonly updater: PluginUpdateService
  readonly currentVersion: string
  readonly isNative: () => boolean
  readonly onPresentUpdate: (info: UpdateInfo) => void
  readonly promptPwaInstall: () => Promise<unknown>
  readonly hooks: {
    readonly installState: ObservableSource<PwaInstallState>
  }
}

export type UpdaterAboutSectionProps = DerivedComponentProps<
  Record<string, never>,
  UpdaterDictionary,
  undefined,
  UpdaterPreferencesStore,
  UpdaterAboutInject
>

export const UpdaterAboutSection: SlotComponent<UpdaterAboutSectionProps> = (props) => {
  const {
    t,
    useStore,
    actions,
    updater,
    currentVersion,
    isNative,
    onPresentUpdate,
    promptPwaInstall,
    useInstallState,
  } = props

  const mirror = useStore((s) => s.mirror)
  const channel = useStore((s) => s.channel)
  const installState = useInstallState()
  const mirrors = updater.getMirrors()
  const native = isNative()

  const [checkPhase, setCheckPhase] = useState<CheckPhase>("idle")
  const [errorMsg, setErrorMsg] = useState("")
  const [showMirrorDialog, setShowMirrorDialog] = useState(false)
  const [dialogPreset, setDialogPreset] = useState("")
  const [dialogCustomValue, setDialogCustomValue] = useState("")
  const [dialogChannel, setDialogChannel] = useState<UpdateChannel>("stable")
  const [showIosInstructions, setShowIosInstructions] = useState(false)
  const [promptingInstall, setPromptingInstall] = useState(false)

  const openMirrorDialog = useCallback(() => {
    const isPreset = mirrors.some((m) => m.value === mirror)
    if (isPreset) {
      setDialogPreset(toMirrorToggleValue(mirror))
      setDialogCustomValue("")
    } else {
      setDialogPreset("__custom__")
      setDialogCustomValue(mirror)
    }
    setDialogChannel(channel)
    setShowMirrorDialog(true)
  }, [channel, mirror, mirrors])

  const longPressHandlers = useLongPress(openMirrorDialog)

  const confirmMirror = () => {
    if (dialogPreset === "__custom__") {
      actions.setMirror(dialogCustomValue.trim())
    } else {
      actions.setMirror(dialogPreset === "__direct__" ? "" : dialogPreset)
    }
    actions.setChannel(dialogChannel)
    setShowMirrorDialog(false)
  }

  const handleCheck = useCallback(async () => {
    if (!native) return
    setCheckPhase("checking")
    try {
      const info = await updater.checkForUpdate({
        automatic: false,
        mirror,
        channel,
      })
      if (info.available || info.apkUpdateAvailable) {
        blurActiveElement()
        onPresentUpdate(info)
        setCheckPhase("idle")
      } else {
        setCheckPhase("up-to-date")
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : ""
      setErrorMsg(message === "RATE_LIMIT" ? t("errorRateLimit") : t("errorNetwork"))
      setCheckPhase("error")
    }
  }, [channel, mirror, native, onPresentUpdate, t, updater])

  const handleReset = useCallback(async () => {
    try {
      await updater.resetToBuiltin()
      setCheckPhase("idle")
    } catch {
      // Ignore reset errors on unmodified bundles.
    }
  }, [updater])

  const showInstallRow =
    !native &&
    !installState.installed &&
    (Boolean(installState.deferredPrompt) || installState.isIos)

  const handleInstallPwa = async () => {
    if (!installState.deferredPrompt) {
      setShowIosInstructions(true)
      return
    }
    setPromptingInstall(true)
    try {
      await promptPwaInstall()
    } finally {
      setPromptingInstall(false)
    }
  }

  if (!native && !showInstallRow) return null

  return (
    <div data-updater-about="" className="flex flex-col">
      {showInstallRow && (
        <>
          <Separator />
          <button
            type="button"
            onClick={() => void handleInstallPwa()}
            disabled={promptingInstall}
            className="flex items-center gap-3 py-3 transition-colors active:bg-muted/60 disabled:opacity-50"
          >
            <Download className="size-5 shrink-0 text-muted-foreground" />
            <span className="flex-1 text-left text-sm">{t("installApp")}</span>
            <span className="text-xs text-muted-foreground">{t("installAppDesc")}</span>
          </button>

          <Dialog open={showIosInstructions} onOpenChange={setShowIosInstructions}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{t("installAppIosTitle")}</DialogTitle>
                <DialogDescription>{t("installAppDesc")}</DialogDescription>
              </DialogHeader>
              <ol className="ml-5 list-decimal space-y-2 text-sm">
                <li>{t("installAppIosStep1")}</li>
                <li>{t("installAppIosStep2")}</li>
                <li>{t("installAppIosStep3")}</li>
              </ol>
              <DialogFooter>
                <Button onClick={() => setShowIosInstructions(false)}>{t("ok")}</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      )}

      {native && (
        <>
          <Separator />
          {checkPhase === "idle" && (
            <button
              type="button"
              onClick={() => void handleCheck()}
              {...longPressHandlers}
              className="flex items-center gap-3 py-3 transition-colors active:bg-muted/60"
            >
              <CircleFadingArrowUp className="size-5 shrink-0 text-muted-foreground" />
              <span className="flex-1 text-left text-sm">{t("checkUpdate")}</span>
              <span className="text-xs text-muted-foreground">
                {t("versionLabel")} {currentVersion}
              </span>
            </button>
          )}
          {checkPhase === "checking" && (
            <div className="flex items-center gap-3 py-3">
              <Spinner className="size-5 shrink-0 text-muted-foreground" />
              <span className="flex-1 text-left text-sm text-muted-foreground">
                {t("checking")}
              </span>
            </div>
          )}
          {checkPhase === "up-to-date" && (
            <div className="flex items-center gap-3 py-3">
              <CheckCircle2 className="size-5 shrink-0 text-muted-foreground" />
              <span className="flex-1 text-left text-sm text-muted-foreground">
                {t("upToDateDesc")}
              </span>
              <span className="text-xs text-muted-foreground">
                {t("versionLabel")} {currentVersion}
              </span>
            </div>
          )}
          {checkPhase === "error" && (
            <div className="flex flex-col gap-2 py-3">
              <div className="flex items-center gap-3">
                <AlertCircle className="size-5 shrink-0 text-destructive" />
                <span className="flex-1 text-left text-sm text-destructive">{errorMsg}</span>
              </div>
              <div className="ml-8 flex gap-2">
                <Button size="sm" variant="outline" onClick={() => void handleCheck()}>
                  {t("retry")}
                </Button>
                <Button size="sm" variant="outline" onClick={openMirrorDialog}>
                  <Settings className="size-3.5" />
                  {t("mirrorSettings")}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => void handleReset()}>
                  {t("resetToFactory")}
                </Button>
              </div>
            </div>
          )}

          <Dialog open={showMirrorDialog} onOpenChange={setShowMirrorDialog}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{t("mirrorSettings")}</DialogTitle>
                <DialogDescription>{t("mirrorSettingsDesc")}</DialogDescription>
              </DialogHeader>
              <div className="flex flex-col gap-3">
                <ToggleGroup
                  type="single"
                  value={dialogPreset}
                  onValueChange={(v) => {
                    if (v) setDialogPreset(v)
                  }}
                  variant="outline"
                  size="sm"
                  className="flex flex-wrap"
                >
                  {mirrors.map((m) => (
                    <ToggleGroupItem
                      key={m.value}
                      value={toMirrorToggleValue(m.value)}
                      className="text-xs"
                    >
                      {m.label}
                    </ToggleGroupItem>
                  ))}
                  <ToggleGroupItem value="__custom__" className="text-xs">
                    {t("mirrorCustom")}
                  </ToggleGroupItem>
                </ToggleGroup>
                {dialogPreset === "__custom__" && (
                  <Input
                    placeholder={t("mirrorPlaceholder")}
                    value={dialogCustomValue}
                    onChange={(e) => setDialogCustomValue(e.target.value)}
                    className="text-xs"
                  />
                )}
                <Separator />
                <div className="flex flex-col gap-2">
                  <div className="flex flex-col gap-1">
                    <span className="text-sm font-medium">{t("channel")}</span>
                    <span className="text-xs text-muted-foreground">{t("channelDesc")}</span>
                  </div>
                  <ToggleGroup
                    type="single"
                    value={dialogChannel}
                    onValueChange={(v) => {
                      if (isUpdateChannel(v)) setDialogChannel(v)
                    }}
                    variant="outline"
                    size="sm"
                    className="flex flex-wrap"
                  >
                    <ToggleGroupItem value="stable" className="text-xs">
                      {t("channelStable")}
                    </ToggleGroupItem>
                    <ToggleGroupItem value="prerelease" className="text-xs">
                      {t("channelPrerelease")}
                    </ToggleGroupItem>
                  </ToggleGroup>
                </div>
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">{t("resetToFactory")}</span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setShowMirrorDialog(false)
                    void handleReset()
                  }}
                >
                  <RotateCcw className="size-3.5" />
                  {t("resetToFactory")}
                </Button>
              </div>
              <DialogFooter>
                <Button onClick={confirmMirror}>{t("confirm")}</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      )}
    </div>
  )
}
