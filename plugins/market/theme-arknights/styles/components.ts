/**
 * Component overrides expressed only through semantic slots and variants.
 * The core components stay untouched; every rule here is host-owned CSS.
 */
export const componentsCss = `
/* ------------------------------------------------------------------ *
 * Shell
 * ------------------------------------------------------------------ */

main > header {
  border-bottom: 2px solid var(--edge);
}

main > header:not(.fixed) {
  position: sticky;
  top: 0;
  z-index: 20;
  padding-top: 0.75rem;
  padding-bottom: 0.75rem;
  background-color: color-mix(in oklab, var(--background) 95%, transparent);
  backdrop-filter: blur(8px);
}

nav[aria-label="Primary"] {
  border-top: 2px solid var(--edge);
}

nav[aria-label="Primary"] a {
  font-family: var(--font-mono, ui-monospace, "SFMono-Regular", Menlo, monospace);
  font-size: 0.6rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

nav[aria-label="Primary"] a[aria-current="page"] {
  position: relative;
  color: var(--brand);
}

nav[aria-label="Primary"] a[aria-current="page"]::before {
  content: "";
  position: absolute;
  top: 0;
  left: 0.75rem;
  right: 0.75rem;
  height: 2px;
  background-color: var(--brand);
}

[data-slot="sidebar-container"][data-side="left"] {
  border-right: 2px solid var(--edge);
}

[data-slot="sidebar-container"][data-side="right"] {
  border-left: 2px solid var(--edge);
}

[data-slot="sidebar-inner"] {
  background-color: var(--sidebar);
}

[data-slot="sidebar-header"] > div {
  border-bottom: 2px solid color-mix(in oklab, var(--edge) 25%, transparent);
}

[data-slot="sidebar-group-label"] {
  font-family: var(--font-mono, ui-monospace, "SFMono-Regular", Menlo, monospace);
  font-size: 0.6rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--muted-foreground);
}

[data-slot="sidebar-menu-button"]:hover,
[data-slot="sidebar-menu-button"]:active {
  transform: none;
}

[data-slot="sidebar-menu-button"][data-active="true"] {
  background-color: var(--sidebar-accent);
  box-shadow: inset 3px 0 0 0 var(--brand);
}

[data-slot="sidebar-menu-button"] svg {
  transition: transform 0.15s ease;
}

[data-slot="sidebar-menu-button"]:hover svg {
  transform: scale(1.05);
}

[data-slot="sidebar-separator"] {
  background-color: color-mix(in oklab, var(--edge) 20%, transparent);
}

[data-slot="sidebar-footer"] button {
  font-family: var(--font-mono, ui-monospace, "SFMono-Regular", Menlo, monospace);
  font-size: 0.65rem;
  letter-spacing: 0.03em;
}

/* ------------------------------------------------------------------ *
 * Card
 * ------------------------------------------------------------------ */

[data-slot="card"] {
  position: relative;
  border: 2px solid var(--edge);
  background-color: var(--card);
  box-shadow: 2px 2px 0 0 var(--shadow-color);
}

[data-slot="card"]::before,
[data-slot="card"]::after {
  content: "";
  position: absolute;
  z-index: 10;
  width: 0.45rem;
  height: 0.45rem;
  pointer-events: none;
  border: 2px solid color-mix(in oklab, var(--brand) 70%, transparent);
}

[data-slot="card"]::before {
  top: 2px;
  left: 2px;
  border-right: 0;
  border-bottom: 0;
}

[data-slot="card"]::after {
  right: 2px;
  bottom: 2px;
  border-top: 0;
  border-left: 0;
}

[data-slot="card-title"] {
  font-weight: 600;
  letter-spacing: -0.01em;
}

[data-slot="card-description"] {
  font-family: var(--font-mono, ui-monospace, "SFMono-Regular", Menlo, monospace);
  font-size: 0.7rem;
  letter-spacing: 0.03em;
}

[data-slot="card-header"][class~="border-b"] {
  border-color: color-mix(in oklab, var(--edge) 25%, transparent);
}

[data-slot="card-footer"] {
  border-top: 2px solid color-mix(in oklab, var(--edge) 60%, transparent);
  background-color: color-mix(in oklab, var(--muted) 40%, transparent);
}

[data-slot="card"] img:first-child {
  border-top-left-radius: 0;
  border-top-right-radius: 0;
}

[data-slot="card"][class*="hover:bg-muted"]:hover {
  background-color: color-mix(in oklab, var(--muted) 40%, transparent);
}

[data-slot="card"][class*="bg-amber-500"] {
  border-color: color-mix(in oklab, var(--hazard) 60%, transparent);
  background-color: color-mix(in oklab, var(--hazard) 10%, var(--card));
}

/* ------------------------------------------------------------------ *
 * Button
 * ------------------------------------------------------------------ */

[data-slot="button"] {
  border-width: 2px;
  border-style: solid;
  border-color: var(--edge);
  box-shadow: 2px 2px 0 0 var(--shadow-color);
  transition:
    transform 0.12s ease,
    box-shadow 0.12s ease,
    background-color 0.12s ease,
    color 0.12s ease;
}

[data-slot="button"]:not([data-variant="ghost"]):not([data-variant="link"]):hover {
  box-shadow: 3px 3px 0 0 var(--shadow-color);
}

[data-slot="button"]:not([aria-haspopup]):active {
  transform: translate(2px, 2px);
  box-shadow: none;
}

[data-slot="button"][data-variant="outline"] {
  background-color: var(--background);
  color: var(--foreground);
}

[data-slot="button"][data-variant="ghost"],
[data-slot="button"][data-variant="link"] {
  border-color: transparent;
  box-shadow: none;
}

[data-slot="button"][data-variant="ghost"]:hover {
  border-color: color-mix(in oklab, var(--edge) 40%, transparent);
}

[data-slot="button"][data-variant="destructive"] {
  background-color: var(--destructive);
  color: oklch(1 0 0);
  border-color: var(--edge);
}

[data-slot="button"][data-variant="link"] {
  color: var(--brand);
}

[data-slot="button"][data-variant="link"]:hover {
  color: var(--brand);
  text-decoration: underline;
  text-underline-offset: 4px;
}

/* ------------------------------------------------------------------ *
 * Inputs and fields
 * ------------------------------------------------------------------ */

[data-slot="input"],
[data-slot="textarea"] {
  border: 1px solid var(--input);
  background-color: var(--background);
}

html.dark [data-slot="input"],
html.dark [data-slot="textarea"] {
  background-color: color-mix(in oklab, var(--input) 20%, transparent);
}

[data-slot="input"]:focus-visible,
[data-slot="textarea"]:focus-visible,
[data-slot="select-trigger"]:focus-visible {
  border-color: var(--edge);
  box-shadow: 2px 2px 0 0 var(--shadow-color);
}

[data-slot="input"]::placeholder,
[data-slot="textarea"]::placeholder {
  font-family: var(--font-mono, ui-monospace, "SFMono-Regular", Menlo, monospace);
  font-size: 0.8rem;
  letter-spacing: 0.03em;
}

[data-slot="select-trigger"] {
  border: 1px solid var(--input);
  background-color: var(--background);
  font-family: var(--font-mono, ui-monospace, "SFMono-Regular", Menlo, monospace);
  font-size: 0.8rem;
  letter-spacing: 0.03em;
}

html.dark [data-slot="select-trigger"] {
  background-color: color-mix(in oklab, var(--input) 20%, transparent);
}

[data-slot="input-group"] {
  border: 2px solid var(--edge);
  background-color: var(--card);
  box-shadow: 2px 2px 0 0 var(--shadow-color);
}

[data-slot="input-group"]:focus-within {
  border-color: var(--brand);
}

[data-slot="input"][aria-invalid="true"],
[data-slot="textarea"][aria-invalid="true"],
[data-slot="select-trigger"][aria-invalid="true"],
[data-slot="input-group"]:has([aria-invalid="true"]) {
  border-color: var(--destructive);
}

[data-slot="field-legend"] {
  font-family: var(--font-mono, ui-monospace, "SFMono-Regular", Menlo, monospace);
  font-size: 0.7rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

[data-slot="field-separator-content"] {
  border: 1px solid color-mix(in oklab, var(--edge) 30%, transparent);
  background-color: var(--card);
  padding-left: 0.5rem;
  padding-right: 0.5rem;
  font-family: var(--font-mono, ui-monospace, "SFMono-Regular", Menlo, monospace);
  font-size: 0.65rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--muted-foreground);
}

[data-slot="label"] {
  border-radius: 0;
}

[data-slot="accordion-item"] {
  border-color: color-mix(in oklab, var(--edge) 20%, transparent);
}

[data-slot="accordion-trigger"] {
  border-left: 3px solid transparent;
  padding-left: 0.75rem;
}

[data-slot="accordion-trigger"]:hover {
  background-color: color-mix(in oklab, var(--muted) 40%, transparent);
  text-decoration: none;
}

[data-slot="accordion-trigger"][data-state="open"] {
  border-left-color: var(--brand);
  background-color: color-mix(in oklab, var(--muted) 30%, transparent);
}

[data-slot="drawer-content"] > div[class~="mx-auto"] {
  background-color: color-mix(in oklab, var(--edge) 40%, transparent);
}

/* ------------------------------------------------------------------ *
 * Overlays
 * ------------------------------------------------------------------ */

[data-slot="dialog-overlay"],
[data-slot="drawer-overlay"],
[data-slot="sheet-overlay"] {
  background-color: color-mix(in oklab, var(--foreground) 25%, transparent);
  backdrop-filter: blur(2px);
}

[data-slot="dialog-content"],
[data-slot="dropdown-menu-content"],
[data-slot="dropdown-menu-sub-content"],
[data-slot="select-content"] {
  border: 2px solid var(--edge);
  background-color: var(--popover);
  box-shadow: 5px 5px 0 0 var(--shadow-color);
}

[data-slot="drawer-content"],
[data-slot="sheet-content"] {
  border-width: 2px;
  border-style: solid;
  border-color: var(--edge);
  background-color: var(--popover);
  box-shadow: 5px 5px 0 0 var(--shadow-color);
}

[data-slot="dialog-title"],
[data-slot="drawer-title"],
[data-slot="sheet-title"] {
  font-weight: 600;
  letter-spacing: -0.01em;
}

[data-slot="dialog-footer"] {
  border-top: 2px solid color-mix(in oklab, var(--edge) 60%, transparent);
  background-color: color-mix(in oklab, var(--muted) 40%, transparent);
}

[data-slot="dropdown-menu-item"]:focus,
[data-slot="select-item"]:focus {
  box-shadow: inset 2px 0 0 0 var(--brand);
}

[data-slot="dropdown-menu-separator"],
[data-slot="select-separator"] {
  background-color: color-mix(in oklab, var(--edge) 40%, transparent);
}

[data-slot="select-label"] {
  font-family: var(--font-mono, ui-monospace, "SFMono-Regular", Menlo, monospace);
  font-size: 0.625rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--muted-foreground);
}

[data-slot="tooltip-content"] {
  border: 1px solid var(--edge);
  font-family: var(--font-mono, ui-monospace, "SFMono-Regular", Menlo, monospace);
  font-size: 0.7rem;
  letter-spacing: 0.03em;
}

/* ------------------------------------------------------------------ *
 * Display primitives
 * ------------------------------------------------------------------ */

[data-slot="badge"] {
  border-width: 1px;
  border-style: solid;
  border-color: var(--edge);
  font-family: var(--font-mono, ui-monospace, "SFMono-Regular", Menlo, monospace);
  font-size: 0.65rem;
  letter-spacing: 0.04em;
}

[data-slot="badge"][data-variant="secondary"] {
  border-color: color-mix(in oklab, var(--edge) 50%, transparent);
}

[data-slot="badge"][data-variant="outline"] {
  border-color: color-mix(in oklab, var(--edge) 60%, transparent);
  background-color: transparent;
}

[data-slot="badge"][data-variant="ghost"],
[data-slot="badge"][data-variant="link"] {
  border-color: transparent;
}

[data-slot="badge"][data-variant="destructive"] {
  border-color: var(--destructive);
  background-color: color-mix(in oklab, var(--destructive) 10%, transparent);
}

[data-slot="avatar"] {
  border: 2px solid var(--edge);
}

[data-slot="avatar"]::after {
  border: 0;
}

[data-slot="avatar-fallback"] {
  font-family: var(--font-mono, ui-monospace, "SFMono-Regular", Menlo, monospace);
  font-size: 0.65rem;
  letter-spacing: 0.04em;
}

[data-slot="avatar-group-count"] {
  border: 2px solid var(--edge);
  font-family: var(--font-mono, ui-monospace, "SFMono-Regular", Menlo, monospace);
}

[data-slot="alert"] {
  border: 2px solid var(--edge);
}

[data-slot="alert"][class*="text-destructive"] {
  border-color: var(--destructive);
  background-color: color-mix(in oklab, var(--destructive) 10%, transparent);
}

[data-slot="empty"] {
  border: 2px dashed color-mix(in oklab, var(--edge) 30%, transparent);
}

[data-slot="empty-title"] {
  font-weight: 600;
}

[data-slot="empty-icon"] {
  border: 2px solid color-mix(in oklab, var(--edge) 60%, transparent);
}

[data-slot="skeleton"] {
  background-image: repeating-linear-gradient(
    to bottom,
    color-mix(in oklab, var(--foreground) 6%, transparent) 0 1px,
    transparent 1px 3px
  );
}

[data-slot="separator"] {
  background-color: color-mix(in oklab, var(--edge) 25%, transparent);
}

[data-slot="scroll-area-thumb"] {
  background-color: color-mix(in oklab, var(--edge) 40%, transparent);
}

[data-slot="scroll-area-thumb"]:hover {
  background-color: color-mix(in oklab, var(--edge) 60%, transparent);
}

[data-slot="breadcrumb-list"] {
  font-family: var(--font-mono, ui-monospace, "SFMono-Regular", Menlo, monospace);
  font-size: 0.7rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

[data-slot="breadcrumb-page"] {
  font-weight: 600;
}

[data-slot="breadcrumb-separator"] svg {
  color: color-mix(in oklab, var(--edge) 50%, transparent);
}

[data-slot="pagination-ellipsis"] {
  font-family: var(--font-mono, ui-monospace, "SFMono-Regular", Menlo, monospace);
}

/* ------------------------------------------------------------------ *
 * Table
 * ------------------------------------------------------------------ */

[data-slot="table-head"] {
  font-family: var(--font-mono, ui-monospace, "SFMono-Regular", Menlo, monospace);
  font-size: 0.7rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--muted-foreground);
}

[data-slot="table-cell"] {
  font-variant-numeric: tabular-nums;
}

[data-slot="table-row"] {
  border-color: color-mix(in oklab, var(--edge) 20%, transparent);
}

[data-slot="table-row"]:hover {
  background-color: color-mix(in oklab, var(--accent) 60%, transparent);
}

[data-slot="table-footer"] {
  border-top: 2px solid color-mix(in oklab, var(--edge) 40%, transparent);
  background-color: color-mix(in oklab, var(--muted) 40%, transparent);
}

/* ------------------------------------------------------------------ *
 * Tabs
 * ------------------------------------------------------------------ */

[data-slot="tabs-list"] {
  border: 2px solid var(--edge);
  background-color: var(--muted);
  padding: 0;
}

[data-slot="tabs-list"][data-variant="line"] {
  border: 0;
  border-bottom: 2px solid var(--edge);
  background-color: transparent;
}

[data-slot="tabs-trigger"] {
  font-family: var(--font-mono, ui-monospace, "SFMono-Regular", Menlo, monospace);
  font-size: 0.72rem;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--muted-foreground);
}

[data-slot="tabs-trigger"]::after {
  background-color: var(--brand);
}

[data-slot="tabs-trigger"][data-state="active"],
[data-slot="tabs-trigger"][data-active="true"] {
  background-color: var(--primary);
  color: var(--primary-foreground);
  box-shadow: none;
}

[data-slot="tabs-list"][data-variant="line"] [data-slot="tabs-trigger"][data-state="active"],
[data-slot="tabs-list"][data-variant="line"] [data-slot="tabs-trigger"][data-active="true"] {
  background-color: transparent;
  color: var(--foreground);
}

/* ------------------------------------------------------------------ *
 * Meters and toggles
 * ------------------------------------------------------------------ */

[data-slot="progress"] {
  height: 0.375rem;
  border: 1px solid color-mix(in oklab, var(--edge) 40%, transparent);
  background-color: var(--muted);
}

[data-slot="progress-indicator"] {
  background-color: var(--brand);
  background-image: repeating-linear-gradient(
    to right,
    transparent 0 7px,
    var(--card) 7px 9px
  );
}

[data-slot="slider-track"] {
  border: 1px solid color-mix(in oklab, var(--edge) 40%, transparent);
  background-color: var(--muted);
}

[data-slot="slider-range"] {
  background-color: var(--brand);
}

[data-slot="slider-thumb"] {
  border: 2px solid var(--edge);
  background-color: var(--card);
  box-shadow: 2px 2px 0 0 var(--shadow-color);
}

[data-slot="switch"] {
  border: 2px solid color-mix(in oklab, var(--edge) 60%, transparent);
}

[data-slot="switch"][data-state="checked"] {
  border-color: var(--edge);
  background-color: var(--brand);
}

[data-slot="switch-thumb"] {
  box-shadow: 0 0 0 1px var(--edge);
}

[data-slot="checkbox"],
[data-slot="radio-group-item"] {
  border: 2px solid color-mix(in oklab, var(--edge) 70%, transparent);
  background-color: var(--card);
}

[data-slot="checkbox"][data-state="checked"],
[data-slot="radio-group-item"][data-state="checked"] {
  border-color: var(--edge);
  background-color: var(--brand);
  color: var(--brand-foreground);
}

[data-slot="radio-group-item"] span {
  background-color: var(--brand-foreground);
}

[data-slot="toggle"] {
  border: 2px solid transparent;
}

[data-slot="toggle"][data-state="on"],
[data-slot="toggle"][aria-pressed="true"] {
  border-color: var(--edge);
  background-color: var(--brand);
  color: var(--brand-foreground);
}

[data-slot="toggle-group"][data-spacing="0"] {
  border: 2px solid var(--edge);
  background-color: var(--card);
  box-shadow: 2px 2px 0 0 var(--shadow-color);
}

/* ------------------------------------------------------------------ *
 * Toasts (sonner owns its own stylesheet, so these need !important)
 * ------------------------------------------------------------------ */

[data-sonner-toaster] {
  --border-radius: 0px !important;
  --normal-border: var(--edge) !important;
}

[data-sonner-toast] {
  border-width: 2px !important;
  border-color: var(--edge) !important;
  border-radius: 0 !important;
  background-color: var(--popover) !important;
  color: var(--popover-foreground) !important;
  box-shadow: 3px 3px 0 0 var(--shadow-color) !important;
  font-family: var(--font-mono, ui-monospace, "SFMono-Regular", Menlo, monospace);
  font-size: 0.8rem;
}

[data-sonner-toaster] [data-icon] {
  color: var(--brand);
}

[data-sonner-toaster] [data-type="error"] [data-icon] {
  color: var(--destructive);
}

/* ------------------------------------------------------------------ *
 * Schedule palette rails
 * ------------------------------------------------------------------ */

button.bg-schedule-1 { border-left: 3px solid var(--schedule-ink-1); }
button.bg-schedule-2 { border-left: 3px solid var(--schedule-ink-2); }
button.bg-schedule-3 { border-left: 3px solid var(--schedule-ink-3); }
button.bg-schedule-4 { border-left: 3px solid var(--schedule-ink-4); }
button.bg-schedule-5 { border-left: 3px solid var(--schedule-ink-5); }
button.bg-schedule-6 { border-left: 3px solid var(--schedule-ink-6); }
button.bg-schedule-7 { border-left: 3px solid var(--schedule-ink-7); }
button.bg-schedule-8 { border-left: 3px solid var(--schedule-ink-8); }

.ring-primary {
  --tw-ring-color: var(--brand);
}
`
