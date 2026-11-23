import styles from "./boot-splash.module.css"
import { flightSilhouette } from "./boot-silhouettes"

/** A lightweight Bad Apple tribute shown only while the kernel boots. */
export function BootSplash() {
  return (
    <main className={styles.splash} role="status" aria-label="正在启动应用">
      <div className={styles.content}>
        <div className={styles.stage} aria-hidden="true">
          <span className={`${styles.corner} ${styles.cornerTop}`} />
          <span className={`${styles.corner} ${styles.cornerBottom}`} />
          <svg className={styles.artwork} viewBox="0 0 480 360">
            <g fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round">
              <path className={styles.speedLine} d="M380 58h64" />
              <path className={styles.speedLine} d="M420 122h42" />
              <path className={styles.speedLine} d="M370 224h76" />
              <path className={styles.speedLine} d="M440 286h48" />
              <path className={styles.speedLine} d="M400 326h62" />
            </g>
            <g fill="currentColor">
              <path className={styles.sparkle} d="m126 205 3 7 7 3-7 3-3 7-3-7-7-3 7-3Z" />
              <path className={styles.sparkle} d="m160 249 2 5 5 2-5 2-2 5-2-5-5-2 5-2Z" />
              <path className={styles.sparkle} d="m103 163 2 5 5 2-5 2-2 5-2-5-5-2 5-2Z" />
            </g>
            <g transform="translate(0 35)">
              <g className={styles.flyer}>
                <path d={flightSilhouette} fill="currentColor" fillRule="evenodd" />
              </g>
            </g>
          </svg>
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
