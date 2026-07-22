"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import confetti from "canvas-confetti";
import { Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTranslation } from "@/lib/i18n/use-translation";
import {
  useGradeGachaStore,
  type PendingGrade,
} from "@/lib/stores/grade-gacha";
import { cn } from "@/lib/utils";

type Rarity = "SSR" | "SR" | "R";

/** 稀有度按分数映射:>=90 SSR,>=80 SR,其余 R;无分数按 R。 */
function rarityOf(item: PendingGrade): Rarity {
  const s = item.numericScore;
  if (s !== undefined && Number.isFinite(s)) {
    if (s >= 90) return "SSR";
    if (s >= 80) return "SR";
  }
  return "R";
}

const RARITY_STYLE: Record<
  Rarity,
  { ring: string; text: string; glow: string }
> = {
  SSR: {
    ring: "border-amber-400/80",
    text: "text-amber-400",
    glow: "shadow-[0_0_48px_-8px_rgba(251,191,36,0.55)]",
  },
  SR: {
    ring: "border-violet-400/80",
    text: "text-violet-400",
    glow: "shadow-[0_0_36px_-8px_rgba(167,139,250,0.5)]",
  },
  R: {
    ring: "border-sky-400/70",
    text: "text-sky-400",
    glow: "shadow-[0_0_28px_-10px_rgba(56,189,248,0.45)]",
  },
};

const SPRING = { type: "spring", stiffness: 260, damping: 26 } as const;
const FLIP_SPRING = { type: "spring", stiffness: 200, damping: 22 } as const;

/** SSR 翻卡时在卡片位置撒一把金色彩带。 */
function fireSsrConfetti(el: HTMLElement | null) {
  if (!el) return;
  const rect = el.getBoundingClientRect();
  confetti({
    particleCount: 90,
    spread: 75,
    startVelocity: 32,
    origin: {
      x: (rect.left + rect.width / 2) / window.innerWidth,
      y: (rect.top + rect.height / 2) / window.innerHeight,
    },
    colors: ["#fbbf24", "#f59e0b", "#fde68a", "#ffffff"],
    zIndex: 80,
  });
}

function GachaCard({
  item,
  index,
  flipped,
  onFlip,
}: {
  item: PendingGrade;
  index: number;
  flipped: boolean;
  onFlip: (el: HTMLElement | null) => void;
}) {
  const { t } = useTranslation();
  const rarity = rarityOf(item);
  const style = RARITY_STYLE[rarity];
  const scoreText = item.score || item.gradeLevel || "—";

  return (
    <motion.button
      type="button"
      disabled={flipped}
      aria-label={flipped ? item.courseName : t("gacha.tapToReveal")}
      className="w-40 [perspective:1200px]"
      initial={{ opacity: 0, y: 28, scale: 0.9 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 16, scale: 0.94 }}
      transition={{ ...SPRING, delay: 0.1 + index * 0.08 }}
      whileHover={flipped ? undefined : { scale: 1.04 }}
      whileTap={flipped ? undefined : { scale: 0.96 }}
      onClick={(e) => onFlip(e.currentTarget)}
      data-card-key={item.key}
    >
      <motion.div
        className="relative h-56 [transform-style:preserve-3d]"
        animate={{ rotateY: flipped ? 180 : 0 }}
        transition={FLIP_SPRING}
      >
        {/* 卡背 */}
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-xl border border-white/15 bg-[radial-gradient(circle_at_50%_30%,oklch(0.32_0.02_260),oklch(0.18_0.02_260))] [backface-visibility:hidden]">
          <Sparkles className="size-6 text-white/40" />
          <span className="text-4xl font-bold text-white/70">?</span>
          <span className="text-xs text-white/50">{t("gacha.tapToReveal")}</span>
        </div>
        {/* 卡面 */}
        <div
          className={cn(
            "absolute inset-0 flex flex-col items-center justify-center gap-1.5 rounded-xl border-2 bg-card px-3 text-center [backface-visibility:hidden] [transform:rotateY(180deg)]",
            style.ring,
            style.glow,
          )}
        >
          <span
            className={cn(
              "text-[10px] font-bold tracking-[0.3em]",
              style.text,
            )}
          >
            {rarity}
          </span>
          <span className="line-clamp-2 text-sm leading-snug font-medium">
            {item.courseName}
          </span>
          <motion.span
            className="text-3xl font-bold tabular-nums"
            animate={flipped ? { scale: [1.5, 1], opacity: [0, 1] } : undefined}
            transition={{ type: "spring", stiffness: 320, damping: 18, delay: 0.25 }}
          >
            {scoreText}
          </motion.span>
          <span className="text-xs text-muted-foreground">
            {[
              item.credit ? t("gacha.credit", { credit: item.credit }) : "",
              item.semester ?? "",
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </div>
      </motion.div>
    </motion.button>
  );
}

export function GradeGachaModal({
  open,
  onClose,
  playItems,
}: {
  open: boolean;
  onClose: () => void;
  /** 玩耍模式:直接传入要抽的卡(不读 store、不动基线)。 */
  playItems?: PendingGrade[];
}) {
  const { t } = useTranslation();
  const storePending = useGradeGachaStore((s) => s.pending);
  const commitPending = useGradeGachaStore((s) => s.commitPending);
  const pending = playItems ?? storePending;
  const isPlay = playItems !== undefined;
  const [flipped, setFlipped] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    if (open) setFlipped(new Set());
  }, [open]);

  const allFlipped = pending.length > 0 && pending.every((p) => flipped.has(p.key));

  function flip(key: string, el: HTMLElement | null) {
    setFlipped((prev) => new Set(prev).add(key));
    const item = pending.find((p) => p.key === key);
    // 弹簧回正(约 0.4s)后再撒花,正对卡面
    if (item && rarityOf(item) === "SSR") {
      setTimeout(() => fireSsrConfetti(el), 400);
    }
  }

  function flipAll() {
    setFlipped(new Set(pending.map((p) => p.key)));
    // 与逐张翻转一致:SSR 在弹簧回正后撒花
    setTimeout(() => {
      for (const item of pending) {
        if (rarityOf(item) !== "SSR") continue;
        fireSsrConfetti(
          document.querySelector<HTMLElement>(
            `[data-card-key="${CSS.escape(item.key)}" ]`,
          ),
        );
      }
    }, 400);
  }

  /** 真实模式任意关闭路径都视为收下;玩耍模式不动基线。 */
  function close() {
    if (!isPlay) commitPending();
    onClose();
  }

  return (
    <AnimatePresence>
      {open && pending.length > 0 && (
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-label={t("gacha.title")}
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
              variant="ghost"
              size="icon"
              onClick={close}
              aria-label={t("gacha.skip")}
            >
              <X className="size-5" />
            </Button>
          </motion.header>

          <div className="flex flex-1 flex-wrap content-center items-center justify-center gap-4 overflow-y-auto px-4 py-6">
            {pending.map((item, i) => (
              <GachaCard
                key={item.key}
                item={item}
                index={i}
                flipped={flipped.has(item.key)}
                onFlip={(el) => flip(item.key, el)}
              />
            ))}
          </div>

          <motion.footer
            className="flex items-center justify-center gap-3 px-4 pt-2 pb-[calc(1rem+var(--safe-area-inset-bottom,env(safe-area-inset-bottom,0px)))]"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...SPRING, delay: 0.15 }}
          >
            {allFlipped ? (
              <Button onClick={close}>{t("gacha.collect")}</Button>
            ) : (
              <>
                <Button variant="outline" onClick={flipAll}>
                  {t("gacha.revealAll")}
                </Button>
                <Button variant="ghost" onClick={close}>
                  {t("gacha.skip")}
                </Button>
              </>
            )}
          </motion.footer>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
