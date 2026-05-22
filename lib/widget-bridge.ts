import { registerPlugin } from "@capacitor/core";
import type { Course, CurrentWeek, ClassPeriod, Exam } from "./types";

export interface WidgetBridgePlugin {
  syncSchedule(options: {
    coursesJson: string;
    currentWeekJson: string;
    syncReminderHours: number;
  }): Promise<void>;
  syncExams(options: {
    examsJson: string;
    syncReminderHours: number;
  }): Promise<void>;
  syncWidgetSettings(options: {
    syncReminderHours: number;
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
  exam_date?: string;
  exam_time?: string;
  exam_location?: string;
  seat_number?: string;
}

export async function syncScheduleToWidget(
  courses: Course[],
  currentWeek: CurrentWeek | null,
  periods: ClassPeriod[],
  syncReminderHours: number = 24,
): Promise<void> {
  try {
    const periodMap = new Map(periods.map((p) => [p.section, p]));

    const widgetCourses: WidgetCourse[] = courses.map((c) => {
      const startPeriod = periodMap.get(c.start_section);
      const endPeriod = periodMap.get(c.end_section);
      return {
        name: c.name,
        classroom: c.classroom,
        week_day: c.week_day,
        start_section: c.start_section,
        end_section: c.end_section,
        start_time: startPeriod?.start_time,
        end_time: endPeriod?.end_time,
      };
    });

    const weekInfo: WidgetWeekInfo | null = currentWeek
      ? {
          week: currentWeek.week,
          weekday: currentWeek.weekday,
          term: currentWeek.term,
          date: currentWeek.date,
        }
      : null;

    await WidgetBridge.syncSchedule({
      coursesJson: JSON.stringify(widgetCourses),
      currentWeekJson: weekInfo ? JSON.stringify(weekInfo) : "",
      syncReminderHours,
    });
  } catch {
    // Widget sync is best-effort; fail silently
  }
}

export async function syncWidgetSettingsToWidget(
  syncReminderHours: number,
): Promise<void> {
  try {
    await WidgetBridge.syncWidgetSettings({ syncReminderHours });
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
      exam_name: e.exam_name,
      exam_date: e.exam_date,
      exam_time: e.exam_time,
      exam_location: e.exam_location,
      seat_number: e.seat_number,
    }));

    await WidgetBridge.syncExams({
      examsJson: JSON.stringify(widgetExams),
      syncReminderHours,
    });
  } catch {
    // Widget sync is best-effort; fail silently
  }
}
