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
import {
  letterOfScore,
  letterOfGradeLevel,
  tierOfLetter,
  type GradeLetter,
  type GachaTier,
} from "@/providers/ysu/grade-letters";
import { cn } from "@/lib/utils";

/** 卡面等级:优先百分制(按学期选官方时期表),其次等级制文本,兜底按通过与否。 */
function letterOf(item: PendingGrade): GradeLetter {
  const num = item.numericScore ?? (item.score !== undefined ? Number(item.score) : NaN);
  if (Number.isFinite(num)) return letterOfScore(num, item.semester);
  return (
    letterOfGradeLevel(item.gradeLevel) ??
    letterOfGradeLevel(item.score) ??
    (item.isPass ? "C" : "F")
  );
}

const TIER_STYLE: Record<
  GachaTier,
  { ring: string; text: string; aura: string }
> = {
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
  d: { ring: "border-zinc-500/40", text: "text-zinc-400", aura: "" },
  f: {
    ring: "border-red-500/70",
    text: "text-red-400",
    aura: "bg-red-500/40",
  },
};

const SPRING = { type: "spring", stiffness: 260, damping: 26 } as const;
const FLIP_SPRING = { type: "spring", stiffness: 200, damping: 22 } as const;

/** 翻卡庆祝:A+ 彩虹撒花,A 系金色撒花,其余不撒。 */
function fireTierConfetti(tier: GachaTier, el: HTMLElement | null) {
  if (!el || (tier !== "aplus" && tier !== "a")) return;
  const rect = el.getBoundingClientRect();
  const origin = {
    x: (rect.left + rect.width / 2) / window.innerWidth,
    y: (rect.top + rect.height / 2) / window.innerHeight,
  };
  if (tier === "aplus") {
    confetti({
      particleCount: 140,
      spread: 100,
      startVelocity: 38,
      origin,
      zIndex: 80,
    });
    return;
  }
  confetti({
    particleCount: 90,
    spread: 75,
    startVelocity: 32,
    origin,
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
  const letter = letterOf(item);
  const tier = tierOfLetter(letter);
  const style = TIER_STYLE[tier];
  const scoreText = item.score || item.gradeLevel || "—";

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
      onClick={(e) => onFlip(e.currentTarget)}
      data-card-key={item.key}
    >
      {/* 光晕层:与卡面同圆角的色彩+大模糊,翻开时淡入;放在2D上下文,
          避免Android WebView上preserve-3d内的blur渲染异常 */}
      {style.aura && (
        <div
          aria-hidden
          className={cn(
            "absolute inset-0 rounded-xl blur-2xl transition-opacity duration-700",
            style.aura,
            flipped ? "opacity-100" : "opacity-0",
          )}
        />
      )}
      <motion.div
        className="relative h-52 [transform-style:preserve-3d] sm:h-56"
        animate={{ rotateY: flipped ? 180 : 0 }}
        transition={FLIP_SPRING}
      >
        {/* 卡背 */}
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-xl border border-white/15 bg-[radial-gradient(circle_at_50%_30%,oklch(0.32_0.02_260),oklch(0.18_0.02_260))] [backface-visibility:hidden]">
          <Sparkles className="size-6 text-white/40" />
          <span className="text-4xl font-bold text-white/70">?</span>
          <span className="text-xs text-white/50">{t("gacha.tapToReveal")}</span>
        </div>
        {/* 卡面:A+ 用旋转色相的彩虹描边,其余用静态色环 */}
        <div
          className={cn(
            "absolute inset-0 overflow-hidden rounded-xl bg-card [backface-visibility:hidden] [transform:rotateY(180deg)]",
            tier === "aplus" ? "p-[2px]" : cn("border-2", style.ring),
          )}
        >
          {tier === "aplus" && (
            <motion.div
              aria-hidden
              className="absolute inset-0 rounded-xl bg-[conic-gradient(from_0deg,#f87171,#fbbf24,#34d399,#60a5fa,#a78bfa,#f472b6,#f87171)]"
              animate={{ filter: ["hue-rotate(0deg)", "hue-rotate(360deg)"] }}
              transition={{ repeat: Infinity, duration: 4, ease: "linear" }}
            />
          )}
          <div className="relative flex h-full w-full flex-col items-center justify-center gap-1.5 bg-card px-3 text-center">
            <span
              className={cn(
                "flex items-center gap-0.5 text-sm font-bold tracking-[0.2em]",
                tier === "aplus"
                  ? "bg-gradient-to-r from-amber-300 via-fuchsia-400 to-sky-400 bg-clip-text text-transparent"
                  : style.text,
              )}
            >
              {tier === "aplus" && <Sparkles className="size-3.5 text-fuchsia-400" />}
              {letter}
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
    if (item) {
      setTimeout(() => fireTierConfetti(tierOfLetter(letterOf(item)), el), 400);
    }
  }

  function flipAll() {
    setFlipped(new Set(pending.map((p) => p.key)));
    // 与逐张翻转一致:A/A+ 在弹簧回正后撒花
    setTimeout(() => {
      for (const item of pending) {
        fireTierConfetti(
          tierOfLetter(letterOf(item)),
          document.querySelector<HTMLElement>(
            `[data-card-key="${CSS.escape(item.key)}"]`,
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

          {/* 安全居中:内层 m-auto 在小内容时居中、溢出时从头可滚,
              避免滚动容器 content-center 导致两端裁切且无法滚动。 */}
          <div className="flex flex-1 flex-col overflow-y-auto px-4 py-6">
            <div className="m-auto flex w-full max-w-2xl flex-wrap items-center justify-center gap-4">
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
