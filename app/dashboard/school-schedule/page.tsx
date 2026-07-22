"use client";

import { useMemo, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Field,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import {
  EmptyState,
  LoadingCards,
  useErrorToast,
} from "@/components/academic/list-state";
import {
  FilterDrawer,
  FilterTrigger,
} from "@/components/academic/filter-drawer";
import { useTranslation } from "@/lib/i18n/use-translation";
import { useMobileHeaderRight } from "@/lib/stores/mobile-header";
import { cn } from "@/lib/utils";
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
import type { Course, SchoolClassInfo, ClassroomInfo } from "@/providers/types";
import { ArrowLeft, Search } from "lucide-react";

const ALL = "__all__";

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
        <EmptyState title={t("schoolSchedule.noCourses")} />
      ) : (
        byWeekDay.map(([weekDay, dayCourses]) => (
          <div key={weekDay} className="flex flex-col gap-2">
            <h3 className="text-sm font-medium text-muted-foreground">
              {t(`dashboard.weekdayNames.${weekDay}`)}
            </h3>
            {dayCourses.map((course) => (
              <Card
                key={`${course.name}-${weekDay}-${course.startSection}-${course.endSection}-${course.classroom ?? ""}`}
              >
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

/** 班级条目行：未排课的班级置灰并标示，避免白点一次。 */
function ClassRow({
  cls,
  onSelect,
}: {
  cls: SchoolClassInfo;
  onSelect: (v: { classId: string; className: string }) => void;
}) {
  const { t } = useTranslation();
  const unscheduled = cls.isScheduled === false;
  return (
    <button
      type="button"
      onClick={() => onSelect({ classId: cls.classId, className: cls.className })}
      className={cn(
        "flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2.5 text-left transition-colors active:bg-muted/60",
        unscheduled && "opacity-60",
      )}
    >
      <div className="flex min-w-0 flex-col">
        <span className="truncate text-sm font-medium">{cls.className}</span>
        <span className="truncate text-xs text-muted-foreground">
          {[cls.gradeDisplay, cls.departmentDisplay, cls.majorDisplay]
            .filter(Boolean)
            .join(" · ")}
        </span>
      </div>
      <div className="flex shrink-0 gap-1">
        {unscheduled && (
          <Badge variant="secondary">{t("schoolSchedule.unscheduled")}</Badge>
        )}
        {cls.studentCount !== undefined && (
          <Badge variant="outline">
            {t("schoolSchedule.studentCount", { count: cls.studentCount })}
          </Badge>
        )}
      </div>
    </button>
  );
}

/** 班级查询结果（仅在选定筛选条件后挂载，避免全量请求）。 */
function ClassListResults({
  filter,
  onSelect,
}: {
  filter: { grade?: string; department?: string; major?: string };
  onSelect: (v: { classId: string; className: string }) => void;
}) {
  const { t } = useTranslation();
  const classesQuery = useSchoolClasses(filter);
  const classes = classesQuery.data ?? [];
  useErrorToast(classesQuery.error);

  if ((classesQuery.isLoading || classesQuery.isValidating) && classes.length === 0) {
    return <LoadingCards />;
  }
  if (classes.length === 0) {
    return <EmptyState title={t("schoolSchedule.noClasses")} />;
  }
  return (
    <div
      className={cn(
        "flex flex-col gap-2 transition-opacity",
        classesQuery.isValidating && "opacity-50",
      )}
    >
      {classes.map((cls) => (
        <ClassRow key={cls.classId} cls={cls} onSelect={onSelect} />
      ))}
    </div>
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
  const [filterDrawerOpen, setFilterDrawerOpen] = useState(false);

  const gradeYearsQuery = useSchoolGradeYears();
  const departmentsQuery = useSchoolDepartments();
  const majorsQuery = useSchoolMajors(department === ALL ? undefined : department);

  const gradeYears = gradeYearsQuery.data ?? [];
  const departments = departmentsQuery.data ?? [];
  const majors = majorsQuery.data ?? [];

  useErrorToast(gradeYearsQuery.error ?? departmentsQuery.error ?? majorsQuery.error);

  const hasFilter = grade !== ALL || department !== ALL || major !== ALL;
  const summary = [
    gradeYears.find((g) => g.id === grade)?.name,
    departments.find((d) => d.id === department)?.name,
    majors.find((m) => m.id === major)?.name,
  ]
    .filter(Boolean)
    .join(" · ");

  useMobileHeaderRight(
    selectedClass ? null : (
      <FilterTrigger
        label={summary || t("schoolSchedule.selectHint")}
        onClick={() => setFilterDrawerOpen(true)}
      />
    ),
    [selectedClass, summary, t],
  );

  const filterControls = (
    <FieldGroup className="flex flex-col gap-3 md:flex-row">
      <Field className="flex-1">
        <FieldLabel>{t("schoolSchedule.grade")}</FieldLabel>
        <Select value={grade} onValueChange={setGrade}>
          <SelectTrigger className="w-full">
            <SelectValue />
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
      </Field>
      <Field className="flex-1">
        <FieldLabel>{t("schoolSchedule.department")}</FieldLabel>
        <Select
          value={department}
          onValueChange={(v) => {
            setDepartment(v);
            setMajor(ALL);
          }}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
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
      </Field>
      <Field className="flex-1">
        <FieldLabel>{t("schoolSchedule.major")}</FieldLabel>
        <Select value={major} onValueChange={setMajor}>
          <SelectTrigger className="w-full">
            <SelectValue />
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
      </Field>
    </FieldGroup>
  );

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
      <div className="hidden md:block">{filterControls}</div>
      <FilterDrawer
        open={filterDrawerOpen}
        onOpenChange={setFilterDrawerOpen}
        title={t("schoolSchedule.classTab")}
      >
        {filterControls}
      </FilterDrawer>

      {!hasFilter ? (
        <EmptyState title={t("schoolSchedule.selectHint")} />
      ) : (
        <ClassListResults
          filter={{
            grade: grade === ALL ? undefined : grade,
            department: department === ALL ? undefined : department,
            major: major === ALL ? undefined : major,
          }}
          onSelect={setSelectedClass}
        />
      )}
    </div>
  );
}

/** 教室条目行：未排课的教室置灰并标示。 */
function RoomRow({
  room,
  onSelect,
}: {
  room: ClassroomInfo;
  onSelect: (v: { code: string; name: string }) => void;
}) {
  const { t } = useTranslation();
  const unscheduled = room.isScheduled === false;
  return (
    <button
      type="button"
      onClick={() => onSelect({ code: room.code, name: room.name })}
      className={cn(
        "flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2.5 text-left transition-colors active:bg-muted/60",
        unscheduled && "opacity-60",
      )}
    >
      <div className="flex min-w-0 flex-col">
        <span className="truncate text-sm font-medium">{room.name}</span>
        <span className="truncate text-xs text-muted-foreground">
          {[room.campusDisplay, room.buildingDisplay, room.typeDisplay]
            .filter(Boolean)
            .join(" · ")}
        </span>
      </div>
      <div className="flex shrink-0 gap-1">
        {unscheduled && (
          <Badge variant="secondary">{t("schoolSchedule.unscheduled")}</Badge>
        )}
        {room.classSeats !== undefined && (
          <Badge variant="outline">
            {t("schoolSchedule.seats", { count: room.classSeats })}
          </Badge>
        )}
      </div>
    </button>
  );
}

/** 教室查询结果（仅在搜索或选定筛选条件后挂载，避免全量请求）。 */
function RoomListResults({
  filter,
  onSelect,
}: {
  filter: { name?: string; campus?: string; building?: string };
  onSelect: (v: { code: string; name: string }) => void;
}) {
  const { t } = useTranslation();
  const roomsQuery = useSchoolClassrooms(filter);
  const rooms = roomsQuery.data ?? [];
  useErrorToast(roomsQuery.error);

  if ((roomsQuery.isLoading || roomsQuery.isValidating) && rooms.length === 0) {
    return <LoadingCards />;
  }
  if (rooms.length === 0) {
    return <EmptyState title={t("schoolSchedule.noRooms")} />;
  }
  return (
    <div
      className={cn(
        "flex flex-col gap-2 transition-opacity",
        roomsQuery.isValidating && "opacity-50",
      )}
    >
      {rooms.map((room) => (
        <RoomRow key={room.code} room={room} onSelect={onSelect} />
      ))}
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
  const [filterDrawerOpen, setFilterDrawerOpen] = useState(false);

  const campusesQuery = useSchoolCampuses();
  const buildingsQuery = useSchoolBuildings(campus === ALL ? undefined : campus);

  const campuses = campusesQuery.data ?? [];
  const buildings = buildingsQuery.data ?? [];

  useErrorToast(campusesQuery.error ?? buildingsQuery.error);

  const hasFilter = searchedName !== "" || campus !== ALL || building !== ALL;
  const summary = [
    campuses.find((c) => c.id === campus)?.name,
    buildings.find((b) => b.id === building)?.name,
    searchedName || null,
  ]
    .filter(Boolean)
    .join(" · ");

  useMobileHeaderRight(
    selectedRoom ? null : (
      <FilterTrigger
        label={summary || t("schoolSchedule.selectHint")}
        onClick={() => setFilterDrawerOpen(true)}
      />
    ),
    [selectedRoom, summary, t],
  );

  function handleSearch() {
    setSearchedName(name.trim());
    setFilterDrawerOpen(false);
  }

  const filterControls = (
    <FieldGroup className="flex flex-col gap-3">
      <div className="flex flex-col gap-3 md:flex-row">
        <Field className="flex-1">
          <FieldLabel>{t("schoolSchedule.campus")}</FieldLabel>
          <Select
            value={campus}
            onValueChange={(v) => {
              setCampus(v);
              setBuilding(ALL);
            }}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
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
        </Field>
        <Field className="flex-1">
          <FieldLabel>{t("schoolSchedule.building")}</FieldLabel>
          <Select value={building} onValueChange={setBuilding}>
            <SelectTrigger className="w-full">
              <SelectValue />
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
        </Field>
      </div>
      <Field>
        <FieldLabel htmlFor="room-name">{t("schoolSchedule.roomTab")}</FieldLabel>
        <div className="flex gap-2">
          <Input
            id="room-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("schoolSchedule.roomNamePlaceholder")}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSearch();
            }}
          />
          <Button onClick={handleSearch}>
            <Search data-icon="inline-start" />
            {t("schoolSchedule.searchRoom")}
          </Button>
        </div>
      </Field>
    </FieldGroup>
  );

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
      <div className="hidden md:block">{filterControls}</div>
      <FilterDrawer
        open={filterDrawerOpen}
        onOpenChange={setFilterDrawerOpen}
        title={t("schoolSchedule.roomTab")}
      >
        {filterControls}
      </FilterDrawer>

      {!hasFilter ? (
        <EmptyState title={t("schoolSchedule.selectHint")} />
      ) : (
        <RoomListResults
          filter={{
            name: searchedName || undefined,
            campus: campus === ALL ? undefined : campus,
            building: building === ALL ? undefined : building,
          }}
          onSelect={setSelectedRoom}
        />
      )}
    </div>
  );
}

export default function SchoolSchedulePage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState("class");

  return (
    <div className="flex flex-col gap-6">
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
