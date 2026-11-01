import { getText } from "@/lib/i18n/get-text"
import { macInvoke } from "./macos"

interface ScheduledAlarm {
  id: string
  title: string
  body: string
  timeMs: number
}

/** Timetable alarms are validated here so Swift only receives final content and time. */
function parseClassAlarms(alarmsJson: string): ScheduledAlarm[] {
  const parsed: unknown = JSON.parse(alarmsJson)
  if (!Array.isArray(parsed)) throw new Error("Invalid class alarms")
  const alarms: ScheduledAlarm[] = []
  const seen = new Set<string>()
  for (const entry of parsed) {
    if (entry === null || typeof entry !== "object") throw new Error("Invalid class alarm")
    const alarm = entry as Record<string, unknown>
    const id = alarm.alarmId
    const time = alarm.alarmTime
    if (
      typeof id !== "string" ||
      id.length === 0 ||
      id.length > 256 ||
      seen.has(id) ||
      typeof time !== "number" ||
      !Number.isFinite(time) ||
      time <= 0
    ) {
      throw new Error("Invalid class alarm")
    }
    seen.add(id)
    const parts = [alarm.startTime, alarm.classroom].filter(
      (value): value is string => typeof value === "string" && value.length > 0
    )
    const remind = typeof alarm.remindMinutes === "number" && Number.isFinite(alarm.remindMinutes)
      ? Math.trunc(alarm.remindMinutes)
      : 15
    alarms.push({
      id,
      title:
        typeof alarm.courseName === "string" && alarm.courseName.trim().length > 0
          ? alarm.courseName
          : getText("settings.classAlarmCourse"),
      body:
        parts.length > 0
          ? parts.join(" · ")
          : getText("settings.classAlarmBody").replace("{minutes}", String(remind)),
      timeMs: Math.round(time),
    })
  }
  return alarms
}

/** Class reminders use UserNotifications directly; background polling stays Capacitor-only. */
export const MacNotify = {
  checkPermissions(): Promise<{ granted: boolean }> {
    return macInvoke("notify.permission", {})
  },
  requestPermissions(): Promise<{ granted: boolean }> {
    return macInvoke("notify.requestPermission", {})
  },
  async scheduleClassAlarms(options: { alarmsJson: string }): Promise<void> {
    await macInvoke("notify.scheduleClassAlarms", { alarms: parseClassAlarms(options.alarmsJson) })
  },
  async cancelClassAlarms(): Promise<void> {
    await macInvoke("notify.cancelClassAlarms", {})
  },
}
