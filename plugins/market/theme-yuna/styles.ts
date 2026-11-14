import tokens from "./tokens.json"

export type YunaSkin = keyof typeof tokens.skins

const sans = '"Yuna Archivo", "Noto Sans SC", system-ui, sans-serif'
const serif = '"Iowan Old Style", "Palatino Linotype", "Noto Serif SC", "Songti SC", serif'

function palette(skin: YunaSkin, mode: "light" | "dark") {
  const source = tokens.skins[skin][mode]
  const onPrimary =
    mode === "light"
      ? "#ffffff"
      : skin === "102"
        ? "#111427"
        : skin === "arknights"
          ? "#191b1d"
          : "#3b1723"
  return `html${mode === "dark" ? ".dark" : ":not(.dark)"} {
    ${Object.entries(source)
      .map(([key, value]) => `--yuna-${key}: ${value};`)
      .join("\n")}
    --background: var(--yuna-bg);
    --foreground: var(--yuna-ink);
    --card: var(--yuna-surface);
    --card-foreground: var(--yuna-ink);
    --popover: var(--yuna-surface);
    --popover-foreground: var(--yuna-ink);
    --primary: var(--yuna-blue);
    --primary-foreground: ${onPrimary};
    --secondary: var(--yuna-surface-2);
    --secondary-foreground: var(--yuna-ink);
    --muted: var(--yuna-surface-2);
    --muted-foreground: var(--yuna-muted);
    --accent: var(--yuna-surface-2);
    --accent-foreground: var(--yuna-ink);
    --border: var(--yuna-line);
    --input: var(--yuna-muted);
    --yuna-control-border: var(--yuna-muted);
    --ring: var(--yuna-blue);
    --sidebar: var(--yuna-surface);
    --sidebar-foreground: var(--yuna-ink);
    --sidebar-primary: var(--primary);
    --sidebar-primary-foreground: var(--primary-foreground);
    --sidebar-accent: var(--yuna-surface-2);
    --sidebar-accent-foreground: var(--yuna-blue);
    --sidebar-border: var(--yuna-line);
    --sidebar-ring: var(--yuna-blue);
    --radius: ${skin === "scarlet" ? ".5rem" : "0px"};
    --font-sans: ${sans};
    --font-heading: ${skin === "scarlet" ? serif : skin === "arknights" ? '"Yuna Barlow Condensed", ' + sans : sans};
  }`
}

const components = `
html body { background-color: var(--background); color: var(--foreground); font-family: var(--font-sans); }
html :is(h1, h2, h3, [data-slot="card-title"]) { font-family: var(--font-heading); }
html [data-slot="card"] { border: 1px solid var(--border); border-radius: var(--radius); box-shadow: none; }
html :is([data-slot="card-header"], [data-slot="card-footer"]) { border-radius: 0; }
html :is([data-slot="button"], [data-slot="input"], [data-slot="select-trigger"], [data-slot="tabs-list"], [data-slot="tabs-trigger"], [data-slot="sidebar-menu-button"], [data-slot="badge"]) { border-radius: var(--radius); }
html :is([data-slot="dialog-content"], [data-slot="dropdown-menu-content"], [data-slot="popover-content"], [data-slot="select-content"]) { border-radius: var(--radius); }
html [data-slot="card-title"] { font-weight: 700; letter-spacing: -.025em; }
html [data-slot="sidebar-header"] { border-bottom: 1px solid var(--border); }
html [data-slot="sidebar-menu-button"][data-active="true"] { box-shadow: inset 3px 0 var(--primary); color: var(--primary); background: var(--secondary); }
html [data-slot="table-header"] { background: var(--secondary); }
html [data-slot="table-head"] { color: var(--primary); }
html [data-slot="table-row"]:has(td):hover { background: var(--secondary); }
html :is(button, a, input, select, textarea):focus-visible { outline: 2px solid var(--ring); outline-offset: 3px; }
html [data-slot="button"][data-variant="default"]:not(:disabled):hover { background: var(--yuna-wine); color: #fff; }
html [data-slot="input"] { background-color: var(--card); }
/* --input is also shadcn's unchecked fill. State fills must be explicit so a
   bright border token cannot make a disabled feature look enabled. */
html [data-slot="switch"] {
  --yuna-switch-size: 18px;
  --yuna-switch-travel: 18px;
  box-sizing: border-box;
  width: 44px;
  height: 26px;
  padding: 2px;
  border: 2px solid var(--yuna-control-border);
  border-radius: 999px;
  background: var(--secondary);
  color: var(--foreground);
}
html [data-slot="switch"][data-size="sm"] {
  --yuna-switch-size: 14px;
  --yuna-switch-travel: 14px;
  width: 36px;
  height: 22px;
}
html [data-slot="switch"] [data-slot="switch-thumb"] {
  width: var(--yuna-switch-size);
  height: var(--yuna-switch-size);
  border-radius: 50%;
  background: var(--foreground);
  translate: none;
  transform: translateX(0);
  box-shadow: 0 1px 2px #0003;
}
html [data-slot="switch"]:is([data-state="checked"], [data-checked]) {
  border-color: var(--primary);
  background: var(--primary);
}
html [data-slot="switch"]:is([data-state="checked"], [data-checked]) [data-slot="switch-thumb"] {
  background: var(--primary-foreground);
  transform: translateX(var(--yuna-switch-travel));
}
html [data-slot="switch"]:is([data-state="checked"], [data-checked])::before {
  content: "";
  position: absolute;
  left: 7px;
  width: 5px;
  height: 9px;
  border-right: 2px solid var(--primary-foreground);
  border-bottom: 2px solid var(--primary-foreground);
  transform: translateY(-1px) rotate(45deg);
  pointer-events: none;
}
html[dir="rtl"] [data-slot="switch"]:is([data-state="checked"], [data-checked]) [data-slot="switch-thumb"] {
  transform: translateX(calc(-1 * var(--yuna-switch-travel)));
}
html[dir="rtl"] [data-slot="switch"]::before { left: auto; right: 7px; }
html :is([data-slot="checkbox"], [data-slot="radio-group-item"]) {
  border: 2px solid var(--yuna-control-border);
  background: var(--card);
  color: var(--foreground);
}
html :is([data-slot="checkbox"], [data-slot="radio-group-item"]):is([data-state="checked"], [data-checked]) {
  border-color: var(--primary);
  background: var(--primary);
  color: var(--primary-foreground);
}
html [data-slot="button"]:is([data-variant="outline"], [data-variant="secondary"]) {
  border: 1px solid var(--yuna-control-border);
  background: var(--card);
  color: var(--foreground);
}
html [data-slot="button"]:is([data-variant="outline"], [data-variant="secondary"]):not(:disabled):hover {
  border-color: var(--primary);
  background: var(--secondary);
  color: var(--primary);
}
html [data-slot="button"][data-variant="destructive"] { border: 1px solid currentColor; }
html :is([data-slot="toggle"], [data-slot="toggle-group-item"], [data-slot="tabs-trigger"]) {
  border: 1px solid var(--yuna-control-border);
  background: var(--card);
  color: var(--foreground);
}
html :is([data-slot="toggle"], [data-slot="toggle-group-item"], [data-slot="tabs-trigger"]):is([data-state="on"], [data-state="active"], [aria-pressed="true"]) {
  border-color: var(--primary);
  background: var(--primary);
  color: var(--primary-foreground);
  box-shadow: inset 0 -2px 0 currentColor;
}
html :is([data-slot="button"], [data-slot="toggle"], [data-slot="toggle-group-item"], [data-slot="switch"]):is(:disabled, [data-disabled]) {
  opacity: .45;
  cursor: not-allowed;
}
@media (pointer: coarse) {
  html :is([data-slot="input"], [data-slot="select-trigger"], [data-slot="sidebar-menu-button"]) { min-height: 44px; }
  html [data-slot="button"][data-size="default"], html [data-slot="button"][data-size="lg"] { min-height: 44px; }
}
@media (prefers-reduced-motion: reduce) {
  html *, html *::before, html *::after { animation-duration: .01ms !important; animation-iteration-count: 1 !important; transition-duration: .01ms !important; scroll-behavior: auto !important; }
}
@media (forced-colors: active) {
  html [data-slot="sidebar-menu-button"][data-active="true"] { outline: 2px solid Highlight; outline-offset: -2px; }
  html [data-slot="switch"] { border-color: ButtonText; background: Canvas; }
  html [data-slot="switch"] [data-slot="switch-thumb"] { background: ButtonText; }
  html [data-slot="switch"]:is([data-state="checked"], [data-checked]) { border-color: Highlight; background: Highlight; }
  html [data-slot="switch"]:is([data-state="checked"], [data-checked]) [data-slot="switch-thumb"] { background: HighlightText; }
  html [data-slot="switch"]:is([data-state="checked"], [data-checked])::before { border-color: HighlightText; }
}
`

const structure: Record<YunaSkin, string> = {
  "102": `
    html body { background-image: radial-gradient(var(--yuna-line) .75px, transparent .75px); background-size: 22px 22px; }
    html [data-slot="card"] { box-shadow: 4px 4px 0 var(--secondary); }
    html [data-slot="card-title"] { color: var(--foreground); }
  `,
  arknights: `
    html body { background-image: linear-gradient(var(--yuna-ark-grid) 1px, transparent 1px), linear-gradient(90deg, var(--yuna-ark-grid) 1px, transparent 1px); background-size: 48px 48px; }
    html [data-slot="card"] { border-top: 3px solid var(--yuna-ark-cyan); }
    html [data-slot="card-title"] { letter-spacing: .02em; }
  `,
  scarlet: `
    html [data-slot="card"] { border-color: var(--yuna-scarlet-frame); box-shadow: inset 0 0 0 4px var(--card), inset 0 0 0 5px var(--yuna-scarlet-frame); }
    html [data-slot="card-header"] { padding-top: 4px; }
    html [data-slot="card-title"] { color: var(--yuna-scarlet-gold); }
    html [data-slot="sidebar-header"] { border-color: var(--yuna-scarlet-frame); }
  `,
}

export function createThemeCss(skin: YunaSkin, assetUrl: (path: string) => string | undefined) {
  const archivo = assetUrl("assets/fonts/archivo-latin.woff2")
  const barlow =
    skin === "arknights" ? assetUrl("assets/fonts/barlow-condensed-bold.ttf") : undefined
  if (!archivo || (skin === "arknights" && !barlow))
    throw new Error("YUNA theme font asset is missing")
  const fonts = `
    @font-face { font-family: "Yuna Archivo"; font-style: normal; font-weight: 500 900; font-display: swap; src: url(${JSON.stringify(archivo)}) format("woff2"); }
    ${barlow ? `@font-face { font-family: "Yuna Barlow Condensed"; font-style: normal; font-weight: 700; font-display: swap; src: url(${JSON.stringify(barlow)}) format("truetype"); }` : ""}
  `
  return [fonts, palette(skin, "light"), palette(skin, "dark"), components, structure[skin]].join(
    "\n"
  )
}
