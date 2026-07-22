"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { useTranslation } from "@/lib/i18n/use-translation";
import {
  useSchoolBuildings,
  useSchoolCampuses,
  useSchoolClasses,
  useSchoolClassrooms,
  useSchoolClassSchedule,
  useSchoolClassroomSchedule,
  useSchoolDepartments,
  useSchoolGradeYears,
  useSchoolMajors,
} from "@/providers/hooks";
import type { Course } from "@/providers/types";
import { ArrowLeft, CalendarOff, Search } from "lucide-react";

const ALL = "__all__";

function useErrorToast(error: { message: string } | undefined) {
  const { t } = useTranslation();
  useEffect(() => {
    if (!error) return;
    toast.error(error.message || t("app.updating"));
  }, [error, t]);
}

function LoadingCards() {
  return (
    <div className="flex flex-col gap-4">
      {Array.from({ length: 3 }).map((_, i) => (
        <Skeleton key={i} className="h-24" />
      ))}
    </div>
  );
}

function EmptyState({ titleKey }: { titleKey: string }) {
  const { t } = useTranslation();
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <CalendarOff />
        </EmptyMedia>
        <EmptyTitle>{t(titleKey)}</EmptyTitle>
        <EmptyDescription>{t("schoolSchedule.description")}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

/** 课程列表按星期几分组展示（与个人课表同构的 Course）。 */
function CourseScheduleView({
  title,
  subtitle,
  courses,
  isLoading,
  onBack,
}: {
  title: string;
  subtitle?: string;
  courses: Course[];
  isLoading: boolean;
  onBack: () => void;
}) {
  const { t } = useTranslation();

  const byWeekDay = useMemo(() => {
    const groups = new Map<number, Course[]>();
    for (const course of courses) {
      const list = groups.get(course.weekDay) ?? [];
      list.push(course);
      groups.set(course.weekDay, list);
    }
    for (const list of groups.values()) {
      list.sort((a, b) => a.startSection - b.startSection);
    }
    return [...groups.entries()].sort((a, b) => a[0] - b[0]);
  }, [courses]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon-sm" onClick={onBack} aria-label={t("schoolSchedule.backToList")}>
          <ArrowLeft className="size-4" />
        </Button>
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-base font-semibold">{title}</span>
          {subtitle && (
            <span className="truncate text-xs text-muted-foreground">{subtitle}</span>
          )}
        </div>
      </div>

      {isLoading ? (
        <LoadingCards />
      ) : courses.length === 0 ? (
        <EmptyState titleKey="schoolSchedule.noCourses" />
      ) : (
        byWeekDay.map(([weekDay, dayCourses]) => (
          <div key={weekDay} className="flex flex-col gap-2">
            <h3 className="text-sm font-medium text-muted-foreground">
              {t(`schedule.weekdayNames.${weekDay}`)}
            </h3>
            {dayCourses.map((course, idx) => (
              <Card key={`${course.name}-${course.startSection}-${idx}`}>
                <CardHeader>
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-base">{course.name}</CardTitle>
                    <Badge variant="outline">
                      {t("schoolSchedule.sections", {
                        start: course.startSection,
                        end: course.endSection,
                      })}
                    </Badge>
                  </div>
                  <CardDescription>
                    {[course.teacher, course.weeks].filter(Boolean).join(" · ")}
                  </CardDescription>
                </CardHeader>
                {course.classroom && (
                  <CardContent className="text-sm text-muted-foreground">
                    {course.classroom}
                  </CardContent>
                )}
              </Card>
            ))}
          </div>
        ))
      )}
    </div>
  );
}

function ClassScheduleLoader({
  classId,
  className,
  onBack,
}: {
  classId: string;
  className: string;
  onBack: () => void;
}) {
  const query = useSchoolClassSchedule(classId);
  useErrorToast(query.error);
  return (
    <CourseScheduleView
      title={className}
      courses={query.data ?? []}
      isLoading={query.isLoading}
      onBack={onBack}
    />
  );
}

function RoomScheduleLoader({
  code,
  name,
  onBack,
}: {
  code: string;
  name: string;
  onBack: () => void;
}) {
  const query = useSchoolClassroomSchedule(code);
  useErrorToast(query.error);
  return (
    <CourseScheduleView
      title={name}
      courses={query.data ?? []}
      isLoading={query.isLoading}
      onBack={onBack}
    />
  );
}

function ClassSchedulePanel() {
  const { t } = useTranslation();
  const [grade, setGrade] = useState(ALL);
  const [department, setDepartment] = useState(ALL);
  const [major, setMajor] = useState(ALL);
  const [selectedClass, setSelectedClass] = useState<{
    classId: string;
    className: string;
  } | null>(null);

  const gradeYearsQuery = useSchoolGradeYears();
  const departmentsQuery = useSchoolDepartments();
  const majorsQuery = useSchoolMajors(department === ALL ? undefined : department);
  const classesQuery = useSchoolClasses({
    grade: grade === ALL ? undefined : grade,
    department: department === ALL ? undefined : department,
    major: major === ALL ? undefined : major,
  });

  const gradeYears = gradeYearsQuery.data ?? [];
  const departments = departmentsQuery.data ?? [];
  const majors = majorsQuery.data ?? [];
  const classes = classesQuery.data ?? [];

  useErrorToast(gradeYearsQuery.error ?? departmentsQuery.error ?? majorsQuery.error);
  useErrorToast(classesQuery.error);

  if (selectedClass) {
    return (
      <ClassScheduleLoader
        classId={selectedClass.classId}
        className={selectedClass.className}
        onBack={() => setSelectedClass(null)}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-3 gap-2">
        <Select
          value={grade}
          onValueChange={(v) => {
            setGrade(v);
          }}
        >
          <SelectTrigger>
            <SelectValue placeholder={t("schoolSchedule.grade")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t("schoolSchedule.all")}</SelectItem>
            {gradeYears.map((g) => (
              <SelectItem key={g.id} value={g.id}>
                {g.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={department}
          onValueChange={(v) => {
            setDepartment(v);
            setMajor(ALL);
          }}
        >
          <SelectTrigger>
            <SelectValue placeholder={t("schoolSchedule.department")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t("schoolSchedule.all")}</SelectItem>
            {departments.map((d) => (
              <SelectItem key={d.id} value={d.id}>
                {d.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={major} onValueChange={setMajor}>
          <SelectTrigger>
            <SelectValue placeholder={t("schoolSchedule.major")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t("schoolSchedule.all")}</SelectItem>
            {majors.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                {m.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {(classesQuery.isLoading || classesQuery.isValidating) && classes.length === 0 ? (
        <LoadingCards />
      ) : classes.length === 0 ? (
        <EmptyState titleKey="schoolSchedule.noClasses" />
      ) : (
        <div className="flex flex-col gap-2">
          {classes.map((cls) => (
            <button
              key={cls.classId}
              type="button"
              onClick={() =>
                setSelectedClass({ classId: cls.classId, className: cls.className })
              }
              className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2.5 text-left transition-colors active:bg-muted/60"
            >
              <div className="flex min-w-0 flex-col">
                <span className="truncate text-sm font-medium">{cls.className}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {[cls.gradeDisplay, cls.departmentDisplay, cls.majorDisplay]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </div>
              {cls.studentCount !== undefined && (
                <Badge variant="outline" className="shrink-0">
                  {t("schoolSchedule.studentCount", { count: cls.studentCount })}
                </Badge>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function RoomSchedulePanel() {
  const { t } = useTranslation();
  const [campus, setCampus] = useState(ALL);
  const [building, setBuilding] = useState(ALL);
  const [name, setName] = useState("");
  const [searchedName, setSearchedName] = useState("");
  const [selectedRoom, setSelectedRoom] = useState<{
    code: string;
    name: string;
  } | null>(null);

  const campusesQuery = useSchoolCampuses();
  const buildingsQuery = useSchoolBuildings(campus === ALL ? undefined : campus);
  const roomsQuery = useSchoolClassrooms({
    name: searchedName || undefined,
    campus: campus === ALL ? undefined : campus,
    building: building === ALL ? undefined : building,
  });

  const campuses = campusesQuery.data ?? [];
  const buildings = buildingsQuery.data ?? [];
  const rooms = roomsQuery.data ?? [];

  useErrorToast(campusesQuery.error ?? buildingsQuery.error);
  useErrorToast(roomsQuery.error);

  if (selectedRoom) {
    return (
      <RoomScheduleLoader
        code={selectedRoom.code}
        name={selectedRoom.name}
        onBack={() => setSelectedRoom(null)}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-2">
        <Select
          value={campus}
          onValueChange={(v) => {
            setCampus(v);
            setBuilding(ALL);
          }}
        >
          <SelectTrigger>
            <SelectValue placeholder={t("schoolSchedule.campus")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t("schoolSchedule.all")}</SelectItem>
            {campuses.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={building} onValueChange={setBuilding}>
          <SelectTrigger>
            <SelectValue placeholder={t("schoolSchedule.building")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t("schoolSchedule.all")}</SelectItem>
            {buildings.map((b) => (
              <SelectItem key={b.id} value={b.id}>
                {b.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex gap-2">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("schoolSchedule.roomNamePlaceholder")}
          onKeyDown={(e) => {
            if (e.key === "Enter") setSearchedName(name.trim());
          }}
        />
        <Button
          onClick={() => setSearchedName(name.trim())}
          disabled={roomsQuery.isLoading || roomsQuery.isValidating}
        >
          {roomsQuery.isValidating ? (
            <Spinner data-icon="inline-start" />
          ) : (
            <Search data-icon="inline-start" />
          )}
          {t("schoolSchedule.searchRoom")}
        </Button>
      </div>

      {(roomsQuery.isLoading || roomsQuery.isValidating) && rooms.length === 0 ? (
        <LoadingCards />
      ) : rooms.length === 0 ? (
        <EmptyState titleKey="schoolSchedule.noRooms" />
      ) : (
        <div className="flex flex-col gap-2">
          {rooms.map((room) => (
            <button
              key={room.code}
              type="button"
              onClick={() => setSelectedRoom({ code: room.code, name: room.name })}
              className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2.5 text-left transition-colors active:bg-muted/60"
            >
              <div className="flex min-w-0 flex-col">
                <span className="truncate text-sm font-medium">{room.name}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {[room.campusDisplay, room.buildingDisplay, room.typeDisplay]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </div>
              {room.classSeats !== undefined && (
                <Badge variant="outline" className="shrink-0">
                  {t("schoolSchedule.seats", { count: room.classSeats })}
                </Badge>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function SchoolSchedulePage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState("class");

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>{t("schoolSchedule.title")}</CardTitle>
          <CardDescription>{t("schoolSchedule.description")}</CardDescription>
        </CardHeader>
      </Card>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="w-full">
          <TabsTrigger value="class">{t("schoolSchedule.classTab")}</TabsTrigger>
          <TabsTrigger value="room">{t("schoolSchedule.roomTab")}</TabsTrigger>
        </TabsList>

        <TabsContent value="class" className="mt-4">
          <ClassSchedulePanel />
        </TabsContent>
        <TabsContent value="room" className="mt-4">
          <RoomSchedulePanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}
