import { describe, expect, it } from "vitest";
import type { CurrentWeek } from "@/providers/types";
import { computeWeekDateLabels, resolveInitialScheduleWeek, resolveWidgetCurrentWeek } from "./schedule-utils";

const staleCurrentWeek: CurrentWeek = {
  week: 1,
  weekday: 1,
  date: "2026-09-07",
  weekStartDate: "2026-09-07",
  weekDates: [
    "2026-09-07",
    "2026-09-08",
    "2026-09-09",
    "2026-09-10",
    "2026-09-11",
    "2026-09-12",
    "2026-09-13",
  ],
};

describe("computeWeekDateLabels", () => {
  it("uses the term calendar start date instead of a stale current-week anchor", () => {
    expect(computeWeekDateLabels(staleCurrentWeek, 1, "2026-08-31")).toEqual([
      "8/31",
      "9/1",
      "9/2",
      "9/3",
      "9/4",
      "9/5",
      "9/6",
    ]);
    expect(computeWeekDateLabels(staleCurrentWeek, 2, "2026-08-31")).toEqual([
      "9/7",
      "9/8",
      "9/9",
      "9/10",
      "9/11",
      "9/12",
      "9/13",
    ]);
  });

  it("falls back to the current-week response without a term calendar date", () => {
    expect(computeWeekDateLabels(staleCurrentWeek, 1)).toEqual([
      "9/7",
      "9/8",
      "9/9",
      "9/10",
      "9/11",
      "9/12",
      "9/13",
    ]);
  });
});

describe("resolveInitialScheduleWeek", () => {
  it("snaps a negative holiday week to week 1 before term starts", () => {
    expect(
      resolveInitialScheduleWeek(
        { week: -1, weekday: 4, date: "2026-08-27", semester: "2026-2027-1" },
        "2026-08-31",
        new Date(2026, 7, 27, 15, 40),
      ),
    ).toBe(1);
  });

  it("keeps a valid current teaching week", () => {
    expect(
      resolveInitialScheduleWeek(
        { week: 3, weekday: 2, date: "2026-09-15", semester: "2026-2027-1" },
        "2026-08-31",
        new Date(2026, 8, 15),
      ),
    ).toBe(3);
  });
});

describe("resolveWidgetCurrentWeek", () => {
  it("normalizes a negative provider week using the term calendar", () => {
    const currentWeek: CurrentWeek = {
      week: -1,
      weekday: 4,
      date: "2026-08-27",
      semester: "2026-2027-1",
    };

    expect(resolveWidgetCurrentWeek(currentWeek, "2026-08-31", new Date(2026, 8, 14))?.week).toBe(3);
  });
});
