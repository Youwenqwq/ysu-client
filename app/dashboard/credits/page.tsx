"use client";

import { useState } from "react";
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
  EmptyState as SharedEmptyState,
  LoadingCards,
  useErrorToast,
} from "@/components/academic/list-state";
import { FilterChips } from "@/components/academic/filter-chips";
import {
  FilterDrawer,
  FilterOptionList,
  FilterTrigger,
} from "@/components/academic/filter-drawer";
import { useTranslation } from "@/lib/i18n/use-translation";
import { useMobileHeaderRight } from "@/lib/stores/mobile-header";
import {
  useCreditBatches,
  useCreditCompetitions,
  useCreditDeclarations,
  useCreditLibraryActivities,
  useCreditRecords,
  useCreditSummary,
} from "@/providers/hooks";
import type {
  CatalogPage,
  CatalogQueryOptions,
  Competition,
  LibraryActivity,
} from "@/providers/types";
import type { ProviderQueryResult } from "@/providers/hooks";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";

function DeclarationsPanel() {
  const { t } = useTranslation();
  const query = useCreditDeclarations();
  const declarations = query.data ?? [];
  useErrorToast(query.error);

  if (query.isLoading && declarations.length === 0) return <LoadingCards />;
  if (declarations.length === 0) return <SharedEmptyState title={t("credits.noDeclarations")} description={t("credits.description")} />;

  return (
    <div className="flex flex-col gap-4">
      {declarations.map((decl, idx) => (
        <Card key={`${decl.itemName}-${idx}`}>
          <CardHeader>
            <div className="flex items-start justify-between gap-2">
              <CardTitle className="text-base">{decl.itemName}</CardTitle>
              {decl.status && <Badge variant="secondary">{decl.status}</Badge>}
            </div>
            <CardDescription>
              {[decl.categoryMajor, decl.categoryMinor].filter(Boolean).join(" · ")}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
            {decl.score !== undefined && (
              <span>
                {t("credits.score")}: {decl.score}
              </span>
            )}
            {decl.awardLevel && (
              <span>
                {t("credits.awardLevel")}: {decl.awardLevel}
              </span>
            )}
            {decl.batch && (
              <span>
                {t("credits.batch")}: {decl.batch}
              </span>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function RecordsPanel() {
  const { t } = useTranslation();
  /** undefined = 服务端当前批次；"all" = 遍历全部批次；否则为 batchId */
  const [batch, setBatch] = useState<string | undefined>(undefined);
  const [filterDrawerOpen, setFilterDrawerOpen] = useState(false);

  const batchesQuery = useCreditBatches();
  const batches = batchesQuery.data ?? [];

  const recordsQuery = useCreditRecords(
    batch === "all" ? { all: true } : batch ? { batchId: batch } : undefined,
  );
  const records = recordsQuery.data ?? [];

  useErrorToast(batchesQuery.error);
  useErrorToast(recordsQuery.error);

  const CURRENT = "__current";
  const chips = [
    { value: CURRENT, label: batches[0]?.name ?? t("credits.batch") },
    { value: "all", label: t("credits.allBatches") },
    ...batches.slice(1).map((b) => ({ value: b.batchId, label: b.name })),
  ];
  const activeValue = batch ?? CURRENT;
  const activeLabel = chips.find((c) => c.value === activeValue)?.label ?? t("credits.batch");

  useMobileHeaderRight(
    batches.length > 0 ? (
      <FilterTrigger label={activeLabel} onClick={() => setFilterDrawerOpen(true)} />
    ) : null,
    [activeLabel, batches.length],
  );

  return (
    <div className="flex flex-col gap-4">
      {batches.length > 0 && (
        <div className="hidden md:block">
          <FilterChips
            items={chips}
            value={activeValue}
            onChange={(v) => setBatch(v === CURRENT ? undefined : v)}
          />
        </div>
      )}

      <FilterDrawer
        open={filterDrawerOpen}
        onOpenChange={setFilterDrawerOpen}
        title={t("credits.recordsTab")}
      >
        <FilterOptionList
          items={chips}
          value={activeValue}
          onChange={(v) => {
            setBatch(v === CURRENT ? undefined : v);
            setFilterDrawerOpen(false);
          }}
        />
      </FilterDrawer>

      {(recordsQuery.isLoading || recordsQuery.isValidating) && records.length === 0 ? (
        <LoadingCards />
      ) : records.length === 0 ? (
        <SharedEmptyState title={t("credits.noRecords")} description={t("credits.description")} />
      ) : (
        <div className="flex flex-col gap-4">
          {records.map((record, idx) => (
            <Card key={`${record.itemName}-${record.batch ?? ""}-${idx}`}>
              <CardHeader>
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="text-base">{record.itemName}</CardTitle>
                  <div className="flex shrink-0 gap-1">
                    {record.grade && <Badge variant="default">{record.grade}</Badge>}
                    {record.status && <Badge variant="secondary">{record.status}</Badge>}
                  </div>
                </div>
                <CardDescription>
                  {[record.categoryMajor, record.categoryMinor].filter(Boolean).join(" · ")}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                {record.actualScore !== undefined && (
                  <span>
                    {t("credits.actualScore")}: {record.actualScore}
                  </span>
                )}
                {record.year && (
                  <span>
                    {t("credits.year")}: {record.year}
                  </span>
                )}
                {record.batch && (
                  <span>
                    {t("credits.batch")}: {record.batch}
                  </span>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

interface CatalogItem {
  key: string;
  title: string;
  subtitle: string;
  badge?: string;
}

function CatalogPanel<T>({
  useCatalogQuery,
  noDataKey,
  mapItems,
}: {
  useCatalogQuery: (
    opts?: CatalogQueryOptions,
  ) => ProviderQueryResult<CatalogPage<T>>;
  noDataKey: string;
  mapItems: (items: T[]) => CatalogItem[];
}) {
  const { t } = useTranslation();
  const [keyword, setKeyword] = useState("");
  const [search, setSearch] = useState("");
  const [pageIndex, setPageIndex] = useState(1);

  const query = useCatalogQuery({ keyword: search, pageIndex });
  useErrorToast(query.error);

  const items = query.data ? mapItems(query.data.items) : [];
  const totalPages = query.data?.totalPages ?? 1;
  const current = query.data?.pageIndex ?? pageIndex;
  const loading = query.isLoading || query.isValidating;

  function handleSearch() {
    setPageIndex(1);
    setSearch(keyword.trim());
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-2">
        <Input
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder={t("credits.searchPlaceholder")}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSearch();
          }}
        />
        <Button onClick={handleSearch} disabled={loading}>
          {loading ? <Spinner data-icon="inline-start" /> : <Search data-icon="inline-start" />}
          {t("credits.search")}
        </Button>
      </div>

      {loading && items.length === 0 ? (
        <LoadingCards />
      ) : items.length === 0 ? (
        <SharedEmptyState title={t(noDataKey)} description={t("credits.description")} />
      ) : (
        <>
          <div className="flex flex-col gap-4">
            {items.map((item) => (
              <Card key={item.key}>
                <CardHeader>
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-base">{item.title}</CardTitle>
                    {item.badge && <Badge variant="secondary">{item.badge}</Badge>}
                  </div>
                  <CardDescription>{item.subtitle}</CardDescription>
                </CardHeader>
              </Card>
            ))}
          </div>
          {totalPages > 1 && (
            <div className="flex items-center justify-between">
              <Button
                variant="outline"
                size="sm"
                disabled={current <= 1 || loading}
                onClick={() => setPageIndex((p) => Math.max(1, p - 1))}
              >
                <ChevronLeft data-icon="inline-start" />
                {t("credits.prevPage")}
              </Button>
              <span className="text-sm text-muted-foreground">
                {t("credits.pageInfo", { current, total: totalPages })}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={current >= totalPages || loading}
                onClick={() => setPageIndex((p) => p + 1)}
              >
                {t("credits.nextPage")}
                <ChevronRight data-icon="inline-end" />
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function CreditsPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState("records");

  const summaryQuery = useCreditSummary();
  const summary = summaryQuery.data;
  useErrorToast(summaryQuery.error);

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardContent className="py-4">
          {summaryQuery.isLoading && !summary ? (
            <div className="flex gap-8">
              <Skeleton className="h-12 w-24" />
              <Skeleton className="h-12 w-24" />
            </div>
          ) : summary ? (
            <div className="flex gap-8">
              <div className="flex flex-col">
                <span className="text-xs text-muted-foreground">
                  {t("credits.totalCredits")}
                </span>
                <span className="text-2xl font-semibold">{summary.totalCredits ?? "-"}</span>
              </div>
              <div className="flex flex-col">
                <span className="text-xs text-muted-foreground">{t("credits.grade")}</span>
                <span className="text-2xl font-semibold">{summary.grade || "-"}</span>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="w-full">
          <TabsTrigger value="records">{t("credits.recordsTab")}</TabsTrigger>
          <TabsTrigger value="declarations">{t("credits.declarationsTab")}</TabsTrigger>
          <TabsTrigger value="competitions">{t("credits.competitionsTab")}</TabsTrigger>
          <TabsTrigger value="activities">{t("credits.activitiesTab")}</TabsTrigger>
        </TabsList>

        <TabsContent value="records" className="mt-4">
          <RecordsPanel />
        </TabsContent>
        <TabsContent value="declarations" className="mt-4">
          <DeclarationsPanel />
        </TabsContent>
        <TabsContent value="competitions" className="mt-4">
          <CatalogPanel
            useCatalogQuery={useCreditCompetitions}
            noDataKey="credits.noCompetitions"
            mapItems={(items: Competition[]) =>
              items.map((c) => ({
                key: c.code || c.name,
                title: c.name,
                subtitle: [c.code, c.categoryMajor, c.categoryMinor]
                  .filter(Boolean)
                  .join(" · "),
                badge: c.isEnabled === false ? t("credits.disabled") : undefined,
              }))
            }
          />
        </TabsContent>
        <TabsContent value="activities" className="mt-4">
          <CatalogPanel
            useCatalogQuery={useCreditLibraryActivities}
            noDataKey="credits.noActivities"
            mapItems={(items: LibraryActivity[]) =>
              items.map((a, idx) => ({
                key: `${a.name}-${idx}`,
                title: a.name,
                subtitle: [a.organizer, a.category].filter(Boolean).join(" · "),
              }))
            }
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
