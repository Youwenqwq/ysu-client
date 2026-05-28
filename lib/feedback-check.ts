import { useSettingsStore } from "@/lib/settings-store";
import { checkFeedbackReply } from "@/lib/feedback";
import { getText } from "@/lib/i18n/get-text";
import { toast } from "sonner";

export async function syncFeedbackReplies(): Promise<void> {
  const state = useSettingsStore.getState();
  const { feedbackIds } = state;
  if (!feedbackIds.length) return;

  let changed = false;
  let ids = [...feedbackIds];
  let history = [...state.feedbackHistory];

  for (const id of feedbackIds) {
    const entry = history.find((h) => h.id === id);
    const result = await checkFeedbackReply(id, entry?.ts);
    if (result === null) continue;

    if ("notFound" in result) {
      const idx = history.findIndex((h) => h.id === id);
      if (idx >= 0 && !history[idx].deleted) {
        history[idx] = { ...history[idx], deleted: true };
        changed = true;
      }
      continue;
    }

    if ("replied" in result) {
      const idx = history.findIndex((h) => h.id === id);
      if (idx >= 0) {
        const wasReplied = history[idx].replied;
        history[idx] = {
          ...history[idx],
          replied: result.replied,
          replyText: result.reply || history[idx].replyText,
          repliedAt: result.repliedAt || history[idx].repliedAt,
        };

        // Toast only if this reply hasn't been notified yet
        if (result.replied && !wasReplied && !history[idx].notifiedAt) {
          history[idx] = { ...history[idx], notifiedAt: Date.now() };
          toast.success(getText("about.feedbackNewReply"), {
            duration: 8000,
          });
        }

        changed = true;
      }
    }
  }

  if (changed) {
    state.setFeedbackIds(ids);
    state.setFeedbackHistory(history);
  }
}
