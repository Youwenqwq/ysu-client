export type PageOutletTransitionMode = "none" | "enter" | "glass"

const GLASS_FADE_TARGETS = `
:where([data-shell-page-outlet][data-shell-transition="glass"] .bg-card:not(.bg-card .bg-card)),
:where(
  [data-shell-page-outlet][data-shell-transition="glass"],
  [data-shell-page-outlet][data-shell-transition="glass"] :has(.bg-card):not(.bg-card):not(.bg-card *)
) > :where(:not(.bg-card):not(:has(.bg-card)))
`.trim()

/**
 * Self-contained, pure-CSS page transition stylesheet for DefaultShell.
 *
 * - Standard mode (`enter`): animates `opacity` + upward `translate3d` directly
 *   on `[data-shell-page-outlet]` with zero capture frames and zero `filter`
 *   (unlike `tw-animate-css`'s `animate-in`, which injects `filter: blur(0)`).
 * - Glass + background mode (`glass`): animates only `translate3d` on
 *   `[data-shell-page-outlet]` (no `opacity` on any ancestor of `.bg-card`, so
 *   zero Backdrop Roots block live `backdrop-filter`) while fading each
 *   top-level `.bg-card` and each non-card branch directly at zero specificity
 *   (`:where(...)`), so element-level animations like `animate-pulse` /
 *   `animate-spin` remain untouched.
 */
export const PAGE_TRANSITION_STYLE = `
@keyframes orahako-shell-page-enter {
  from {
    opacity: 0;
    transform: translate3d(0, 0.5rem, 0);
  }
  to {
    opacity: 1;
    transform: translate3d(0, 0, 0);
  }
}
@keyframes orahako-shell-page-slide {
  from {
    transform: translate3d(0, 0.5rem, 0);
  }
  to {
    transform: translate3d(0, 0, 0);
  }
}
@keyframes orahako-shell-page-fade {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}
[data-shell-page-outlet][data-shell-transition="enter"] {
  animation: orahako-shell-page-enter 500ms cubic-bezier(0.22, 1, 0.36, 1);
}
[data-shell-page-outlet][data-shell-transition="glass"] {
  animation: orahako-shell-page-slide 500ms cubic-bezier(0.22, 1, 0.36, 1);
}
${GLASS_FADE_TARGETS} {
  animation: orahako-shell-page-fade 500ms cubic-bezier(0.22, 1, 0.36, 1);
}
@media (prefers-reduced-motion: reduce) {
  [data-shell-page-outlet][data-shell-transition],
  ${GLASS_FADE_TARGETS} {
    animation: none;
  }
}
`.trim()

export function resolvePageOutletTransitionMode({
  fullscreen,
  hasBackground,
  isGlassCards,
}: {
  readonly fullscreen: boolean
  readonly hasBackground: boolean
  readonly isGlassCards: boolean
}): PageOutletTransitionMode {
  if (fullscreen) return "none"
  if (hasBackground && isGlassCards) return "glass"
  return "enter"
}
