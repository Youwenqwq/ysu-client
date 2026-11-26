import { useCallback, useRef } from "react"
import { Code, ExternalLink, Sparkles } from "lucide-react"
import { Separator } from "@orahako/ui-primitives"
import type { DerivedComponentProps, PluginLocale, SlotComponent } from "@orahako/sdk"
import "../slots-declare"
import type { ProfileDictionary } from "../dictionary"

export const DEBUG_TAP_THRESHOLD = 7
export const DEBUG_TAP_WINDOW_MS = 3000

export const aboutPageChildren = {
  "about.extra": { kind: "list" },
} as const

export interface AboutPageInject {
  readonly getAppName: (locale: PluginLocale) => string
  readonly appVersion: string
  readonly appBuild: string
  readonly repoUrl: string
  readonly repoLabel: string
  readonly license: string
  readonly copyright: string
  readonly iconUrl?: string
  readonly navigateToDebug: () => void
  readonly now?: () => number
}

export type AboutPageProps = DerivedComponentProps<
  Record<string, never>,
  ProfileDictionary,
  typeof aboutPageChildren,
  undefined,
  AboutPageInject
>

export const AboutPage: SlotComponent<AboutPageProps> = (props) => {
  const { locale, renderSlot } = props
  const tapTimesRef = useRef<number[]>([])
  const readNow = props.now ?? Date.now

  const handleDebugTap = useCallback(() => {
    const now = readNow()
    const recent = tapTimesRef.current.filter((ts) => now - ts < DEBUG_TAP_WINDOW_MS)
    recent.push(now)
    tapTimesRef.current = recent
    if (recent.length >= DEBUG_TAP_THRESHOLD) {
      tapTimesRef.current = []
      props.navigateToDebug()
    }
  }, [props, readNow])

  const appName = props.getAppName(locale)
  const extraNode = renderSlot("about.extra")

  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col px-4" data-page="about">
      <div className="flex flex-1 flex-col">
        <div className="flex flex-col gap-5">
          <div className="flex flex-col items-center gap-3 pt-2 pb-1">
            <button
              type="button"
              data-about-icon-trigger=""
              onClick={handleDebugTap}
              aria-label={appName}
              className="flex size-24 items-center justify-center overflow-hidden rounded-3xl bg-primary/10 text-primary shadow-sm ring-1 ring-border transition-transform active:scale-95"
            >
              {props.iconUrl ? (
                <span
                  role="img"
                  aria-label={appName}
                  className="size-full bg-cover bg-center"
                  style={{ backgroundImage: `url(${props.iconUrl})` }}
                />
              ) : (
                <Sparkles className="size-10" />
              )}
            </button>
            <div className="flex flex-col items-center gap-1">
              <h2 className="text-xl font-semibold">{appName}</h2>
              <button
                type="button"
                data-about-version-trigger=""
                onClick={handleDebugTap}
                className="rounded px-2 py-0.5 font-mono text-xs text-muted-foreground transition-colors hover:bg-muted/60"
              >
                v{props.appVersion} · {props.appBuild}
              </button>
            </div>
          </div>

          <div className="flex flex-col">
            {props.repoUrl && (
              <a
                href={props.repoUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 py-3 transition-colors active:bg-muted/60"
              >
                <Code className="size-5 shrink-0 text-muted-foreground" />
                <span className="flex-1 text-sm">{props.repoLabel}</span>
                <ExternalLink className="size-4 shrink-0 text-muted-foreground" />
              </a>
            )}

            {extraNode !== null && (
              <>
                <Separator />
                <div className="flex flex-col">{extraNode}</div>
              </>
            )}
          </div>
        </div>

        <div className="flex-1" />

        <div className="flex flex-col gap-1 pt-4 text-center text-xs leading-relaxed text-muted-foreground">
          <p>
            <span>{props.license}</span>
            <span className="mx-1.5">&middot;</span>
            <span>{props.copyright}</span>
          </p>
        </div>
      </div>
    </div>
  )
}
