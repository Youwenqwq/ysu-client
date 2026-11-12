/**
 * Global canvas, geometry reset and token-backed utilities.
 * Plain CSS only: no @apply, @theme, Sass or external font loading.
 */
export const baseCss = `
/* Zero geometry is the theme contract, including arbitrary radii baked into
   utility class names. */
*,
*::before,
*::after {
  border-radius: 0 !important;
}

html {
  color-scheme: light;
}

.dark {
  color-scheme: dark;
}

body {
  background-color: var(--background);
  color: var(--foreground);
  font-family: var(--font-sans, system-ui, -apple-system, "Segoe UI", sans-serif);
}

h1,
h2,
h3 {
  letter-spacing: -0.015em;
}

/* Existing section captions already use the uppercase muted pattern; give them
   the HUD micro-label treatment without touching their markup. */
h2[class~="uppercase"][class~="text-muted-foreground"],
h3[class~="uppercase"][class~="text-muted-foreground"] {
  font-family: var(--font-mono, ui-monospace, "SFMono-Regular", Menlo, monospace);
  font-size: 0.625rem;
  line-height: 1.1;
  letter-spacing: 0.14em;
}

code,
kbd,
pre,
samp {
  font-family: var(--font-mono, ui-monospace, "SFMono-Regular", Menlo, monospace);
}

::selection {
  background-color: var(--brand);
  color: var(--brand-foreground);
}

:where(a, button, [role="button"], [role="tab"], [role="menuitem"], input, select, textarea, summary):focus-visible {
  outline: 2px solid var(--brand);
  outline-offset: 2px;
}

/* A faint engineering grid behind everything. Never over content. */
body::before {
  content: "";
  position: fixed;
  inset: 0;
  z-index: -20;
  pointer-events: none;
  background-image:
    linear-gradient(to right, var(--edge) 1px, transparent 1px),
    linear-gradient(to bottom, var(--edge) 1px, transparent 1px);
  background-size: 48px 48px;
  opacity: 0.035;
}

/* Tailwind emits shadow literals inline, so re-point the shared slot that the
   compiled box-shadow chain consumes. */
.shadow-2xs,
.shadow-xs,
.shadow-sm {
  --tw-shadow: 2px 2px 0 0 var(--shadow-color) !important;
}

.shadow-md {
  --tw-shadow: 3px 3px 0 0 var(--shadow-color) !important;
}

.shadow-lg {
  --tw-shadow: 5px 5px 0 0 var(--shadow-color) !important;
}

.shadow-xl {
  --tw-shadow: 7px 7px 0 0 var(--shadow-color) !important;
}

.shadow-2xl {
  --tw-shadow: 10px 10px 0 0 var(--shadow-color) !important;
}

/* Saturated side rails for course blocks, matching courseInkClass(). */
.border-l-schedule-ink-1 { border-left-color: var(--schedule-ink-1); }
.border-l-schedule-ink-2 { border-left-color: var(--schedule-ink-2); }
.border-l-schedule-ink-3 { border-left-color: var(--schedule-ink-3); }
.border-l-schedule-ink-4 { border-left-color: var(--schedule-ink-4); }
.border-l-schedule-ink-5 { border-left-color: var(--schedule-ink-5); }
.border-l-schedule-ink-6 { border-left-color: var(--schedule-ink-6); }
.border-l-schedule-ink-7 { border-left-color: var(--schedule-ink-7); }
.border-l-schedule-ink-8 { border-left-color: var(--schedule-ink-8); }

/* Cyan is the signal color. Text that used primary as an accent becomes brand,
   while solid primary plates (buttons) stay graphite. */
.text-primary {
  color: var(--brand);
}

.text-brand {
  color: var(--brand);
}

.text-brand-foreground {
  color: var(--brand-foreground);
}

.bg-brand {
  background-color: var(--brand);
}

/* Solid primary used as an accent (bars, dots, marker fills) becomes cyan;
   primary plates on buttons stay graphite. */
span.bg-primary,
div.bg-primary,
i.bg-primary {
  background-color: var(--brand);
  color: var(--brand-foreground);
}

.bg-primary\\/5 {
  background-color: color-mix(in oklab, var(--brand) 8%, transparent);
}

.bg-primary\\/10 {
  background-color: color-mix(in oklab, var(--brand) 12%, transparent);
}

.border-primary {
  border-color: var(--brand);
}

.border-brand {
  border-color: var(--brand);
}

.text-hazard {
  color: var(--hazard);
}

/* The two schedule exam labels are the only amber text in the app. */
.text-amber-600 {
  color: var(--hazard);
}

.bg-hazard {
  background-color: var(--hazard);
}

.border-hazard {
  border-color: var(--hazard);
}

.border-edge {
  border-color: var(--edge);
}

.text-edge {
  color: var(--edge);
}

.bg-edge {
  background-color: var(--edge);
}

.text-edge\\/50 { color: color-mix(in oklab, var(--edge) 50%, transparent); }

.bg-brand\\/5 { background-color: color-mix(in oklab, var(--brand) 5%, transparent); }
.bg-brand\\/10 { background-color: color-mix(in oklab, var(--brand) 10%, transparent); }
.bg-brand\\/15 { background-color: color-mix(in oklab, var(--brand) 15%, transparent); }
.bg-brand\\/25 { background-color: color-mix(in oklab, var(--brand) 25%, transparent); }
.bg-brand\\/50 { background-color: color-mix(in oklab, var(--brand) 50%, transparent); }
.bg-brand\\/80 { background-color: color-mix(in oklab, var(--brand) 80%, transparent); }
.bg-brand\\/90 { background-color: color-mix(in oklab, var(--brand) 90%, transparent); }

.bg-edge\\/25 { background-color: color-mix(in oklab, var(--edge) 25%, transparent); }
.bg-edge\\/30 { background-color: color-mix(in oklab, var(--edge) 30%, transparent); }
.bg-edge\\/40 { background-color: color-mix(in oklab, var(--edge) 40%, transparent); }
.bg-edge\\/60 { background-color: color-mix(in oklab, var(--edge) 60%, transparent); }

.bg-hazard\\/10 { background-color: color-mix(in oklab, var(--hazard) 10%, transparent); }
.bg-hazard\\/15 { background-color: color-mix(in oklab, var(--hazard) 15%, transparent); }
.bg-hazard\\/25 { background-color: color-mix(in oklab, var(--hazard) 25%, transparent); }

.bg-rarity-3\\/35 { background-color: color-mix(in oklab, var(--rarity-3) 35%, transparent); }
.bg-rarity-4\\/40 { background-color: color-mix(in oklab, var(--rarity-4) 40%, transparent); }
.bg-rarity-4\\/50 { background-color: color-mix(in oklab, var(--rarity-4) 50%, transparent); }
.bg-rarity-5\\/45 { background-color: color-mix(in oklab, var(--rarity-5) 45%, transparent); }

.border-edge\\/15 { border-color: color-mix(in oklab, var(--edge) 15%, transparent); }
.border-edge\\/20 { border-color: color-mix(in oklab, var(--edge) 20%, transparent); }
.border-edge\\/25 { border-color: color-mix(in oklab, var(--edge) 25%, transparent); }
.border-edge\\/30 { border-color: color-mix(in oklab, var(--edge) 30%, transparent); }
.border-edge\\/35 { border-color: color-mix(in oklab, var(--edge) 35%, transparent); }
.border-edge\\/40 { border-color: color-mix(in oklab, var(--edge) 40%, transparent); }
.border-edge\\/50 { border-color: color-mix(in oklab, var(--edge) 50%, transparent); }
.border-edge\\/60 { border-color: color-mix(in oklab, var(--edge) 60%, transparent); }
.border-edge\\/70 { border-color: color-mix(in oklab, var(--edge) 70%, transparent); }

.border-brand\\/40 { border-color: color-mix(in oklab, var(--brand) 40%, transparent); }
.border-brand\\/60 { border-color: color-mix(in oklab, var(--brand) 60%, transparent); }
.border-hazard\\/50 { border-color: color-mix(in oklab, var(--hazard) 50%, transparent); }
.border-hazard\\/60 { border-color: color-mix(in oklab, var(--hazard) 60%, transparent); }

.border-rarity-1\\/50 { border-color: color-mix(in oklab, var(--rarity-1) 50%, transparent); }
.border-rarity-3\\/80 { border-color: color-mix(in oklab, var(--rarity-3) 80%, transparent); }
.border-rarity-4\\/80 { border-color: color-mix(in oklab, var(--rarity-4) 80%, transparent); }
.border-rarity-5\\/80 { border-color: color-mix(in oklab, var(--rarity-5) 80%, transparent); }

.border-l-brand { border-left-color: var(--brand); }
.border-l-brand\\/60 { border-left-color: color-mix(in oklab, var(--brand) 60%, transparent); }
.border-l-hazard { border-left-color: var(--hazard); }
.border-l-edge\\/25 { border-left-color: color-mix(in oklab, var(--edge) 25%, transparent); }
.border-l-edge\\/30 { border-left-color: color-mix(in oklab, var(--edge) 30%, transparent); }
.border-l-edge\\/40 { border-left-color: color-mix(in oklab, var(--edge) 40%, transparent); }

.border-r-brand\\/40 { border-right-color: color-mix(in oklab, var(--brand) 40%, transparent); }
.border-r-edge\\/25 { border-right-color: color-mix(in oklab, var(--edge) 25%, transparent); }
.border-r-edge\\/30 { border-right-color: color-mix(in oklab, var(--edge) 30%, transparent); }
.border-r-edge\\/40 { border-right-color: color-mix(in oklab, var(--edge) 40%, transparent); }
.border-t-edge\\/20 { border-top-color: color-mix(in oklab, var(--edge) 20%, transparent); }

.ring-brand\\/30 { --tw-ring-color: color-mix(in oklab, var(--brand) 30%, transparent); }
.ring-brand\\/40 { --tw-ring-color: color-mix(in oklab, var(--brand) 40%, transparent); }
.ring-brand\\/60 { --tw-ring-color: color-mix(in oklab, var(--brand) 60%, transparent); }

.bg-rarity-1 { background-color: var(--rarity-1); }
.bg-rarity-2 { background-color: var(--rarity-2); }
.bg-rarity-3 { background-color: var(--rarity-3); }
.bg-rarity-4 { background-color: var(--rarity-4); }
.bg-rarity-5 { background-color: var(--rarity-5); }

.text-rarity-1 { color: var(--rarity-1); }
.text-rarity-2 { color: var(--rarity-2); }
.text-rarity-3 { color: var(--rarity-3); }
.text-rarity-4 { color: var(--rarity-4); }
.text-rarity-5 { color: var(--rarity-5); }

.border-rarity-1 { border-color: var(--rarity-1); }
.border-rarity-2 { border-color: var(--rarity-2); }
.border-rarity-3 { border-color: var(--rarity-3); }
.border-rarity-4 { border-color: var(--rarity-4); }
.border-rarity-5 { border-color: var(--rarity-5); }

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
`
