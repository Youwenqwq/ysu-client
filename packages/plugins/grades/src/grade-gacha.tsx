import { useEffect, useState, type ReactNode } from "react"
import confetti from "canvas-confetti"
import { Sparkles, X } from "lucide-react"
import { AnimatePresence, motion } from "motion/react"
import type { ProviderGradeScale } from "@orahako/academic-sdk"
import type { Translator } from "@orahako/sdk"
import { BACK_PRIORITY, Button, cn, useBackHandler } from "@orahako/ui-primitives"
import type { GradesDictionary } from "./dictionary"
import { resolveGradeLetter, tierOfLetter, type GachaTier } from "./gpa-band"
import type { PendingGrade } from "./store"

const TIER_STYLE: Readonly<Record<GachaTier, { ring: string; text: string; aura: string }>> = {
  aplus: {
    ring: "",
    text: "",
    aura: "bg-fuchsia-500/50",
  },
  a: {
    ring: "border-amber-400/80",
    text: "text-amber-400",
    aura: "bg-amber-400/50",
  },
  b: {
    ring: "border-violet-400/80",
    text: "text-violet-400",
    aura: "bg-violet-400/45",
  },
  c: {
    ring: "border-sky-400/70",
    text: "text-sky-400",
    aura: "bg-sky-400/40",
  },
  d: {
    ring: "border-zinc-500/40",
    text: "text-zinc-400",
    aura: "",
  },
  f: {
    ring: "border-red-500/70",
    text: "text-red-400",
    aura: "bg-red-500/40",
  },
}

const SPRING = { type: "spring", stiffness: 260, damping: 26 } as const
const FLIP_SPRING = { type: "spring", stiffness: 200, damping: 22 } as const

function findCardElement(key: string): HTMLElement | null {
  if (typeof document === "undefined" || typeof document.querySelector !== "function") {
    return null
  }
  const escaped =
    typeof CSS !== "undefined" && typeof CSS.escape === "function"
      ? CSS.escape(key)
      : key.replace(/["\\]/g, "\\$&")
  return document.querySelector<HTMLElement>(`[data-card-key="${escaped}"]`)
}

function fireTierConfetti(tier: GachaTier, el: HTMLElement | null): void {
  if (!el || (tier !== "aplus" && tier !== "a")) return
  if (typeof window === "undefined" || !window.innerWidth || !window.innerHeight) return
  if (typeof el.getBoundingClientRect !== "function") return

  const rect = el.getBoundingClientRect()
  const origin = {
    x: (rect.left + rect.width / 2) / window.innerWidth,
    y: (rect.top + rect.height / 2) / window.innerHeight,
  }
  if (tier === "aplus") {
    void confetti({
      particleCount: 140,
      spread: 100,
      startVelocity: 38,
      origin,
      zIndex: 80,
    })
    return
  }
  void confetti({
    particleCount: 90,
    spread: 75,
    startVelocity: 32,
    origin,
    colors: ["#fbbf24", "#f59e0b", "#fde68a", "#ffffff"],
    zIndex: 80,
  })
}

function GachaCard({
  item,
  index,
  flipped,
  gradeScale,
  t,
  onFlip,
}: {
  readonly item: PendingGrade
  readonly index: number
  readonly flipped: boolean
  readonly gradeScale?: ProviderGradeScale
  readonly t: Translator<GradesDictionary>
  readonly onFlip: (el: HTMLElement | null) => void
}): ReactNode {
  const letter = resolveGradeLetter(item, gradeScale)
  const tier = tierOfLetter(letter)
  const style = TIER_STYLE[tier]
  const scoreText = item.score || item.gradeLevel || "—"

  return (
    <motion.button
      type="button"
      disabled={flipped}
      aria-label={flipped ? item.courseName : t("gacha.tapToReveal")}
      className="relative w-36 [perspective:1200px] sm:w-40"
      initial={{ opacity: 0, y: 28, scale: 0.9 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 16, scale: 0.94 }}
      transition={{ ...SPRING, delay: 0.1 + index * 0.08 }}
      whileHover={flipped ? undefined : { scale: 1.04 }}
      whileTap={flipped ? undefined : { scale: 0.96 }}
      onClick={(event) => onFlip(event.currentTarget)}
      data-card-key={item.key}
    >
      {style.aura && (
        <div
          aria-hidden
          className={cn(
            "absolute inset-0 rounded-xl blur-2xl transition-opacity duration-700",
            style.aura,
            flipped ? "opacity-100" : "opacity-0"
          )}
        />
      )}
      <motion.div
        className="relative h-52 [transform-style:preserve-3d] sm:h-56"
        animate={{ rotateY: flipped ? 180 : 0 }}
        transition={FLIP_SPRING}
      >
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-xl border border-white/15 bg-[radial-gradient(circle_at_50%_30%,oklch(0.32_0.02_260),oklch(0.18_0.02_260))] [backface-visibility:hidden]">
          <Sparkles className="size-6 text-white/40" />
          <span className="text-4xl font-bold text-white/70">?</span>
          <span className="text-xs text-white/50">{t("gacha.tapToReveal")}</span>
        </div>
        <div
          className={cn(
            "absolute inset-0 [transform:rotateY(180deg)] overflow-hidden rounded-xl bg-card [backface-visibility:hidden]",
            tier === "aplus" ? "p-[2px]" : cn("border-2", style.ring)
          )}
        >
          {tier === "aplus" && (
            <motion.div
              aria-hidden
              className="absolute inset-0 rounded-xl bg-[conic-gradient(from_0deg,#f87171,#fbbf24,#34d399,#60a5fa,#a78bfa,#f472b6,#f87171)]"
              animate={{ filter: ["hue-rotate(0deg)", "hue-rotate(360deg)"] }}
              transition={{ repeat: Number.POSITIVE_INFINITY, duration: 4, ease: "linear" }}
            />
          )}
          <div
            className={cn(
              "relative flex h-full w-full flex-col items-center justify-center gap-1.5 bg-card px-3 text-center",
              tier === "aplus" && "rounded-[12px]"
            )}
          >
            <span
              className={cn(
                "flex items-center gap-0.5 text-sm font-bold tracking-[0.2em]",
                tier === "aplus"
                  ? "bg-gradient-to-r from-amber-300 via-fuchsia-400 to-sky-400 bg-clip-text text-transparent"
                  : style.text
              )}
            >
              {tier === "aplus" && <Sparkles className="size-3.5 text-fuchsia-400" />}
              {letter}
            </span>
            <span className="line-clamp-2 text-sm leading-snug font-medium">{item.courseName}</span>
            <motion.span
              className="text-3xl font-bold tabular-nums"
              animate={flipped ? { scale: [1.5, 1], opacity: [0, 1] } : undefined}
              transition={{
                type: "spring",
                stiffness: 320,
                damping: 18,
                delay: 0.25,
              }}
            >
              {scoreText}
            </motion.span>
            <span className="text-xs text-muted-foreground">
              {[item.credit ? t("gacha.credit", { credit: item.credit }) : "", item.semester ?? ""]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </div>
        </div>
      </motion.div>
    </motion.button>
  )
}

export interface GradeGachaModalProps {
  readonly open: boolean
  readonly pending: readonly PendingGrade[]
  readonly gradeScale?: ProviderGradeScale
  readonly isPlay?: boolean
  readonly onCommit?: () => void
  readonly onClose: () => void
  readonly t: Translator<GradesDictionary>
}

export function GradeGachaModal({
  open,
  pending,
  gradeScale,
  isPlay = false,
  onCommit,
  onClose,
  t,
}: GradeGachaModalProps): ReactNode {
  const [flipped, setFlipped] = useState<ReadonlySet<string>>(new Set())

  useEffect(() => {
    if (open) setFlipped(new Set())
  }, [open])

  const allFlipped = pending.length > 0 && pending.every((item) => flipped.has(item.key))

  function flip(key: string, el: HTMLElement | null): void {
    setFlipped((prev) => new Set(prev).add(key))
    const item = pending.find((entry) => entry.key === key)
    if (item) {
      setTimeout(
        () => fireTierConfetti(tierOfLetter(resolveGradeLetter(item, gradeScale)), el),
        400
      )
    }
  }

  function flipAll(): void {
    setFlipped(new Set(pending.map((item) => item.key)))
    setTimeout(() => {
      for (const item of pending) {
        fireTierConfetti(
          tierOfLetter(resolveGradeLetter(item, gradeScale)),
          findCardElement(item.key)
        )
      }
    }, 400)
  }

  function close(): void {
    if (!isPlay) {
      onCommit?.()
    }
    onClose()
  }

  useBackHandler(close, open && pending.length > 0, BACK_PRIORITY.foreground)

  return (
    <AnimatePresence>
      {open && pending.length > 0 && (
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-label={t("gacha.title")}
          data-grade-gacha-modal=""
          className="fixed inset-0 z-[70] flex flex-col bg-background/95 backdrop-blur-md"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.3 } }}
        >
          <motion.header
            className="flex items-center justify-between px-4 pt-[calc(0.75rem+var(--safe-area-inset-top,env(safe-area-inset-top,0px)))] pb-3"
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={SPRING}
          >
            <div className="flex flex-col">
              <h2 className="text-lg font-semibold">
                {isPlay ? t("gacha.playTitle") : t("gacha.title")}
              </h2>
              <p className="text-xs text-muted-foreground">
                {isPlay
                  ? t("gacha.playSubtitle", { count: String(pending.length) })
                  : t("gacha.subtitle", { count: String(pending.length) })}
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={close}
              aria-label={t("gacha.skip")}
            >
              <X className="size-5" />
            </Button>
          </motion.header>

          <div className="flex flex-1 flex-col overflow-y-auto px-4 py-6">
            <div className="m-auto flex w-full max-w-2xl flex-wrap items-center justify-center gap-4">
              {pending.map((item, index) => (
                <GachaCard
                  key={item.key}
                  item={item}
                  index={index}
                  flipped={flipped.has(item.key)}
                  gradeScale={gradeScale}
                  t={t}
                  onFlip={(el) => flip(item.key, el)}
                />
              ))}
            </div>
          </div>

          <motion.footer
            className="flex items-center justify-center gap-3 px-4 pt-2 pb-[calc(1rem+var(--safe-area-inset-bottom,env(safe-area-inset-bottom,0px)))]"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...SPRING, delay: 0.15 }}
          >
            {allFlipped ? (
              <Button type="button" onClick={close}>
                {t("gacha.collect")}
              </Button>
            ) : (
              <>
                <Button type="button" variant="outline" onClick={flipAll}>
                  {t("gacha.revealAll")}
                </Button>
                <Button type="button" variant="ghost" onClick={close}>
                  {t("gacha.skip")}
                </Button>
              </>
            )}
          </motion.footer>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
