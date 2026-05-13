"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import {
  Field,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@/components/ui/toggle-group";
import {
  ResponsiveModal,
  ResponsiveModalBody,
  ResponsiveModalContent,
  ResponsiveModalDescription,
  ResponsiveModalHeader,
  ResponsiveModalTitle,
} from "@/components/responsive-modal";
import { Separator } from "@/components/ui/separator";
import { useAuthStore } from "@/lib/auth-store";
import { useTranslation } from "@/lib/i18n/use-translation";
import { useMobileHeaderRight } from "@/lib/mobile-header-store";
import {
  getGrades,
  getGPAStats,
  getCurrentWeek,
  getGradeStatistics,
  getGradeDistribution,
  getGradeRanking,
} from "@/lib/api";
import { cacheGet, cacheSet, cacheKey } from "@/lib/cache";
import { useRefreshStore } from "@/lib/refresh-store";
import type {
  Grade,
  GPAStats,
  GradeStatistics,
  GradeDistribution,
  GradeRanking,
} from "@/lib/types";
import { Search, ChevronDown, ChevronUp } from "lucide-react";

export default function GradesPage() {
  const credential = useAuthStore((s) => s.credential);
  const { t } = useTranslation();
  const [grades, setGrades] = useState<Grade[]>([]);
  const [gpa, setGpa] = useState<GPAStats | null>(null);
  const [loading, setLoading] = useState(true);
  const ALL_TERM = "__all__";
  const [term, setTerm] = useState(ALL_TERM);
  const [courseName, setCourseName] = useState("");
  const [showAllGpa, setShowAllGpa] = useState(false);
  const [filterDrawerOpen, setFilterDrawerOpen] = useState(false);
  const [selectedGrade, setSelectedGrade] = useState<Grade | null>(null);
  const [statsOpen, setStatsOpen] = useState(false);
  const [statsLoading, setStatsLoading] = useState(false);
  const [statsResult, setStatsResult] = useState<GradeStatistics | null>(null);
  const [distributionResult, setDistributionResult] = useState<GradeDistribution[] | null>(null);
  const [rankingResult, setRankingResult] = useState<GradeRanking | null>(null);
  const [statsError, setStatsError] = useState<string | null>(null);
  const [statsScope, setStatsScope] = useState<"class" | "course">("class");

  const terms = useMemo(
    () => Array.from(new Set(grades.map((g) => g.term).filter(Boolean))).sort(),
    [grades],
  );

  useEffect(() => {
    if (!credential) return;

    const cachedGrades = cacheGet<Grade[]>(cacheKey(["grades", credential]));
    const cachedGpa = cacheGet<GPAStats>(cacheKey(["gpa", credential]));
    if (cachedGrades) setGrades(cachedGrades);
    if (cachedGpa) setGpa(cachedGpa);
    let refreshing = false;
    const hasCache = cachedGrades || cachedGpa;
    if (hasCache) {
      setLoading(false);
      useRefreshStore.getState().start();
      refreshing = true;
    }

    async function load() {
      try {
        const [g, gp, weekInfo] = await Promise.all([
          getGrades(credential!),
          getGPAStats(credential!).catch(() => null),
          getCurrentWeek(credential!).catch(() => null),
        ]);
        setGrades(g);
        setGpa(gp);
        cacheSet(cacheKey(["grades", credential!]), g);
        cacheSet(cacheKey(["gpa", credential!]), gp);
        if (weekInfo?.term) {
          setTerm((prev) => (prev === ALL_TERM ? weekInfo.term! : prev));
        }
        useRefreshStore.getState().markFresh();
      } catch (err) {
        if (hasCache) {
          useRefreshStore.getState().markStale();
        } else {
          toast.error((err as Error).message || t("app.updating"));
        }
      } finally {
        setLoading(false);
        if (refreshing) useRefreshStore.getState().end();
      }
    }
    load();
  }, [credential, t]);

  useEffect(() => {
    if (terms.length > 0 && term === ALL_TERM) {
      const latest = terms[terms.length - 1];
      if (latest) setTerm(latest);
    }
  }, [terms, term, ALL_TERM]);

  async function handleSearch() {
    if (!credential) return;
    setLoading(true);
    try {
      const g = await getGrades(credential, {
        term: term === ALL_TERM ? undefined : term,
        course_name: courseName || undefined,
      });
      setGrades(g);
    } catch (err) {
      toast.error((err as Error).message || t("app.updating"));
    } finally {
      setLoading(false);
    }
  }

  async function fetchStatsForScope(grade: Grade, scope: "class" | "course") {
    if (!credential) return;
    setStatsResult(null);
    setDistributionResult(null);
    setRankingResult(null);
    setStatsError(null);

    const params: { class_id?: string; course_code?: string; term?: string } = {
      term: grade.term || undefined,
    };
    if (scope === "class") {
      params.class_id = grade.class_id?.trim();
    } else {
      params.course_code = grade.course_code?.trim();
    }

    setStatsLoading(true);
    try {
      const [stats, distribution, ranking] = await Promise.all([
        getGradeStatistics(credential, params).catch(() => null),
        getGradeDistribution(credential, params).catch(() => null),
        getGradeRanking(credential, params).catch(() => null),
      ]);
      setStatsResult(stats);
      setDistributionResult(distribution);
      setRankingResult(ranking);
      if (!stats && !distribution && !ranking) {
        setStatsError(t("grades.stats.loadFailed"));
      }
    } catch (err) {
      setStatsError((err as Error).message || t("grades.stats.loadFailed"));
    } finally {
      setStatsLoading(false);
    }
  }

  async function handleOpenStats(grade: Grade) {
    setSelectedGrade(grade);
    setStatsOpen(true);

    const hasClass = !!grade.class_id?.trim();
    const hasCourse = !!grade.course_code?.trim();
    if (!hasClass && !hasCourse) {
      setStatsResult(null);
      setDistributionResult(null);
      setRankingResult(null);
      setStatsError(t("grades.stats.noClassOrCourse"));
      return;
    }

    const initialScope: "class" | "course" = hasClass ? "class" : "course";
    setStatsScope(initialScope);
    await fetchStatsForScope(grade, initialScope);
  }

  async function handleScopeChange(scope: "class" | "course") {
    if (!selectedGrade || scope === statsScope) return;
    setStatsScope(scope);
    await fetchStatsForScope(selectedGrade, scope);
  }

  useMobileHeaderRight(
    <Button
      variant="ghost"
      size="sm"
      onClick={() => setFilterDrawerOpen(true)}
      className="h-8 px-2 text-sm"
    >
      {term === ALL_TERM ? t("grades.allTerms") : term}
      <ChevronDown className="ml-0.5 size-3.5" />
    </Button>,
    [term, t],
  );

  const filtered = grades.filter((g) => {
    if (term !== ALL_TERM && g.term !== term) return false;
    return true;
  });

  const termWeightedGpa = useMemo(() => {
    if (term === ALL_TERM) return null;
    let totalWeightedPoints = 0;
    let totalCredits = 0;
    for (const g of filtered) {
      const gp = parseFloat(g.grade_point ?? "");
      const cr = parseFloat(g.credit ?? "");
      if (Number.isFinite(gp) && Number.isFinite(cr) && cr > 0) {
        totalWeightedPoints += gp * cr;
        totalCredits += cr;
      }
    }
    if (totalCredits === 0) return null;
    return (totalWeightedPoints / totalCredits).toFixed(4);
  }, [filtered, term]);

  const basicGpaItems = [
    { label: t("grades.gpaInitial"), value: gpa?.gpa_initial },
    { label: t("dashboard.weightedAvg"), value: gpa?.weighted_avg },
    { label: t("dashboard.arithmeticAvg"), value: gpa?.arithmetic_avg },
    ...(termWeightedGpa !== null ? [{ label: t("grades.termWeightedGpa"), value: termWeightedGpa }] : []),
  ];

  const extraGpaItems = [
    { label: t("grades.gpaHighest"), value: gpa?.gpa_highest },
    { label: t("grades.requiredGpaHighest"), value: gpa?.required_gpa_highest },
    { label: t("grades.degreeGpaInitial"), value: gpa?.degree_gpa_initial },
    { label: t("grades.degreeWeightedAvg"), value: gpa?.degree_weighted_avg },
  ];

  if (loading && grades.length === 0) {
    return (
      <div className="flex flex-col gap-8">
        <Skeleton className="h-24" />
        <Skeleton className="h-12" />
        <Skeleton className="h-96" />
      </div>
    );
  }

  const filterControls = (
    <FieldGroup className="flex flex-row flex-wrap items-end gap-3">
      <Field className="w-48">
        <FieldLabel htmlFor="grades-term">{t("grades.termLabel")}</FieldLabel>
        <Select value={term} onValueChange={setTerm}>
          <SelectTrigger id="grades-term">
            <SelectValue placeholder={t("grades.allTerms")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_TERM}>{t("grades.allTerms")}</SelectItem>
            {terms.map((tItem) => (
              <SelectItem key={tItem} value={tItem!}>
                {tItem}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field className="w-48">
        <FieldLabel htmlFor="grades-course-name">{t("grades.courseNameLabel")}</FieldLabel>
        <Input
          id="grades-course-name"
          value={courseName}
          onChange={(e) => setCourseName(e.target.value)}
          placeholder={t("grades.courseNamePlaceholder")}
        />
      </Field>
      <Button
        onClick={() => {
          handleSearch();
          setFilterDrawerOpen(false);
        }}
        disabled={loading}
      >
        {loading ? (
          <Spinner data-icon="inline-start" />
        ) : (
          <Search data-icon="inline-start" />
        )}
        {t("grades.search")}
      </Button>
    </FieldGroup>
  );

  return (
    <div className="flex flex-col gap-6 md:gap-8">
      <Card className="gap-1 py-3 md:gap-4 md:py-4">
        <CardHeader className="md:pb-3">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <CardTitle className="text-sm md:text-base">{t("grades.gpaTitle")}</CardTitle>
              <CardDescription className="hidden md:block">{t("grades.gpaDescription")}</CardDescription>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setShowAllGpa((v) => !v)}>
              {showAllGpa ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
            </Button>
          </div>
        </CardHeader>
        <CardContent className={`pt-0 md:pt-0 ${!showAllGpa ? "hidden md:block" : ""}`}>
          {showAllGpa && (
            <div className="flex flex-col divide-y divide-border md:hidden">
              {[...basicGpaItems, ...extraGpaItems].map((item) => (
                <div key={item.label} className="flex items-center justify-between py-1.5 text-sm">
                  <span className="text-muted-foreground">{item.label}</span>
                  <span className="font-semibold tabular-nums">{item.value || "-"}</span>
                </div>
              ))}
            </div>
          )}
          <div className="hidden grid-cols-2 gap-3 md:grid md:grid-cols-3 md:gap-4">
            {basicGpaItems.map((item) => (
              <div key={item.label} className="flex flex-col gap-1 rounded-md border p-3">
                <span className="text-xs text-muted-foreground">{item.label}</span>
                <span className="text-lg font-semibold">{item.value || "-"}</span>
              </div>
            ))}
            {showAllGpa &&
              extraGpaItems.map((item) => (
                <div key={item.label} className="flex flex-col gap-1 rounded-md border p-3">
                  <span className="text-xs text-muted-foreground">{item.label}</span>
                  <span className="text-lg font-semibold">{item.value || "-"}</span>
                </div>
              ))}
          </div>
        </CardContent>
      </Card>

      <Card className="hidden md:block">
        <CardHeader>
          <CardTitle>{t("grades.title")}</CardTitle>
          <CardDescription>{t("grades.description")}</CardDescription>
        </CardHeader>
        <CardContent>{filterControls}</CardContent>
      </Card>

      <Card className="hidden md:block">
        <CardContent className="pt-6">
          <div className="rounded-md border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("grades.table.term")}</TableHead>
                  <TableHead>{t("grades.table.courseName")}</TableHead>
                  <TableHead>{t("grades.table.courseCode")}</TableHead>
                  <TableHead>{t("grades.table.score")}</TableHead>
                  <TableHead>{t("grades.table.gradeLevel")}</TableHead>
                  <TableHead>{t("grades.table.gradePoint")}</TableHead>
                  <TableHead>{t("grades.table.credit")}</TableHead>
                  <TableHead>{t("grades.table.type")}</TableHead>
                  <TableHead>{t("grades.table.status")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center text-muted-foreground">
                      {t("grades.table.noData")}
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map((g, idx) => (
                    <TableRow
                      key={idx}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => handleOpenStats(g)}
                    >
                      <TableCell>{g.term}</TableCell>
                      <TableCell className="font-medium">{g.course_name}</TableCell>
                      <TableCell>{g.course_code}</TableCell>
                      <TableCell>{g.score}</TableCell>
                      <TableCell>{g.grade_level || "-"}</TableCell>
                      <TableCell>{g.grade_point}</TableCell>
                      <TableCell>{g.credit}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          <Badge variant="secondary">{g.course_type}</Badge>
                          {g.is_degree_course && (
                            <Badge variant="outline">{t("grades.degreeCourse")}</Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        {g.is_pass ? (
                          <Badge variant="default">{t("grades.table.pass")}</Badge>
                        ) : (
                          <Badge variant="destructive">{t("grades.table.fail")}</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-2 md:hidden">
        {filtered.length === 0 ? (
          <p className="rounded-lg border p-6 text-center text-sm text-muted-foreground">
            {t("grades.table.noData")}
          </p>
        ) : (
          filtered.map((g, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => handleOpenStats(g)}
              className="rounded-lg border p-3 text-left transition-colors hover:bg-muted/50 active:bg-muted/70"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{g.course_name}</span>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                    {g.term && <span>{g.term}</span>}
                    {g.course_type && (
                      <>
                        <span>·</span>
                        <span>{g.course_type}</span>
                      </>
                    )}
                    {g.credit && (
                      <>
                        <span>·</span>
                        <span>
                          {t("grades.table.credit")} {g.credit}
                        </span>
                      </>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-lg font-semibold tabular-nums leading-none">
                      {g.score || "-"}
                    </span>
                    {g.grade_level && (
                      <span className="text-xs font-medium text-muted-foreground">
                        {g.grade_level}
                      </span>
                    )}
                  </div>
                  {g.grade_point && (
                    <span className="text-[10px] text-muted-foreground">
                      GP {g.grade_point}
                    </span>
                  )}
                  {g.is_pass ? (
                    <Badge variant="default" className="text-[10px]">
                      {t("grades.table.pass")}
                    </Badge>
                  ) : (
                    <Badge variant="destructive" className="text-[10px]">
                      {t("grades.table.fail")}
                    </Badge>
                  )}
                  {g.is_degree_course && (
                    <Badge variant="outline" className="text-[10px]">
                      {t("grades.degreeCourse")}
                    </Badge>
                  )}
                </div>
              </div>
            </button>
          ))
        )}
      </div>

      <Drawer open={filterDrawerOpen} onOpenChange={setFilterDrawerOpen}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>{t("grades.title")}</DrawerTitle>
            <DrawerDescription>{t("grades.description")}</DrawerDescription>
          </DrawerHeader>
          <div className="px-4 pb-6">{filterControls}</div>
        </DrawerContent>
      </Drawer>

      <ResponsiveModal open={statsOpen} onOpenChange={setStatsOpen}>
        <ResponsiveModalContent className="sm:max-w-lg">
          <ResponsiveModalHeader>
            <ResponsiveModalTitle>
              {selectedGrade?.course_name || t("grades.stats.title")}
            </ResponsiveModalTitle>
            <ResponsiveModalDescription className="sr-only">
              {t("grades.stats.description")}
            </ResponsiveModalDescription>
          </ResponsiveModalHeader>
          <ResponsiveModalBody className="flex flex-col gap-5 pb-4">
            {selectedGrade && (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm text-muted-foreground">
                  {selectedGrade.term || "-"}
                </span>
                <ToggleGroup
                  type="single"
                  size="sm"
                  variant="outline"
                  value={statsScope}
                  onValueChange={(v) => {
                    if (v === "class" || v === "course") handleScopeChange(v);
                  }}
                  disabled={statsLoading}
                >
                  <ToggleGroupItem
                    value="class"
                    disabled={!selectedGrade.class_id?.trim()}
                  >
                    {t("grades.stats.scopeClass")}
                  </ToggleGroupItem>
                  <ToggleGroupItem
                    value="course"
                    disabled={!selectedGrade.course_code?.trim()}
                  >
                    {t("grades.stats.scopeCourse")}
                  </ToggleGroupItem>
                </ToggleGroup>
              </div>
            )}
            {statsError ? (
              <p className="rounded-md border p-4 text-center text-sm text-muted-foreground">
                {statsError}
              </p>
            ) : statsLoading ? (
              <div className="flex flex-col gap-3">
                <Skeleton className="h-20" />
                <Skeleton className="h-32" />
                <Skeleton className="h-20" />
              </div>
            ) : (
              <>
                <section className="flex flex-col gap-2">
                  <h3 className="text-sm font-semibold">
                    {t("grades.stats.sectionStatistics")}
                  </h3>
                  {statsResult ? (
                    <div className="grid grid-cols-3 gap-2">
                      <div className="flex flex-col gap-1 rounded-md border p-2.5">
                        <span className="text-[10px] text-muted-foreground">
                          {t("grades.stats.highest")}
                        </span>
                        <span className="text-base font-semibold tabular-nums">
                          {statsResult.highest_score?.toFixed(1) ?? "-"}
                        </span>
                      </div>
                      <div className="flex flex-col gap-1 rounded-md border p-2.5">
                        <span className="text-[10px] text-muted-foreground">
                          {t("grades.stats.lowest")}
                        </span>
                        <span className="text-base font-semibold tabular-nums">
                          {statsResult.lowest_score?.toFixed(1) ?? "-"}
                        </span>
                      </div>
                      <div className="flex flex-col gap-1 rounded-md border p-2.5">
                        <span className="text-[10px] text-muted-foreground">
                          {t("grades.stats.average")}
                        </span>
                        <span className="text-base font-semibold tabular-nums">
                          {statsResult.average_score?.toFixed(1) ?? "-"}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">{t("grades.stats.noData")}</p>
                  )}
                </section>

                <Separator />

                <section className="flex flex-col gap-2">
                  <h3 className="text-sm font-semibold">
                    {t("grades.stats.sectionDistribution")}
                  </h3>
                  {distributionResult && distributionResult.length > 0 ? (
                    <div className="flex flex-col gap-1.5">
                      {(() => {
                        const maxCount = Math.max(
                          ...distributionResult.map((d) => d.count || 0),
                          1,
                        );
                        return distributionResult.map((d, i) => {
                          const pct = ((d.count || 0) / maxCount) * 100;
                          return (
                            <div key={i} className="flex items-center gap-3 text-xs">
                              <span className="w-16 shrink-0 truncate">
                                {d.level_name || d.level_code || "-"}
                              </span>
                              <div className="relative flex-1">
                                <div className="h-5 w-full rounded-sm bg-muted">
                                  <div
                                    className="h-full rounded-sm bg-primary/70"
                                    style={{ width: `${pct}%` }}
                                  />
                                </div>
                              </div>
                              <span className="w-12 shrink-0 text-right tabular-nums text-muted-foreground">
                                {t("grades.stats.count", { count: d.count })}
                              </span>
                            </div>
                          );
                        });
                      })()}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">{t("grades.stats.noData")}</p>
                  )}
                </section>

                <Separator />

                <section className="flex flex-col gap-2">
                  <h3 className="text-sm font-semibold">
                    {t("grades.stats.sectionRanking")}
                  </h3>
                  {rankingResult ? (
                    <div className="grid grid-cols-2 gap-2">
                      <div className="flex flex-col gap-1 rounded-md border p-2.5">
                        <span className="text-[10px] text-muted-foreground">
                          {t("grades.stats.myScore")}
                        </span>
                        <span className="text-base font-semibold tabular-nums">
                          {rankingResult.score?.toFixed(1) ?? "-"}
                        </span>
                      </div>
                      <div className="flex flex-col gap-1 rounded-md border p-2.5">
                        <span className="text-[10px] text-muted-foreground">
                          {t("grades.stats.rank")}
                        </span>
                        <span className="text-base font-semibold tabular-nums">
                          {t("grades.stats.rankFormat", {
                            rank: rankingResult.rank,
                            total: rankingResult.total,
                          })}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">{t("grades.stats.noData")}</p>
                  )}
                </section>
              </>
            )}
          </ResponsiveModalBody>
        </ResponsiveModalContent>
      </ResponsiveModal>
    </div>
  );
}
