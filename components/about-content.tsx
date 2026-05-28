"use client";

import { useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  Code,
  CircleFadingArrowUp,
  ExternalLink,
  Globe,
  RotateCcw,
  CheckCircle2,
  AlertCircle,
  Settings,
  MessageSquare,
  Star,
} from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@/components/ui/toggle-group";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useTranslation } from "@/lib/i18n/use-translation";
import { isCapacitor } from "@/lib/platform";
import { useSettingsStore } from "@/lib/settings-store";
import { useUpdateStore } from "@/lib/update-store";
import { useLongPress } from "@/hooks/use-long-press";
import {
  APP_VERSION,
  APP_BUILD,
  APP_COPYRIGHT,
  APP_LICENSE,
  APP_REPO,
  APP_WEBSITE,
  APP_OPEN_SOURCE,
  APP_PEOPLE,
} from "@/lib/version";
import { UPDATE_MIRRORS } from "@/lib/updater";

type UpdateState = "idle" | "checking" | "up-to-date" | "error";

const DEBUG_TAP_THRESHOLD = 7;
const DEBUG_TAP_WINDOW_MS = 3000;

export function AboutContent() {
  const router = useRouter();
  const { t } = useTranslation();
  const [state, setState] = useState<UpdateState>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [showMirrorDialog, setShowMirrorDialog] = useState(false);

  const updateMirror = useSettingsStore((s) => s.updateMirror);
  const setUpdateMirror = useSettingsStore((s) => s.setUpdateMirror);
  const setUpdateStatus = useUpdateStore((s) => s.setUpdateStatus);
  const setUpdateInfo = useUpdateStore((s) => s.setUpdateInfo);
  const setShowDialog = useUpdateStore((s) => s.setShowDialog);

  // Dialog-local state
  const [dialogPreset, setDialogPreset] = useState("");
  const [dialogCustomValue, setDialogCustomValue] = useState("");

  // Feedback state
  const [showFeedback, setShowFeedback] = useState(false);
  const [feedbackTab, setFeedbackTab] = useState<"submit" | "history">("submit");
  const [feedbackRating, setFeedbackRating] = useState(0);
  const [feedbackText, setFeedbackText] = useState("");
  const [feedbackState, setFeedbackState] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [refreshingHistory, setRefreshingHistory] = useState(false);
  const feedbackHistory = useSettingsStore((s) => s.feedbackHistory);

  // Hidden debug trigger
  const tapTimes = useRef<number[]>([]);
  const handleIconClick = useCallback(() => {
    const now = Date.now();
    tapTimes.current = tapTimes.current.filter((t) => now - t < DEBUG_TAP_WINDOW_MS);
    tapTimes.current.push(now);
    if (tapTimes.current.length >= DEBUG_TAP_THRESHOLD) {
      tapTimes.current = [];
      router.push("/dashboard/me/debug");
    }
  }, [router]);

  const toToggleValue = (mirror: string) =>
    mirror === "" ? "__direct__" : mirror;

  function openMirrorDialog() {
    const isPreset = UPDATE_MIRRORS.some((m) => m.value === updateMirror);
    if (isPreset) {
      setDialogPreset(toToggleValue(updateMirror));
      setDialogCustomValue("");
    } else {
      setDialogPreset("__custom__");
      setDialogCustomValue(updateMirror);
    }
    setShowMirrorDialog(true);
  }

  function confirmMirror() {
    if (dialogPreset === "__custom__") {
      setUpdateMirror(dialogCustomValue);
    } else {
      setUpdateMirror(
        dialogPreset === "__direct__" ? "" : dialogPreset,
      );
    }
    setShowMirrorDialog(false);
  }

  const handleCheck = useCallback(async () => {
    setState("checking");
    try {
      const { checkForUpdate } = await import("@/lib/updater");
      const info = await checkForUpdate(false, updateMirror);
      setUpdateStatus(info.available || info.apkUpdateAvailable);
      if (info.apkUpdateAvailable || info.available) {
        setUpdateInfo(info);
        setShowDialog(true);
        setState("idle");
      } else {
        setState("up-to-date");
      }
    } catch (err) {
      const message = (err as Error).message;
      if (message === "RATE_LIMIT") {
        setErrorMsg(t("update.errorRateLimit"));
      } else {
        setErrorMsg(t("update.errorNetwork"));
      }
      setState("error");
    }
  }, [setUpdateStatus, setUpdateInfo, setShowDialog, t, updateMirror]);

  const handleReset = useCallback(async () => {
    try {
      const { resetToBuiltin } = await import("@/lib/updater");
      await resetToBuiltin();
      setState("idle");
    } catch {
      // ignore
    }
  }, []);

  const handleFeedbackSubmit = useCallback(async () => {
    if (feedbackRating < 1) return;
    setFeedbackState("submitting");
    try {
      const { submitFeedback } = await import("@/lib/feedback");
      await submitFeedback(feedbackRating, feedbackText);
      setFeedbackState("success");
      setTimeout(() => {
        setShowFeedback(false);
        setFeedbackRating(0);
        setFeedbackText("");
        setFeedbackState("idle");
        setFeedbackTab("history");
      }, 1500);
    } catch {
      setFeedbackState("error");
    }
  }, [feedbackRating, feedbackText]);

  const canCheck = isCapacitor();

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex flex-col gap-5">
        <div className="flex flex-col items-center gap-3 pt-2 pb-1">
          <button
            type="button"
            onClick={handleIconClick}
            className="size-24 overflow-hidden rounded-3xl shadow-sm ring-1 ring-border transition-transform active:scale-95"
          >
            <img
              src="/icon.svg"
              alt="App icon"
              width={96}
              height={96}
              className="size-full dark:invert"
            />
          </button>
          <div className="flex flex-col items-center gap-1">
            <h2 className="text-xl font-semibold">{t("app.name")}</h2>
            <span className="font-mono text-xs text-muted-foreground">
              v{APP_VERSION} · {APP_BUILD}
            </span>
          </div>
        </div>

        <div className="flex flex-col">
          <a
            href={APP_REPO}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 py-3 transition-colors active:bg-muted/60"
          >
            <Code className="size-5 shrink-0 text-muted-foreground" />
            <span className="flex-1 text-sm">Youwenqwq/ysu-client</span>
            <ExternalLink className="size-4 shrink-0 text-muted-foreground" />
          </a>

          <Separator />

          <a
            href={APP_WEBSITE}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 py-3 transition-colors active:bg-muted/60"
          >
            <Globe className="size-5 shrink-0 text-muted-foreground" />
            <span className="flex-1 text-sm">{t("about.website")}</span>
            <ExternalLink className="size-4 shrink-0 text-muted-foreground" />
          </a>

          <Separator />

          {canCheck ? (
            <UpdateSection
              state={state}
              errorMsg={errorMsg}
              onCheck={handleCheck}
              onRetry={handleCheck}
              onReset={handleReset}
              onOpenMirror={openMirrorDialog}
              onLongPress={openMirrorDialog}
              t={t}
            />
          ) : (
            <button
              type="button"
              disabled
              className="flex items-center gap-3 py-3 text-muted-foreground transition-colors"
            >
              <CircleFadingArrowUp className="size-5 shrink-0" />
              <span className="flex-1 text-left text-sm">
                {t("about.checkUpdate")}
              </span>
              <span className="text-xs text-muted-foreground">
                {t("about.version")} {APP_VERSION}
              </span>
            </button>
          )}

          <Separator />

          <button
            type="button"
            onClick={() => {
              setShowFeedback(true);
              setFeedbackTab(feedbackHistory.length > 0 ? "history" : "submit");
              // Mark replies as read when user opens the dialog
              const state = useSettingsStore.getState();
              const unread = state.feedbackHistory.some(
                (h) => h.replyText && !h.notifiedAt
              );
              if (unread) {
                const updated = state.feedbackHistory.map((h) =>
                  h.replyText && !h.notifiedAt
                    ? { ...h, notifiedAt: Date.now() }
                    : h
                );
                state.setFeedbackHistory(updated);
              }
            }}
            className="flex items-center gap-3 py-3 transition-colors active:bg-muted/60"
          >
            <MessageSquare className="size-5 shrink-0 text-muted-foreground" />
            <span className="flex-1 text-left text-sm">{t("about.feedback")}</span>
            {feedbackHistory.some((h) => h.replyText && !h.notifiedAt) ? (
              <span className="inline-block size-2 rounded-full bg-destructive" />
            ) : (
              <span className="text-xs text-muted-foreground">{t("about.feedbackDesc")}</span>
            )}
          </button>

          <Separator />

          <Accordion type="single" collapsible>
            <AccordionItem value="openSource">
              <AccordionTrigger className="py-3 text-sm hover:no-underline">
                {t("about.openSource")}
              </AccordionTrigger>
              <AccordionContent>
                <ul className="flex flex-col gap-2">
                  {APP_OPEN_SOURCE.map((c) => (
                    <li key={c.name}>
                      <a
                        href={c.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
                      >
                        {c.name}
                        <ExternalLink className="size-3" />
                      </a>
                    </li>
                  ))}
                </ul>
              </AccordionContent>
            </AccordionItem>
          </Accordion>

          <Separator />

          <div className="flex flex-col gap-2 py-3">
            <h3 className="text-sm font-medium">{t("about.credits")}</h3>
            <ul className="flex flex-col gap-2">
              {APP_PEOPLE.map((c) => (
                <li key={c.name} className="text-sm">
                  {c.url ? (
                    <a
                      href={c.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium text-primary underline underline-offset-3"
                    >
                      {c.name}
                    </a>
                  ) : (
                    <span className="font-medium">{c.name}</span>
                  )}
                  {c.contribution && (
                    <span className="text-muted-foreground">: {c.contribution}</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      <div className="flex-1" />

      <div className="flex flex-col gap-1 pt-4 text-center text-xs leading-relaxed text-muted-foreground">
        <p>{t("about.disclaimerText")}</p>
        <p>
          <span>{APP_LICENSE}</span>
          <span className="mx-1.5">&middot;</span>
          <span>{APP_COPYRIGHT}</span>
        </p>
      </div>

      <Dialog open={showMirrorDialog} onOpenChange={setShowMirrorDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("update.mirrorSettings")}</DialogTitle>
            <DialogDescription>
              {t("update.mirrorSettingsDesc")}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <ToggleGroup
              type="single"
              value={dialogPreset}
              onValueChange={(v) => {
                if (!v) return;
                setDialogPreset(v);
              }}
              variant="outline"
              size="sm"
              className="flex flex-wrap"
            >
              {UPDATE_MIRRORS.map((m) => (
                <ToggleGroupItem
                  key={m.value}
                  value={toToggleValue(m.value)}
                  className="text-xs"
                >
                  {m.label}
                </ToggleGroupItem>
              ))}
              <ToggleGroupItem value="__custom__" className="text-xs">
                {t("update.mirrorCustom")}
              </ToggleGroupItem>
            </ToggleGroup>
            {dialogPreset === "__custom__" && (
              <Input
                placeholder={t("update.mirrorPlaceholder")}
                value={dialogCustomValue}
                onChange={(e) => setDialogCustomValue(e.target.value)}
                className="text-xs"
              />
            )}
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">
              {t("update.resetToFactory")}
            </span>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setShowMirrorDialog(false);
                handleReset();
              }}
            >
              <RotateCcw className="size-3.5" />
              {t("update.resetToFactory")}
            </Button>
          </div>
          <DialogFooter>
            <Button onClick={confirmMirror}>{t("update.confirm")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showFeedback} onOpenChange={setShowFeedback}>
        <DialogContent className="max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("about.feedback")}</DialogTitle>
            <DialogDescription>{t("about.feedbackDesc")}</DialogDescription>
          </DialogHeader>

          {feedbackHistory.length > 0 && (
            <div className="flex gap-1 rounded-lg border p-1">
              <button
                type="button"
                onClick={() => setFeedbackTab("submit")}
                className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  feedbackTab === "submit"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted/60"
                }`}
              >
                {t("about.feedbackSubmitTab")}
              </button>
              <button
                type="button"
                onClick={() => setFeedbackTab("history")}
                className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  feedbackTab === "history"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted/60"
                }`}
              >
                {t("about.feedbackHistoryTab")}
                {feedbackHistory.some((h) => h.replyText && !h.notifiedAt) && (
                  <span className="ml-1 inline-block size-2 rounded-full bg-destructive" />
                )}
              </button>
            </div>
          )}

          {feedbackTab === "submit" && (
            <>
              {feedbackState === "success" ? (
                <div className="flex flex-col items-center gap-3 py-6">
                  <CheckCircle2 className="size-10 text-green-500" />
                  <p className="text-sm text-muted-foreground">{t("about.feedbackSuccess")}</p>
                </div>
              ) : (
                <div className="flex flex-col gap-4">
                  <div className="flex flex-col gap-2">
                    <span className="text-sm font-medium">{t("about.feedbackRating")}</span>
                    <div className="flex gap-1">
                      {[1, 2, 3, 4, 5].map((star) => (
                        <button
                          key={star}
                          type="button"
                          onClick={() => setFeedbackRating(star)}
                          className="p-1 transition-colors"
                        >
                          <Star
                            className={`size-6 ${
                              star <= feedbackRating
                                ? "fill-yellow-400 text-yellow-400"
                                : "text-muted-foreground"
                            }`}
                          />
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="flex flex-col gap-2">
                    <span className="text-sm font-medium">{t("about.feedbackText")}</span>
                    <textarea
                      value={feedbackText}
                      onChange={(e) => setFeedbackText(e.target.value)}
                      placeholder={t("about.feedbackTextPlaceholder")}
                      rows={4}
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    />
                  </div>
                  {feedbackState === "error" && (
                    <p className="text-sm text-destructive">{t("about.feedbackError")}</p>
                  )}
                </div>
              )}
              {feedbackState !== "success" && (
                <DialogFooter className="gap-2">
                  <Button variant="outline" onClick={() => setShowFeedback(false)}>
                    {t("dialog.cancel")}
                  </Button>
                  <Button
                    onClick={handleFeedbackSubmit}
                    disabled={feedbackRating < 1 || feedbackState === "submitting"}
                  >
                    {feedbackState === "submitting"
                      ? t("about.feedbackSubmitting")
                      : t("about.feedbackSubmit")}
                  </Button>
                </DialogFooter>
              )}
            </>
          )}

          {feedbackTab === "history" && (
            <div className="flex flex-col gap-3 max-h-[50vh] overflow-y-auto">
              <button
                type="button"
                disabled={refreshingHistory}
                onClick={async () => {
                  setRefreshingHistory(true);
                  try {
                    const { syncFeedbackReplies } = await import("@/lib/feedback-check");
                    await syncFeedbackReplies();
                  } catch {
                    // ignore
                  } finally {
                    setRefreshingHistory(false);
                  }
                }}
                className="self-end text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
              >
                {refreshingHistory ? "..." : t("about.feedbackRefresh")}
              </button>
              {feedbackHistory.map((item, idx) => (
                <div
                  key={item.id}
                  className={`rounded-lg border p-3 ${item.deleted ? "opacity-60" : ""}`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono text-muted-foreground">
                        #{feedbackHistory.length - idx}
                      </span>
                      <div className="flex gap-0.5">
                        {[1, 2, 3, 4, 5].map((s) => (
                          <Star
                            key={s}
                            className={`size-3.5 ${
                              s <= item.rating
                                ? "fill-yellow-400 text-yellow-400"
                                : "text-muted-foreground"
                            }`}
                          />
                        ))}
                      </div>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {new Date(item.ts).toLocaleDateString()}
                    </span>
                  </div>
                  <p className="mt-2 text-sm">{item.text || "（无文字内容）"}</p>
                  {item.deleted && (
                    <p className="mt-2 text-xs text-destructive">{t("about.feedbackDeleted")}</p>
                  )}
                  {item.replied && item.replyText && (
                    <div className="mt-2 rounded-md bg-muted p-2">
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-medium text-muted-foreground">{t("about.feedbackDevReply")}</p>
                        {item.repliedAt && (
                          <p className="text-[10px] text-muted-foreground">{new Date(item.repliedAt).toLocaleDateString()}</p>
                        )}
                      </div>
                      <p className="mt-1 text-sm">{item.replyText}</p>
                    </div>
                  )}
                  {item.replied && !item.replyText && (
                    <p className="mt-2 text-xs text-primary">{t("about.feedbackReplied")}</p>
                  )}
                  <div className="mt-2 flex items-center justify-between">
                    <p className="text-[10px] font-mono text-muted-foreground/60">ID: {item.id}</p>
                    {item.deleted && (
                      <button
                        type="button"
                        onClick={() => {
                          const state = useSettingsStore.getState();
                          state.setFeedbackIds(state.feedbackIds.filter((fid) => fid !== item.id));
                          state.setFeedbackHistory(state.feedbackHistory.filter((h) => h.id !== item.id));
                        }}
                        className="text-xs text-destructive hover:underline"
                      >
                        {t("about.feedbackRemove")}
                      </button>
                    )}
                  </div>
                </div>
              ))}
              {feedbackHistory.length === 0 && (
                <p className="py-6 text-center text-sm text-muted-foreground">{t("about.feedbackNoHistory")}</p>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function UpdateSection({
  state,
  errorMsg,
  onCheck,
  onRetry,
  onReset,
  onOpenMirror,
  onLongPress,
  t,
}: {
  state: UpdateState;
  errorMsg: string;
  onCheck: () => void;
  onRetry: () => void;
  onReset: () => void;
  onOpenMirror: () => void;
  onLongPress: () => void;
  t: (key: string) => string;
}) {
  const longPressHandlers = useLongPress(onLongPress);

  switch (state) {
    case "idle":
      return (
        <button
          type="button"
          onClick={onCheck}
          {...longPressHandlers}
          className="flex items-center gap-3 py-3 transition-colors active:bg-muted/60"
        >
          <CircleFadingArrowUp className="size-5 shrink-0 text-muted-foreground" />
          <span className="flex-1 text-left text-sm">
            {t("about.checkUpdate")}
          </span>
          <span className="text-xs text-muted-foreground">
            {t("about.version")} {APP_VERSION}
          </span>
        </button>
      );

    case "checking":
      return (
        <div className="flex items-center gap-3 py-3">
          <Spinner className="size-5 shrink-0 text-muted-foreground" />
          <span className="flex-1 text-left text-sm text-muted-foreground">
            {t("update.checking")}
          </span>
        </div>
      );

    case "up-to-date":
      return (
        <div className="flex items-center gap-3 py-3">
          <CheckCircle2 className="size-5 shrink-0 text-muted-foreground" />
          <span className="flex-1 text-left text-sm text-muted-foreground">
            {t("update.upToDateDesc")}
          </span>
          <span className="text-xs text-muted-foreground">
            {t("about.version")} {APP_VERSION}
          </span>
        </div>
      );

    case "error":
      return (
        <div className="flex flex-col gap-2 py-3">
          <div className="flex items-center gap-3">
            <AlertCircle className="size-5 shrink-0 text-destructive" />
            <span className="flex-1 text-left text-sm text-destructive">
              {errorMsg}
            </span>
          </div>
          <div className="flex gap-2 ml-8">
            <Button size="sm" variant="outline" onClick={onRetry}>
              {t("update.retry")}
            </Button>
            <Button size="sm" variant="outline" onClick={onOpenMirror}>
              <Settings className="size-3.5" />
              {t("update.mirrorSettings")}
            </Button>
            <Button size="sm" variant="ghost" onClick={onReset}>
              {t("update.resetToFactory")}
            </Button>
          </div>
        </div>
      );
  }
}
