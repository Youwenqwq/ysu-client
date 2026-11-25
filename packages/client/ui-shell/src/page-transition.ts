import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react"

export interface ViewTransitionLike {
  readonly finished: Promise<void>
  readonly ready?: Promise<void>
  readonly updateCallbackDone?: Promise<void>
  skipTransition(): void
}

export interface DocumentWithViewTransition {
  readonly documentElement?: {
    setAttribute(name: string, value: string): void
    removeAttribute(name: string): void
  } | null
  readonly visibilityState?: string
  readonly startViewTransition?: (callback: () => void | Promise<void>) => ViewTransitionLike
}

export interface WindowWithMatchMedia {
  matchMedia?: (query: string) => { readonly matches: boolean }
}

export interface PageTransitionSnapshot<TChrome> {
  readonly routeKey: string
  readonly chrome: TChrome
  readonly children: ReactNode
}

export type FallbackPageTransitionMode = "none" | "slide" | "enter"

const VIEW_TRANSITION_ATTR = "data-shell-view-transition"
const VIEW_TRANSITION_VALUE = "page"

/**
 * Self-contained page transition stylesheet for DefaultShell.
 *
 * - View Transitions (`:root[data-shell-view-transition="page"]`) keep the old
 *   viewport snapshot static underneath (`mix-blend-mode: normal`) and cross-fade
 *   the new snapshot on top. Because `[data-shell-page-outlet]` stays free of
 *   `opacity < 1`, `filter`, and `view-transition-name`, glass cards render their
 *   live `backdrop-filter` directly into the captured snapshot with no pop-in.
 * - Fallback CSS transitions omit `filter` completely (unlike `tw-animate-css`'s
 *   `animate-in`, which always emits `filter: blur(0)` and creates a Backdrop Root).
 *   In glass mode, the fallback animates `transform` only so cards keep live blur.
 */
export const PAGE_TRANSITION_STYLE = `
@keyframes orahako-shell-page-slide {
  from {
    transform: translate3d(0, 8px, 0);
  }
  to {
    transform: translate3d(0, 0, 0);
  }
}
@keyframes orahako-shell-page-enter {
  from {
    opacity: 0;
    transform: translate3d(0, 8px, 0);
  }
  to {
    opacity: 1;
    transform: translate3d(0, 0, 0);
  }
}
@keyframes orahako-shell-vt-fade-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}
[data-shell-page-outlet][data-shell-transition="slide"] {
  animation: orahako-shell-page-slide 240ms cubic-bezier(0.22, 1, 0.36, 1);
}
[data-shell-page-outlet][data-shell-transition="enter"] {
  animation: orahako-shell-page-enter 240ms cubic-bezier(0.22, 1, 0.36, 1);
}
:root[${VIEW_TRANSITION_ATTR}="${VIEW_TRANSITION_VALUE}"]::view-transition-group(root) {
  animation-duration: 240ms;
  animation-timing-function: cubic-bezier(0.22, 1, 0.36, 1);
}
:root[${VIEW_TRANSITION_ATTR}="${VIEW_TRANSITION_VALUE}"]::view-transition-old(root) {
  animation: none;
  mix-blend-mode: normal;
}
:root[${VIEW_TRANSITION_ATTR}="${VIEW_TRANSITION_VALUE}"]::view-transition-new(root) {
  animation: orahako-shell-vt-fade-in 240ms cubic-bezier(0.22, 1, 0.36, 1) both;
  mix-blend-mode: normal;
}
@media (prefers-reduced-motion: reduce) {
  [data-shell-page-outlet][data-shell-transition] {
    animation: none;
  }
  :root[${VIEW_TRANSITION_ATTR}="${VIEW_TRANSITION_VALUE}"]::view-transition-old(root),
  :root[${VIEW_TRANSITION_ATTR}="${VIEW_TRANSITION_VALUE}"]::view-transition-new(root) {
    animation: none;
  }
}
`.trim()

export function prefersReducedMotion(
  win: WindowWithMatchMedia | undefined = typeof window !== "undefined" ? window : undefined
): boolean {
  if (!win || typeof win.matchMedia !== "function") return false
  try {
    return Boolean(win.matchMedia("(prefers-reduced-motion: reduce)").matches)
  } catch {
    return false
  }
}

export function canUsePageViewTransition(
  doc: DocumentWithViewTransition | undefined = typeof document !== "undefined"
    ? document
    : undefined,
  win: WindowWithMatchMedia | undefined = typeof window !== "undefined" ? window : undefined
): boolean {
  if (!doc || typeof doc.startViewTransition !== "function") return false
  if (doc.visibilityState === "hidden") return false
  if (prefersReducedMotion(win)) return false
  return true
}

export function resolveFallbackPageTransitionMode({
  fullscreen,
  useViewTransition,
  hasBackground,
  isGlassCards,
}: {
  readonly fullscreen: boolean
  readonly useViewTransition: boolean
  readonly hasBackground: boolean
  readonly isGlassCards: boolean
}): FallbackPageTransitionMode {
  if (fullscreen || useViewTransition) return "none"
  return hasBackground && isGlassCards ? "slide" : "enter"
}

export interface UsePageViewTransitionResult<TChrome> {
  readonly snapshot: PageTransitionSnapshot<TChrome>
  readonly useViewTransition: boolean
}

export function usePageViewTransition<TChrome>({
  routeKey,
  chrome,
  children,
}: PageTransitionSnapshot<TChrome>): UsePageViewTransitionResult<TChrome> {
  const vtAvailable = canUsePageViewTransition()

  const [displayed, setDisplayed] = useState<PageTransitionSnapshot<TChrome>>(() => ({
    routeKey,
    chrome,
    children,
  }))

  const latestTargetRef = useRef<PageTransitionSnapshot<TChrome>>({ routeKey, chrome, children })
  const pendingResolveRef = useRef<(() => void) | null>(null)
  const pendingCommitRouteKeyRef = useRef<string | null>(null)
  const awaitingCallbackRef = useRef(false)
  const activeTransitionRef = useRef<ViewTransitionLike | null>(null)

  useLayoutEffect(() => {
    latestTargetRef.current = { routeKey, chrome, children }

    // Resolve an in-flight View Transition as soon as its committed route mounts,
    // even if a newer route has already arrived in the meantime.
    if (pendingResolveRef.current && displayed.routeKey === pendingCommitRouteKeyRef.current) {
      const resolve = pendingResolveRef.current
      pendingResolveRef.current = null
      pendingCommitRouteKeyRef.current = null
      resolve()
    }

    // Same route: keep the cached snapshot fresh for the next transition.
    if (displayed.routeKey === routeKey) {
      if (displayed.chrome !== chrome || displayed.children !== children) {
        setDisplayed({ routeKey, chrome, children })
      }
      return
    }

    // Fallback path when View Transitions API is unavailable or disabled.
    const doc: DocumentWithViewTransition | undefined =
      typeof document !== "undefined" ? document : undefined
    if (!canUsePageViewTransition(doc)) {
      const resolve = pendingResolveRef.current
      if (resolve) {
        pendingResolveRef.current = null
        pendingCommitRouteKeyRef.current = null
        resolve()
      }
      setDisplayed({ routeKey, chrome, children })
      return
    }

    // If a transition is already waiting for its update callback, the updated
    // `latestTargetRef` will be committed automatically when that callback runs.
    if (awaitingCallbackRef.current) {
      return
    }

    // If React is still committing a prior transition target, wait for it to finish.
    if (pendingResolveRef.current) {
      return
    }

    // Interrupt any currently playing animation so rapid navigation stays responsive.
    if (activeTransitionRef.current) {
      try {
        activeTransitionRef.current.skipTransition()
      } catch {
        // Ignore already-finished transitions.
      }
      activeTransitionRef.current = null
    }

    const rootEl = doc?.documentElement
    rootEl?.setAttribute(VIEW_TRANSITION_ATTR, VIEW_TRANSITION_VALUE)
    awaitingCallbackRef.current = true
    let callbackInvoked = false

    let transition: ViewTransitionLike
    try {
      transition = doc!.startViewTransition!(() => {
        callbackInvoked = true
        awaitingCallbackRef.current = false
        const target = latestTargetRef.current
        return new Promise<void>((resolve) => {
          pendingResolveRef.current = resolve
          pendingCommitRouteKeyRef.current = target.routeKey
          setDisplayed(target)
        })
      })
    } catch {
      awaitingCallbackRef.current = false
      rootEl?.removeAttribute(VIEW_TRANSITION_ATTR)
      setDisplayed(latestTargetRef.current)
      return
    }

    activeTransitionRef.current = transition

    const finishCleanup = () => {
      if (activeTransitionRef.current === transition) {
        activeTransitionRef.current = null
        rootEl?.removeAttribute(VIEW_TRANSITION_ATTR)
      }
      if (!callbackInvoked) {
        awaitingCallbackRef.current = false
        const resolve = pendingResolveRef.current
        if (resolve) {
          pendingResolveRef.current = null
          pendingCommitRouteKeyRef.current = null
          resolve()
        }
        setDisplayed(latestTargetRef.current)
      }
    }

    void transition.finished.then(finishCleanup, finishCleanup)
  }, [children, chrome, displayed.children, displayed.chrome, displayed.routeKey, routeKey])

  // Always release any pending View Transition on unmount.
  useEffect(() => {
    return () => {
      awaitingCallbackRef.current = false
      const resolve = pendingResolveRef.current
      if (resolve) {
        pendingResolveRef.current = null
        pendingCommitRouteKeyRef.current = null
        resolve()
      }
      if (activeTransitionRef.current) {
        try {
          activeTransitionRef.current.skipTransition()
        } catch {
          // Ignore already-finished transitions.
        }
        activeTransitionRef.current = null
      }
      if (typeof document !== "undefined") {
        document.documentElement?.removeAttribute(VIEW_TRANSITION_ATTR)
      }
    }
  }, [])

  // When on the same route or when View Transitions are unavailable, render live
  // props directly with zero deferral. While capturing the old state for a View
  // Transition, hold the previous route's snapshot until the update callback runs.
  const isHoldingForViewTransition = vtAvailable && displayed.routeKey !== routeKey
  const snapshot: PageTransitionSnapshot<TChrome> = isHoldingForViewTransition
    ? displayed
    : { routeKey, chrome, children }

  return {
    snapshot,
    useViewTransition: vtAvailable,
  }
}
