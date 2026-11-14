"use client"

import { useEffect, useRef, useState, useSyncExternalStore } from "react"
import { usePathname } from "next/navigation"
import type { NetworkActivitySnapshot, PluginHttpActivityService } from "@orahako/plugin-sdk"
import { cn } from "@orahako/plugin-ui/components"
import { HeixiuMascot } from "./mascot"
import { useActivitySettings } from "./state"

const MAX_MASCOTS = 12
const COUNT_DEBOUNCE_MS = 200
const ENTRY_ANIMATION_MS = 520
const EXIT_ANIMATION_MS = 220
const BOB_PHASE_COUNT = 7

const EMPTY_SNAPSHOT: NetworkActivitySnapshot = {
  active: [],
  history: [],
  session: null,
  revision: 0,
}

function getServerSnapshot(): NetworkActivitySnapshot {
  return EMPTY_SNAPSHOT
}

function sizeClass(index: number): string {
  if (index === 0) return "hx-large h-[1.2rem] w-[1.2rem]"
  if (index === 1) return "hx-medium h-[0.825rem] w-[0.825rem]"
  return "hx-small h-[0.6rem] w-[0.6rem]"
}

function useMascotCount(target: number): { count: number; exitingFrom: number | null } {
  const clamped = Math.min(target, MAX_MASCOTS)
  const [debounced, setDebounced] = useState(0)
  const [count, setCount] = useState(0)
  const [exitingFrom, setExitingFrom] = useState<number | null>(null)
  const enteredAt = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const id = setTimeout(() => setDebounced(clamped), COUNT_DEBOUNCE_MS)
    return () => clearTimeout(id)
  }, [clamped])

  useEffect(() => {
    if (clamped <= count) return
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
    }
    setExitingFrom(null)
  }, [clamped, count])

  useEffect(() => {
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
    }
    if (debounced === count) {
      setExitingFrom(null)
      return
    }
    if (debounced > count) {
      setCount(debounced)
      setExitingFrom(null)
      enteredAt.current = performance.now()
      return
    }

    const wait = Math.max(0, enteredAt.current + ENTRY_ANIMATION_MS - performance.now())
    timer.current = setTimeout(() => {
      setExitingFrom(debounced)
      timer.current = setTimeout(() => {
        setCount(debounced)
        setExitingFrom(null)
        timer.current = null
      }, EXIT_ANIMATION_MS)
    }, wait)

    return () => {
      if (timer.current) {
        clearTimeout(timer.current)
        timer.current = null
      }
    }
  }, [debounced, count])

  return { count, exitingFrom }
}

/** Decorative loading companions: count follows the number of active requests. */
export function ActivityMascots({ activity }: { activity: PluginHttpActivityService }) {
  const pathname = usePathname()
  const snapshot = useSyncExternalStore(activity.subscribe, activity.getSnapshot, getServerSnapshot)
  const showMascots = useActivitySettings((state) => state.showMascots)
  const { count, exitingFrom } = useMascotCount(snapshot.active.length)
  const hidden = Math.max(0, snapshot.active.length - MAX_MASCOTS)

  if (!showMascots || !pathname.startsWith("/dashboard") || count === 0) return null

  return (
    <>
      <style>{`
        @keyframes hx-pop {
          0% { opacity: 0; transform: translateY(10px) scale(.55); }
          60% { opacity: 1; transform: translateY(-3px) scale(1.08); }
          100% { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes hx-exit {
          0% { opacity: 1; transform: translateY(0) scale(1); }
          100% { opacity: 0; transform: translateY(6px) scale(.6); }
        }
        @keyframes hx-bob {
          0%, 100% { transform: translateY(0) rotate(-2deg); }
          50% { transform: translateY(-5px) rotate(2deg); }
        }
        .hx-pop { animation: hx-pop ${ENTRY_ANIMATION_MS}ms cubic-bezier(.2,.9,.3,1.25) both; }
        .hx-exit { animation: hx-exit ${EXIT_ANIMATION_MS}ms ease-in forwards; }
        .hx-exit .hx-bob { animation-play-state: paused; }
        .hx-bob { animation: hx-bob 2.4s ease-in-out infinite; transform-origin: 50% 100%; }
        .hx-large .hx-bob { animation-duration: 2.8s; }
        .hx-medium .hx-bob { animation-duration: 2.2s; }
        .hx-small .hx-bob { animation-duration: 1.8s; }
        @media (prefers-reduced-motion: reduce) {
          .hx-pop, .hx-exit, .hx-bob { animation: none; }
        }
      `}</style>
      <div className="pointer-events-none fixed right-2 bottom-[var(--mobile-bottom-nav-height,4rem)] z-30 flex flex-row-reverse items-end gap-0.5 md:right-4 md:bottom-0">
        {Array.from({ length: count }, (_, index) => (
          <div
            key={index}
            className={cn(
              "shrink-0",
              sizeClass(index),
              exitingFrom !== null && index >= exitingFrom ? "hx-exit" : "hx-pop"
            )}
          >
            <div
              className="hx-bob h-full w-full"
              style={{ animationDelay: `${(index % BOB_PHASE_COUNT) * -0.27}s` }}
            >
              <HeixiuMascot className="h-full w-full" />
            </div>
          </div>
        ))}
        {hidden > 0 && (
          <span className="mb-0.5 shrink-0 rounded-full bg-background/70 px-1 py-0.5 text-[9px] text-muted-foreground backdrop-blur">
            +{hidden}
          </span>
        )}
      </div>
    </>
  )
}
