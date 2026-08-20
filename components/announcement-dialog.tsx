"use client";

import { useCallback, useMemo } from "react";
import Markdown from "react-markdown";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useTranslation } from "@/lib/i18n/use-translation";
import { useAnnouncementStore } from "@/lib/stores/announcement";
import { dismissAnnouncement, type AnnouncementLevel } from "@/lib/announcement";

interface AnnouncementDialogProps {
  onDismissed?: () => void;
}

const levelBadgeClass: Record<AnnouncementLevel, string> = {
  info: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 hover:bg-blue-100",
  warning: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200 hover:bg-amber-100",
  critical: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200 hover:bg-red-100",
};

const levelLabelKey: Record<AnnouncementLevel, string> = {
  info: "announcement.levelInfo",
  warning: "announcement.levelWarning",
  critical: "announcement.levelCritical",
};

export function AnnouncementDialog({ onDismissed }: AnnouncementDialogProps) {
  const { t } = useTranslation();
  const announcementInfo = useAnnouncementStore((s) => s.announcementInfo);
  const showDialog = useAnnouncementStore((s) => s.showDialog);
  const setShowDialog = useAnnouncementStore((s) => s.setShowDialog);

  const handleClose = useCallback(() => {
    setShowDialog(false);
    onDismissed?.();
  }, [setShowDialog, onDismissed]);

  const handleDismiss = useCallback(() => {
    if (announcementInfo?.id) {
      dismissAnnouncement(announcementInfo.id);
    }
    handleClose();
  }, [announcementInfo, handleClose]);

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
        <a href={href} className="text-primary underline underline-offset-2" target="_blank" rel="noopener noreferrer">
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

  if (!announcementInfo) return null;

  return (
    <Dialog
      open={showDialog}
      onOpenChange={(open) => {
        if (!open) handleClose();
      }}
    >
      <DialogContent className="max-h-[85vh] flex flex-col" showCloseButton={false}>
        <DialogHeader>
          <div className="flex items-center gap-2">
            <Badge className={levelBadgeClass[announcementInfo.level]}>
              {t(levelLabelKey[announcementInfo.level])}
            </Badge>
            <DialogTitle>{announcementInfo.title}</DialogTitle>
          </div>
          <DialogDescription className="sr-only">
            {t("announcement.dialogDescription")}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto min-h-0 my-4">
          {announcementInfo.content ? (
            <div className="text-sm max-w-none space-y-2">
              <Markdown components={markdownComponents}>
                {announcementInfo.content}
              </Markdown>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              {t("announcement.noContent")}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            {t("announcement.gotIt")}
          </Button>
          <Button variant="secondary" onClick={handleDismiss}>
            {t("announcement.dismiss")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
