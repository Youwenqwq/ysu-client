import { APP_VERSION } from "@/lib/version";
import { isCapacitor } from "@/lib/platform";
import { useSettingsStore } from "@/lib/settings-store";

const FEEDBACK_ENDPOINT = "https://ysu.welain.com/api/feedback";

export async function submitFeedback(rating: number, text: string): Promise<string> {
  const res = await fetch(FEEDBACK_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      rating,
      text: text.trim(),
      version: APP_VERSION,
      platform: isCapacitor() ? "capacitor" : "web",
      ua: navigator.userAgent,
      viewport: `${window.screen.width}x${window.screen.height}`,
      screen: `${Math.round(window.screen.width * window.devicePixelRatio)}x${Math.round(window.screen.height * window.devicePixelRatio)}`,
    }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
  }

  const { id, ts } = await res.json();
  if (!id) throw new Error("Server did not return feedback id");

  const state = useSettingsStore.getState();
  const newIds = [id, ...state.feedbackIds.filter((fid) => fid !== id)];
  state.setFeedbackIds(newIds);
  const newHistory = [
    { id, rating, text: text.trim(), ts: ts ?? Date.now() },
    ...state.feedbackHistory.filter((h) => h.id !== id),
  ];
  state.setFeedbackHistory(newHistory);

  return id;
}

export type FeedbackReplyResult =
  | { ts: number; replied: boolean; reply: string; repliedAt: number }
  | { notFound: true }
  | null;

export async function checkFeedbackReply(id: string, ts?: number): Promise<FeedbackReplyResult> {
  try {
    const params = new URLSearchParams({ id });
    if (ts) params.set("ts", String(ts));
    const res = await fetch(`${FEEDBACK_ENDPOINT}?${params}`, { method: "GET" });
    if (res.status === 404) {
      return { notFound: true };
    }
    if (!res.ok) return null;
    const data = await res.json();
    return {
      ts: data.ts,
      replied: data.replied,
      reply: data.adminReply || "",
      repliedAt: data.repliedAt || 0,
    };
  } catch {
    return null;
  }
}
