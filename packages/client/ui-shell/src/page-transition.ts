import { useEffect, useLayoutEffect, useRef, useState } from "react"

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

export type PageOutletTransitionMode = "none" | "slide" | "enter"

const VIEW_TRANSITION_ATTR = "data-shell-view-transition"
const VIEW_TRANSITION_VALUE = "page"

/**
 * Self-contained page transition stylesheet for DefaultShell.
 *
 * - View Transitions (`:root[data-shell-view-transition="page"]`) capture the
 *   old viewport with the page outlet hidden (`visibility: hidden`), so the old
 *   snapshot contains only the background and shell chrome (no old-page ghosting
 *   or cross-fade). When the update callback reveals the new page,
 *   `::view-transition-new(root)` fades in (`opacity: 0 -> 1`) over that clean
 *   backdrop while `[data-shell-page-outlet]` slides up (`translate3d(0, 0.5rem, 0) -> 0`).
 *   Because the outlet never sets `opacity < 1`, `filter`, or `view-transition-name`,
 *   glass cards sample the real background with live `backdrop-filter` throughout.
 * - Fallback CSS transitions omit `filter` completely (unlike `tw-animate-css`'s
 *   `animate-in`, which always emits `filter: blur(0)` and creates a Backdrop Root).
 *   In glass mode, the fallback animates `transform` only so cards keep live blur.
 */
export const PAGE_TRANSITION_STYLE = `
@keyframes orahako-shell-page-slide {
  from {
    transform: translate3d(0, 0.5rem, 0);
  }
  to {
    transform: translate3d(0, 0, 0);
  }
}
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
@keyframes orahako-shell-vt-fade-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}
[data-shell-page-outlet][data-shell-capturing] {
  visibility: hidden;
}
[data-shell-page-outlet][data-shell-transition="slide"] {
  animation: orahako-shell-page-slide 350ms cubic-bezier(0.22, 1, 0.36, 1);
}
[data-shell-page-outlet][data-shell-transition="enter"] {
  animation: orahako-shell-page-enter 350ms cubic-bezier(0.22, 1, 0.36, 1);
}
:root[${VIEW_TRANSITION_ATTR}="${VIEW_TRANSITION_VALUE}"]::view-transition-group(root) {
  animation-duration: 350ms;
  animation-timing-function: cubic-bezier(0.22, 1, 0.36, 1);
}
:root[${VIEW_TRANSITION_ATTR}="${VIEW_TRANSITION_VALUE}"]::view-transition-old(root) {
  animation: none;
  mix-blend-mode: normal;
}
:root[${VIEW_TRANSITION_ATTR}="${VIEW_TRANSITION_VALUE}"]::view-transition-new(root) {
  animation: orahako-shell-vt-fade-in 350ms cubic-bezier(0.22, 1, 0.36, 1) both;
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

export function resolvePageOutletTransitionMode({
  fullscreen,
  useViewTransition,
  hasBackground,
  isGlassCards,
}: {
  readonly fullscreen: boolean
  readonly useViewTransition: boolean
  readonly hasBackground: boolean
  readonly isGlassCards: boolean
}): PageOutletTransitionMode {
  if (fullscreen) return "none"
  if (useViewTransition || (hasBackground && isGlassCards)) return "slide"
  return "enter"
}

export interface UsePageViewTransitionResult {
  /** True during the single capture frame before View Transition reveals the new page. */
  readonly capturing: boolean
  /** Whether the browser View Transitions API is active for this render. */
  readonly useViewTransition: boolean
}

export function usePageViewTransition(routeKey: string): UsePageViewTransitionResult {
  const vtAvailable = canUsePageViewTransition()
  const [committedRouteKey, setCommittedRouteKey] = useState(routeKey)

  const latestRouteKeyRef = useRef(routeKey)
  const pendingResolveRef = useRef<(() => void) | null>(null)
  const pendingCommitRouteKeyRef = useRef<string | null>(null)
  const awaitingCallbackRef = useRef(false)
  const activeTransitionRef = useRef<ViewTransitionLike | null>(null)

  useLayoutEffect(() => {
    latestRouteKeyRef.current = routeKey

    // Resolve an in-flight View Transition as soon as its committed route reveals,
    // even if a newer route has already arrived in the meantime.
    if (pendingResolveRef.current && committedRouteKey === pendingCommitRouteKeyRef.current) {
      const resolve = pendingResolveRef.current
      pendingResolveRef.current = null
      pendingCommitRouteKeyRef.current = null
      resolve()
    }

    if (committedRouteKey === routeKey) {
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
      setCommittedRouteKey(routeKey)
      return
    }

    // If a transition is already waiting for its update callback, `latestRouteKeyRef`
    // will be revealed automatically when that callback runs.
    if (awaitingCallbackRef.current) {
      return
    }

    // If React is still committing a prior reveal, wait for it to finish.
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
        const targetRouteKey = latestRouteKeyRef.current
        return new Promise<void>((resolve) => {
          pendingResolveRef.current = resolve
          pendingCommitRouteKeyRef.current = targetRouteKey
          setCommittedRouteKey(targetRouteKey)
        })
      })
    } catch {
      awaitingCallbackRef.current = false
      rootEl?.removeAttribute(VIEW_TRANSITION_ATTR)
      setCommittedRouteKey(latestRouteKeyRef.current)
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
        setCommittedRouteKey(latestRouteKeyRef.current)
      }
    }

    void transition.finished.then(finishCleanup, finishCleanup)
  }, [committedRouteKey, routeKey])

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

  return {
    capturing: vtAvailable && committedRouteKey !== routeKey,
    useViewTransition: vtAvailable,
  }
}
