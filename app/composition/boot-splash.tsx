import { useEffect, useRef } from "react"
import styles from "./boot-splash.module.css"
import { flightSilhouette } from "./boot-silhouettes"

const SPEED_LINES = [
  { id: "line-1", left: "79.17%", top: "16.11%", width: "13.33%", delay: "-0.2s", duration: "0.9s" },
  { id: "line-2", left: "87.5%", top: "33.89%", width: "8.75%", delay: "-0.55s", duration: "0.8s" },
  { id: "line-3", left: "77.08%", top: "62.22%", width: "15.83%", delay: "-0.75s", duration: "1.1s" },
  { id: "line-4", left: "91.67%", top: "79.44%", width: "10%", delay: "-0.35s", duration: "0.85s" },
  { id: "line-5", left: "83.33%", top: "90.56%", width: "12.92%", delay: "-0.6s", duration: "1s" },
] as const

const SPARKLES = [
  { id: "sparkle-1", left: "24.17%", top: "56.94%", width: "4.17%", delay: "-0.3s" },
  { id: "sparkle-2", left: "31.88%", top: "69.17%", width: "2.92%", delay: "-0.8s" },
  { id: "sparkle-3", left: "20%", top: "45.28%", width: "2.92%", delay: "-0.55s" },
] as const

const EXIT_FALLBACK_MS = 260

export interface BootSplashProps {
  /** Render as a fixed full-viewport overlay on top of the mounted app during reveal. */
  readonly overlay?: boolean
  /** Start the compositor-driven fade-out transition. */
  readonly exiting?: boolean
  /** Called once the exit transition finishes (or immediately under reduced motion). */
  readonly onExited?: () => void
}

/**
 * A lightweight Bad Apple tribute shown while the kernel boots.
 *
 * Every animated element lives on its own HTML composited layer (`transform` +
 * `opacity` only) rather than inside a single animated `<svg>`, allowing the
 * browser's GPU compositor thread to keep frames smooth even while the JS main
 * thread evaluates modules and bootstraps plugins.
 */
export function BootSplash({ overlay = false, exiting = false, onExited }: BootSplashProps = {}) {
  const notifiedRef = useRef(false)

  useEffect(() => {
    if (!exiting || !onExited) return
    notifiedRef.current = false
    const reduced =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    if (reduced) {
      notifiedRef.current = true
      onExited()
      return
    }
    const timer = window.setTimeout(() => {
      if (!notifiedRef.current) {
        notifiedRef.current = true
        onExited()
      }
    }, EXIT_FALLBACK_MS)
    return () => window.clearTimeout(timer)
  }, [exiting, onExited])

  const className = [
    styles.splash,
    overlay ? styles.splashOverlay : "",
    exiting ? styles.splashExiting : "",
  ]
    .filter(Boolean)
    .join(" ")

  return (
    <main
      className={className}
      role={exiting ? undefined : "status"}
      aria-label={exiting ? undefined : "正在启动应用"}
      aria-hidden={exiting || undefined}
      onTransitionEnd={(event) => {
        if (
          exiting &&
          onExited &&
          event.target === event.currentTarget &&
          event.propertyName === "opacity" &&
          !notifiedRef.current
        ) {
          notifiedRef.current = true
          onExited()
        }
      }}
    >
      <div className={styles.content}>
        <div className={styles.stage} aria-hidden="true">
          <span className={`${styles.corner} ${styles.cornerTop}`} />
          <span className={`${styles.corner} ${styles.cornerBottom}`} />
          <div className={styles.artwork}>
            {SPEED_LINES.map((line) => (
              <div
                key={line.id}
                className={styles.speedTrack}
                style={{ animationDelay: line.delay, animationDuration: line.duration }}
              >
                <span
                  className={styles.speedBar}
                  style={{ left: line.left, top: line.top, width: line.width }}
                />
              </div>
            ))}
            {SPARKLES.map((sparkle) => (
              <div
                key={sparkle.id}
                className={styles.sparkle}
                style={{
                  left: sparkle.left,
                  top: sparkle.top,
                  width: sparkle.width,
                  animationDelay: sparkle.delay,
                }}
              >
                <svg className={styles.sparkleSvg} viewBox="0 0 20 20">
                  <path d="m10 0 3 7 7 3-7 3-3 7-3-7-7-3 7-3Z" fill="currentColor" />
                </svg>
              </div>
            ))}
            <div className={styles.flyer}>
              <svg className={styles.flyerSvg} viewBox="0 0 480 360">
                <g transform="translate(0 35)">
                  <path d={flightSilhouette} fill="currentColor" fillRule="evenodd" />
                </g>
              </svg>
            </div>
          </div>
          <span className={styles.frameNumber}>∞</span>
        </div>
        <div className={styles.wordmark} aria-hidden="true">
          <strong>ORAHAKO</strong>
          <span>LAUNCHING</span>
        </div>
      </div>
    </main>
  )
}
