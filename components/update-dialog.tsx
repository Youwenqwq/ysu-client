"use client";

import { useState, useCallback, useMemo } from "react";
import Markdown from "react-markdown";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useTranslation } from "@/lib/i18n/use-translation";
import { useUpdateStore } from "@/lib/update-store";
import {
  downloadAndApply,
  applyAndRestart,
  openApkDownload,
} from "@/lib/updater";

type DialogState = "idle" | "downloading" | "downloaded" | "error";

export function UpdateDialog() {
  const { t } = useTranslation();
  const updateInfo = useUpdateStore((s) => s.updateInfo);
  const showDialog = useUpdateStore((s) => s.showDialog);
  const setShowDialog = useUpdateStore((s) => s.setShowDialog);

  const [state, setState] = useState<DialogState>("idle");
  const [progress, setProgress] = useState(0);
  const [errorMsg, setErrorMsg] = useState("");

  const isApk = updateInfo?.apkUpdateAvailable ?? false;
  const isWeb = !isApk && (updateInfo?.available ?? false);

  const handleClose = useCallback(() => {
    setShowDialog(false);
    // Reset local state after animation
    setTimeout(() => {
      setState("idle");
      setProgress(0);
      setErrorMsg("");
    }, 300);
  }, [setShowDialog]);

  const handleDownload = useCallback(async () => {
    if (!updateInfo) return;

    if (isApk) {
      openApkDownload(updateInfo.apkDownloadUrl);
      handleClose();
      return;
    }

    setState("downloading");
    setProgress(0);
    try {
      await downloadAndApply(updateInfo, setProgress);
      setState("downloaded");
    } catch {
      setErrorMsg(t("update.errorDownload"));
      setState("error");
    }
  }, [updateInfo, isApk, handleClose, t]);

  const handleRestart = useCallback(async () => {
    try {
      await applyAndRestart();
    } catch {
      setErrorMsg(t("update.errorUnknown"));
      setState("error");
    }
  }, [t]);

  const title = isApk
    ? t("update.apkNewVersionTitle").replace("{version}", updateInfo?.version ?? "")
    : t("update.newVersionTitle").replace("{version}", updateInfo?.version ?? "");

  const primaryLabel =
    state === "downloaded"
      ? t("update.restartNow")
      : isApk
        ? t("update.apkDownload")
        : t("update.download");

  const primaryAction =
    state === "downloaded" ? handleRestart : handleDownload;

  const canShow = showDialog && updateInfo !== null && (isApk || isWeb);

  const markdownComponents = useMemo(
    () => ({
      h1: ({ children }: { children?: React.ReactNode }) => (
        <h1 className="text-lg font-semibold mt-3 mb-1">{children}</h1>
      ),
      h2: ({ children }: { children?: React.ReactNode }) => (
        <h2 className="text-base font-medium mt-3 mb-1">{children}</h2>
      ),
      h3: ({ children }: { children?: React.ReactNode }) => (
        <h3 className="text-sm font-medium mt-2 mb-1">{children}</h3>
      ),
      p: ({ children }: { children?: React.ReactNode }) => (
        <p className="text-sm text-muted-foreground leading-relaxed">{children}</p>
      ),
      ul: ({ children }: { children?: React.ReactNode }) => (
        <ul className="list-disc list-inside text-sm text-muted-foreground space-y-0.5">{children}</ul>
      ),
      ol: ({ children }: { children?: React.ReactNode }) => (
        <ol className="list-decimal list-inside text-sm text-muted-foreground space-y-0.5">{children}</ol>
      ),
      li: ({ children }: { children?: React.ReactNode }) => (
        <li className="text-sm">{children}</li>
      ),
      a: ({ children, href }: { children?: React.ReactNode; href?: string }) => (
        <a href={href} className="text-primary hover:underline" target="_blank" rel="noopener noreferrer">
          {children}
        </a>
      ),
      code: ({ children }: { children?: React.ReactNode }) => (
        <code className="bg-muted px-1 py-0.5 rounded text-xs font-mono">{children}</code>
      ),
      pre: ({ children }: { children?: React.ReactNode }) => (
        <pre className="bg-muted p-2 rounded-md overflow-x-auto text-xs font-mono">{children}</pre>
      ),
      strong: ({ children }: { children?: React.ReactNode }) => (
        <strong className="font-semibold text-foreground">{children}</strong>
      ),
      em: ({ children }: { children?: React.ReactNode }) => (
        <em className="italic">{children}</em>
      ),
      blockquote: ({ children }: { children?: React.ReactNode }) => (
        <blockquote className="border-l-2 border-muted-foreground/30 pl-3 italic text-muted-foreground">
          {children}
        </blockquote>
      ),
    }),
    []
  );

  return (
    <Dialog
      open={canShow}
      onOpenChange={(open) => {
        if (!open) handleClose();
        else setShowDialog(true);
      }}
    >
      <DialogContent className="max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto min-h-0 my-4">
          {state === "downloading" ? (
            <div className="flex flex-col gap-2">
              <span className="text-sm text-muted-foreground">
                {t("update.downloading")} {progress}%
              </span>
              <Progress value={progress} />
            </div>
          ) : state === "error" ? (
            <p className="text-sm text-destructive">{errorMsg}</p>
          ) : (
            <div className="text-sm max-w-none space-y-2">
              {updateInfo?.body ? (
                <Markdown components={markdownComponents}>
                  {updateInfo.body}
                </Markdown>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {t("update.noReleaseNotes")}
                </p>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          {state !== "downloading" && (
            <Button variant="outline" onClick={handleClose}>
              {state === "downloaded" ? t("update.cancel") : t("update.skip")}
            </Button>
          )}
          <Button
            onClick={primaryAction}
            disabled={state === "downloading"}
          >
            {primaryLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
