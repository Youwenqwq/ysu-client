import { useCallback, useMemo, type ReactNode } from "react"
import Markdown from "react-markdown"
import type {
  AnnouncementLevel,
  DerivedComponentProps,
  SlotComponentOwner,
  TranslationKeyOf,
} from "@orahako/sdk"
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@orahako/ui-primitives"
import type { AnnouncementDictionary } from "./dictionary"
import type { AnnouncementStore } from "./store"

declare module "@orahako/sdk" {
  interface SlotMap {
    "shell.overlay": { kind: "list"; owner: Record<string, never> }
  }
}

export interface AnnouncementDialogInject {
  readonly dismiss: (id: string) => void
}

export type AnnouncementDialogProps = DerivedComponentProps<
  SlotComponentOwner<"shell.overlay">,
  AnnouncementDictionary,
  undefined,
  AnnouncementStore,
  AnnouncementDialogInject
>

const LEVEL_BADGE_CLASS: Record<AnnouncementLevel, string> = {
  info: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 hover:bg-blue-100",
  warning: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200 hover:bg-amber-100",
  critical: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200 hover:bg-red-100",
}

const LEVEL_LABEL_KEY: Record<AnnouncementLevel, TranslationKeyOf<AnnouncementDictionary>> = {
  info: "announcement.levelInfo",
  warning: "announcement.levelWarning",
  critical: "announcement.levelCritical",
}

export function AnnouncementDialog(props: AnnouncementDialogProps): ReactNode {
  const { t, useStore, actions, dismiss } = props
  const announcementInfo = useStore((state) => state.announcement)
  const open = useStore((state) => state.open)

  const handleClose = useCallback(() => {
    actions.close()
  }, [actions])

  const handleDismiss = useCallback(() => {
    if (announcementInfo?.id) {
      dismiss(announcementInfo.id)
    }
    actions.close()
  }, [actions, announcementInfo, dismiss])

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

  if (!announcementInfo) return null

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) handleClose()
      }}
    >
      <DialogContent className="flex max-h-[85vh] flex-col" showCloseButton={false}>
        <DialogHeader>
          <div className="flex items-center gap-2">
            <Badge className={LEVEL_BADGE_CLASS[announcementInfo.level]}>
              {t(LEVEL_LABEL_KEY[announcementInfo.level])}
            </Badge>
            <DialogTitle>{announcementInfo.title}</DialogTitle>
          </div>
          <DialogDescription className="sr-only">
            {t("announcement.dialogDescription")}
          </DialogDescription>
        </DialogHeader>

        <div className="my-4 min-h-0 flex-1 overflow-y-auto">
          {announcementInfo.content ? (
            <div className="max-w-none space-y-2 text-sm">
              <Markdown components={markdownComponents}>{announcementInfo.content}</Markdown>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{t("announcement.noContent")}</p>
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
  )
}
