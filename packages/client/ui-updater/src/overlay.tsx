import { RefreshCw } from "lucide-react"
import { useCallback, useMemo, useState, type ReactNode } from "react"
import Markdown from "react-markdown"
import type { DerivedComponentProps, SlotComponent } from "@orahako/sdk"
import type { PluginUpdateService } from "./contract"
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Progress,
} from "@orahako/ui-primitives"
import type { UpdaterDictionary } from "./dictionary"
import type { UpdaterRuntimeStore } from "./store"

type DialogPhase = "idle" | "downloading" | "downloaded" | "installing" | "error"

export interface UpdaterOverlayInject {
  readonly updater: PluginUpdateService
  readonly applyWebUpdate: () => Promise<void>
  readonly dismissWebUpdate: () => Promise<void>
}

export type UpdaterOverlayProps = DerivedComponentProps<
  Record<string, never>,
  UpdaterDictionary,
  undefined,
  UpdaterRuntimeStore,
  UpdaterOverlayInject
>

export const UpdaterOverlay: SlotComponent<UpdaterOverlayProps> = (props) => {
  const { t, useStore, actions, updater, applyWebUpdate, dismissWebUpdate } = props
  const updateInfo = useStore((s) => s.updateInfo)
  const showDialog = useStore((s) => s.showDialog)
  const pwaUpdateAvailable = useStore((s) => s.pwaUpdateAvailable)

  const [phase, setPhase] = useState<DialogPhase>("idle")
  const [progress, setProgress] = useState(0)
  const [errorMsg, setErrorMsg] = useState("")
  const [applyingPwa, setApplyingPwa] = useState(false)

  const isApk = updateInfo?.apkUpdateAvailable ?? false
  const isWebBundle = !isApk && (updateInfo?.available ?? false)
  const isBusy = phase === "downloading" || phase === "installing"
  const canShowDialog = showDialog && updateInfo !== null && (isApk || isWebBundle)

  const handleClose = useCallback(() => {
    actions.setShowDialog(false)
    setPhase("idle")
    setProgress(0)
    setErrorMsg("")
  }, [actions])

  const handleDownload = useCallback(async () => {
    if (!updateInfo) return
    setPhase("downloading")
    setProgress(0)
    try {
      if (isApk) {
        await updater.downloadApkInApp(updateInfo, setProgress)
      } else {
        await updater.downloadAndApply(updateInfo, setProgress)
      }
      setPhase("downloaded")
    } catch {
      setErrorMsg(t("errorDownload"))
      setPhase("error")
    }
  }, [isApk, t, updateInfo, updater])

  const handleRestart = useCallback(async () => {
    try {
      await updater.applyAndRestart()
    } catch {
      setErrorMsg(t("errorUnknown"))
      setPhase("error")
    }
  }, [t, updater])

  const handleInstallApk = useCallback(async () => {
    setPhase("installing")
    try {
      await updater.installDownloadedApk()
      handleClose()
    } catch {
      setErrorMsg(t("errorUnknown"))
      setPhase("error")
    }
  }, [handleClose, t, updater])

  const handleApplyPwa = async () => {
    setApplyingPwa(true)
    try {
      await applyWebUpdate()
    } catch {
      setApplyingPwa(false)
    }
  }

  const markdownComponents = useMemo(
    () => ({
      h1: ({ children }: { children?: ReactNode }) => (
        <h1 className="mt-3 mb-1 text-lg font-semibold">{children}</h1>
      ),
      h2: ({ children }: { children?: ReactNode }) => (
        <h2 className="mt-3 mb-1 text-base font-medium">{children}</h2>
      ),
      h3: ({ children }: { children?: ReactNode }) => (
        <h3 className="mt-2 mb-1 text-sm font-medium">{children}</h3>
      ),
      p: ({ children }: { children?: ReactNode }) => (
        <p className="text-sm leading-relaxed text-muted-foreground">{children}</p>
      ),
      ul: ({ children }: { children?: ReactNode }) => (
        <ul className="list-inside list-disc space-y-0.5 text-sm text-muted-foreground">
          {children}
        </ul>
      ),
      ol: ({ children }: { children?: ReactNode }) => (
        <ol className="list-inside list-decimal space-y-0.5 text-sm text-muted-foreground">
          {children}
        </ol>
      ),
      li: ({ children }: { children?: ReactNode }) => <li className="text-sm">{children}</li>,
      a: ({ children, href }: { children?: ReactNode; href?: string }) => (
        <a
          href={href}
          className="text-primary underline underline-offset-2"
          target="_blank"
          rel="noopener noreferrer"
        >
          {children}
        </a>
      ),
      code: ({ children }: { children?: ReactNode }) => (
        <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">{children}</code>
      ),
      pre: ({ children }: { children?: ReactNode }) => (
        <pre className="overflow-x-auto rounded-md bg-muted p-2 font-mono text-xs">{children}</pre>
      ),
      strong: ({ children }: { children?: ReactNode }) => (
        <strong className="font-semibold text-foreground">{children}</strong>
      ),
      em: ({ children }: { children?: ReactNode }) => <em className="italic">{children}</em>,
      blockquote: ({ children }: { children?: ReactNode }) => (
        <blockquote className="border-l-2 border-muted-foreground/30 pl-3 text-muted-foreground italic">
          {children}
        </blockquote>
      ),
    }),
    []
  )

  const title = isApk
    ? t("apkNewVersionTitle", { version: updateInfo?.version ?? "" })
    : t("newVersionTitle", { version: updateInfo?.version ?? "" })

  const primaryLabel =
    phase === "downloaded"
      ? isApk
        ? t("install")
        : t("restartNow")
      : phase === "installing"
        ? t("installing")
        : isApk
          ? t("apkDownload")
          : t("download")

  const primaryAction =
    phase === "downloaded" ? (isApk ? handleInstallApk : handleRestart) : handleDownload

  return (
    <>
      {pwaUpdateAvailable && (
        <div
          role="status"
          data-pwa-update-banner=""
          className="fixed inset-x-4 bottom-20 z-40 mx-auto flex max-w-md items-center gap-3 rounded-xl border bg-background/95 p-3 shadow-lg backdrop-blur md:bottom-4"
        >
          <RefreshCw className="size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 text-sm">{t("pwaReady")}</span>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void dismissWebUpdate()}
            disabled={applyingPwa}
          >
            {t("skip")}
          </Button>
          <Button size="sm" onClick={() => void handleApplyPwa()} disabled={applyingPwa}>
            {applyingPwa ? t("applying") : t("pwaRestart")}
          </Button>
        </div>
      )}

      <Dialog
        open={canShowDialog}
        onOpenChange={(open) => {
          if (!open && !isBusy) {
            handleClose()
          } else if (open) {
            actions.setShowDialog(true)
          }
        }}
      >
        <DialogContent className="flex max-h-[85vh] flex-col" showCloseButton={!isBusy}>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription className="sr-only">{t("dialogDescription")}</DialogDescription>
          </DialogHeader>

          <div className="my-4 min-h-0 flex-1 overflow-y-auto">
            {phase === "downloading" ? (
              <div className="flex flex-col gap-2">
                <span className="text-sm text-muted-foreground">
                  {t("downloading")} {progress}%
                </span>
                <Progress value={progress} />
              </div>
            ) : phase === "error" ? (
              <p className="text-sm text-destructive">{errorMsg}</p>
            ) : (
              <div className="max-w-none space-y-2 text-sm">
                {updateInfo?.body ? (
                  <Markdown components={markdownComponents}>{updateInfo.body}</Markdown>
                ) : (
                  <p className="text-sm text-muted-foreground">{t("noReleaseNotes")}</p>
                )}
              </div>
            )}
          </div>

          <DialogFooter>
            {!isBusy && (
              <Button variant="outline" onClick={handleClose}>
                {phase === "downloaded" ? t("cancel") : t("skip")}
              </Button>
            )}
            <Button onClick={() => void primaryAction()} disabled={isBusy}>
              {primaryLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
