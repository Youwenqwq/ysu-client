/**
 * The six HUD primitives actually used by the redesign: no dead variants.
 */
export const hudCss = `
/* Mono micro-label: the Rhodes Island way to name a field. */
.hud-label {
  font-family: var(--font-mono, ui-monospace, "SFMono-Regular", Menlo, monospace);
  font-size: 0.625rem;
  line-height: 1.1;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--muted-foreground);
}

/* Data numerals: tabular, slightly tracked, always the mono face. */
.hud-data {
  font-family: var(--font-mono, ui-monospace, "SFMono-Regular", Menlo, monospace);
  font-variant-numeric: tabular-nums;
  font-feature-settings: "tnum" 1;
  letter-spacing: 0.02em;
}

/* Corner brackets. Drawn with borders so they never clip a shadow. */
.hud-corners {
  position: relative;
}

.hud-corners::before,
.hud-corners::after {
  content: "";
  position: absolute;
  z-index: 10;
  width: 0.45rem;
  height: 0.45rem;
  pointer-events: none;
  border: 2px solid color-mix(in oklab, var(--brand) 70%, transparent);
}

.hud-corners::before {
  top: 2px;
  left: 2px;
  border-right: 0;
  border-bottom: 0;
}

.hud-corners::after {
  right: 2px;
  bottom: 2px;
  border-top: 0;
  border-left: 0;
}

/* Hazard stripe, for alert rails only. */
.hud-hatch {
  background-image: repeating-linear-gradient(-45deg, var(--hazard) 0 4px, transparent 4px 8px);
}

.hud-scan {
  background-image: repeating-linear-gradient(
    to bottom,
    color-mix(in oklab, var(--foreground) 6%, transparent) 0 1px,
    transparent 1px 3px
  );
}

/* Segmented meter used by progress + stat bars. */
.hud-meter {
  background-image: repeating-linear-gradient(to right, transparent 0 7px, var(--card) 7px 9px);
}
`
