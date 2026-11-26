import { Check, Palette } from "lucide-react"
import type {
  DerivedComponentProps,
  ObservableSource,
  PluginHostPreferenceSnapshot,
  PluginThemeContribution,
  PluginUIServiceSnapshot,
  SlotComponent,
} from "@orahako/sdk"
import {
  Badge,
  Button,
  Card,
  CardAction,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
  cn,
} from "@orahako/ui-primitives"
import type { ShellDictionary } from "../dictionary"

export interface ThemePageInject {
  readonly hooks: {
    readonly ui: ObservableSource<PluginUIServiceSnapshot>
    readonly preference: ObservableSource<PluginHostPreferenceSnapshot>
  }
  readonly getActiveTheme: () => string
  readonly setActiveTheme: (themeId: string | undefined) => void
}

export type ThemePageProps = DerivedComponentProps<
  Record<string, never>,
  ShellDictionary,
  undefined,
  undefined,
  ThemePageInject
>

const DEFAULT_PREVIEW_CSS = `
  :root {
    --background: oklch(1 0 0);
    --foreground: oklch(0.145 0 0);
    --card: oklch(1 0 0);
    --card-foreground: oklch(0.145 0 0);
    --primary: oklch(0.205 0 0);
    --primary-foreground: oklch(0.985 0 0);
    --secondary: oklch(0.97 0 0);
    --secondary-foreground: oklch(0.205 0 0);
    --muted-foreground: oklch(0.556 0 0);
    --border: oklch(0.922 0 0);
    --radius: 0.625rem;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; }
  body {
    padding: 12px;
    background: var(--background);
    color: var(--foreground);
    font-family: ui-sans-serif, system-ui, sans-serif;
    font-size: 14px;
  }
  .preview-app { display: flex; flex-direction: column; gap: 12px; height: 100%; }
  .preview-header { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .preview-badge {
    border-radius: calc(var(--radius) * 0.8);
    background: var(--secondary);
    color: var(--secondary-foreground);
    padding: 3px 8px;
    font-size: 11px;
  }
  .preview-card {
    display: flex;
    flex: 1;
    flex-direction: column;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--card);
    color: var(--card-foreground);
    padding: 12px;
  }
  .preview-description { margin-top: 4px; color: var(--muted-foreground); font-size: 11px; }
  .preview-button {
    align-self: flex-start;
    margin-top: auto;
    border: 0;
    border-radius: calc(var(--radius) * 0.8);
    background: var(--primary);
    color: var(--primary-foreground);
    padding: 7px 12px;
    font: inherit;
    font-size: 12px;
  }
`

function escapePreviewHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
}

export function buildThemePreviewDocument(
  theme: PluginThemeContribution,
  t: ThemePageProps["t"]
): string {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>${DEFAULT_PREVIEW_CSS}</style>
    <style>${theme.css}</style>
  </head>
  <body>
    <main class="preview-app">
      <div class="preview-header">
        <strong>${escapePreviewHtml(t("theme.previewAppName"))}</strong>
        <span class="preview-badge" data-slot="badge">${escapePreviewHtml(t("theme.previewBadge"))}</span>
      </div>
      <section class="preview-card" data-slot="card">
        <strong>${escapePreviewHtml(t("theme.previewCardTitle"))}</strong>
        <span class="preview-description">${escapePreviewHtml(t("theme.previewCardDescription"))}</span>
        <button class="preview-button" data-slot="button" type="button" tabindex="-1">
          ${escapePreviewHtml(t("theme.previewAction"))}
        </button>
      </section>
    </main>
  </body>
</html>`
}

function ThemePreview({
  theme,
  index,
  t,
}: {
  readonly theme: PluginThemeContribution
  readonly index: number
  readonly t: ThemePageProps["t"]
}) {
  return (
    <iframe
      data-theme-preview={index}
      className="block h-40 w-full rounded-lg border bg-background"
      title={theme.name}
      tabIndex={-1}
      sandbox=""
      srcDoc={buildThemePreviewDocument(theme, t)}
    />
  )
}

export const ThemePage: SlotComponent<ThemePageProps> = (props) => {
  const { t } = props
  const uiSnapshot = props.useUi()
  const preference = props.usePreference()
  const activeTheme = preference.activeTheme ?? props.getActiveTheme()
  const customThemes = uiSnapshot.themes.filter((theme) => theme.css.trim().length > 0)
  const selectedTheme = customThemes.find(
    (theme) => activeTheme === `${theme.pluginId}:${theme.id}` || activeTheme === theme.id
  )
  const selectedQualified = selectedTheme ? `${selectedTheme.pluginId}:${selectedTheme.id}` : ""
  const themes: readonly PluginThemeContribution[] = [
    { id: "default", pluginId: "", name: t("appearance.defaultTheme"), css: "" },
    ...customThemes,
  ]

  return (
    <div className="flex flex-col gap-6" data-page="theme">
      <div className="flex items-start gap-3">
        <div className="rounded-lg bg-primary/10 p-2 text-primary">
          <Palette className="size-5" />
        </div>
        <div>
          <h1 className="text-lg font-semibold">{t("theme.title")}</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">{t("theme.description")}</p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
        {themes.map((theme, index) => {
          const qualified = theme.pluginId ? `${theme.pluginId}:${theme.id}` : ""
          const active = qualified === selectedQualified

          return (
            <Card
              key={qualified || "default"}
              data-theme-option={qualified || "default"}
              className={cn("h-full", active && "ring-2 ring-primary")}
            >
              <CardHeader>
                <CardTitle className="min-w-0 truncate">{theme.name}</CardTitle>
                {active && (
                  <CardAction>
                    <Badge variant="secondary">{t("theme.current")}</Badge>
                  </CardAction>
                )}
              </CardHeader>
              <CardContent>
                <ThemePreview theme={theme} index={index} t={t} />
              </CardContent>
              <CardFooter>
                <Button
                  type="button"
                  variant={active ? "outline" : "default"}
                  className="w-full"
                  disabled={active}
                  data-theme-select={qualified || "default"}
                  onClick={() => props.setActiveTheme(qualified || undefined)}
                >
                  {active && <Check data-icon="inline-start" />}
                  {active ? t("theme.applied") : t("theme.apply")}
                </Button>
              </CardFooter>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
