import { registerPlugin } from "@capacitor/core";
import type { Course, CurrentWeek, ClassPeriod, Exam } from "@/providers/types";

export interface WidgetBridgePlugin {
  syncSchedule(options: {
    coursesJson: string;
    currentWeekJson: string;
    syncReminderHours: number;
    showNextDaySchedule: boolean;
  }): Promise<void>;
  syncExams(options: {
    examsJson: string;
    syncReminderHours: number;
  }): Promise<void>;
  syncWidgetSettings(options: {
    syncReminderHours: number;
    showNextDaySchedule: boolean;
  }): Promise<void>;
}

const WidgetBridge = registerPlugin<WidgetBridgePlugin>("WidgetBridge", {
  web: async () => {
    return {
      async syncSchedule() {
        // No-op on web
      },
      async syncExams() {
        // No-op on web
      },
      async syncWidgetSettings() {
        // No-op on web
      },
    };
  },
});

export interface WidgetCourse {
  name: string;
  classroom?: string;
  week_day: number;
  start_section: number;
  end_section: number;
  start_time?: string;
  end_time?: string;
}

export interface WidgetWeekInfo {
  week: number;
  weekday: number;
  term?: string;
  date?: string;
}

export interface WidgetExam {
  name: string;
  exam_name?: string;
  start_at?: string;
  end_at?: string;
  time_text?: string;
  exam_location?: string;
  seat_number?: string;
}


export async function syncScheduleToWidget(
  courses: Course[],
  currentWeek: CurrentWeek | null,
  periods: ClassPeriod[],
  syncReminderHours: number = 24,
  showNextDaySchedule: boolean = false,
): Promise<void> {
  try {
    const periodMap = new Map(periods.map((p) => [p.section, p]));

    const widgetCourses: WidgetCourse[] = courses.map((c) => {
      const startSection = c.startSection;
      const endSection = c.endSection;
      const startPeriod = periodMap.get(startSection);
      const endPeriod = periodMap.get(endSection);
      return {
        name: c.name,
        classroom: c.classroom,
        week_day: c.weekDay,
        start_section: startSection,
        end_section: endSection,
        start_time: startPeriod?.startTime,
        end_time: endPeriod?.endTime,
      };
    });

    const weekInfo: WidgetWeekInfo | null = currentWeek
      ? {
          week: currentWeek.week,
          weekday: currentWeek.weekday,
          term: currentWeek.semester,
          date: currentWeek.date,
        }
      : null;

    await WidgetBridge.syncSchedule({
      coursesJson: JSON.stringify(widgetCourses),
      currentWeekJson: weekInfo ? JSON.stringify(weekInfo) : "",
      syncReminderHours,
      showNextDaySchedule,
    });
  } catch {
    // Widget sync is best-effort; fail silently
  }
}

export async function syncWidgetSettingsToWidget(
  syncReminderHours: number,
  showNextDaySchedule: boolean = false,
): Promise<void> {
  try {
    await WidgetBridge.syncWidgetSettings({ syncReminderHours, showNextDaySchedule });
  } catch {
    // Widget sync is best-effort; fail silently
  }
}

export async function syncExamsToWidget(
  exams: Exam[],
  syncReminderHours: number = 24,
): Promise<void> {
  try {
    const widgetExams: WidgetExam[] = exams.map((e) => ({
      name: e.name,
      exam_name: e.examName,
      start_at: e.startAt,
      end_at: e.endAt,
      time_text: e.timeText,
      exam_location: e.examLocation,
      seat_number: e.seatNumber,
    }));

    await WidgetBridge.syncExams({
      examsJson: JSON.stringify(widgetExams),
      syncReminderHours,
    });
  } catch {
    // Widget sync is best-effort; fail silently
  }
}
