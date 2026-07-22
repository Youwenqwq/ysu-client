"use client";

import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { useTranslation } from "@/lib/i18n/use-translation";
import {
  BookOpen,
  CalendarDays,
  ClipboardCheck,
  FilePenLine,
  FileText,
  Gauge,
  Hammer,
  Lightbulb,
  User,
} from "lucide-react";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </h2>
      {children}
    </section>
  );
}

interface ServiceItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

function ServiceGrid({ items }: { items: ServiceItem[] }) {
  return (
    <Card>
      <CardContent className="grid grid-cols-4 gap-y-4 py-4">
        {items.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="flex flex-col items-center gap-1.5 rounded-lg py-1 transition-colors active:bg-muted/60"
          >
            <span className="flex size-11 items-center justify-center rounded-xl bg-primary/10">
              <item.icon className="size-5 text-primary" />
            </span>
            <span className="text-center text-xs leading-tight">{item.label}</span>
          </Link>
        ))}
      </CardContent>
    </Card>
  );
}

export default function ServicesPage() {
  const { t } = useTranslation();

  const academicItems: ServiceItem[] = [
    { href: "/dashboard/me/student", label: t("app.studentInfo"), icon: User },
    { href: "/dashboard/exams", label: t("app.exams"), icon: FileText },
    { href: "/dashboard/makeup-exams", label: t("app.makeupExams"), icon: FilePenLine },
    { href: "/dashboard/training-plan", label: t("app.trainingPlan"), icon: BookOpen },
    { href: "/dashboard/evaluation", label: t("app.evaluation"), icon: ClipboardCheck },
  ];

  const platformItems: ServiceItem[] = [
    { href: "/dashboard/labor", label: t("app.labor"), icon: Hammer },
    { href: "/dashboard/credits", label: t("app.credits"), icon: Lightbulb },
    { href: "/dashboard/comprehensive", label: t("app.comprehensive"), icon: Gauge },
    { href: "/dashboard/school-schedule", label: t("app.schoolSchedule"), icon: CalendarDays },
  ];

  return (
    <div className="flex flex-col gap-4">
      <Section title={t("me.sectionAcademic")}>
        <ServiceGrid items={academicItems} />
      </Section>
      <Section title={t("me.sectionPlatforms")}>
        <ServiceGrid items={platformItems} />
      </Section>
    </div>
  );
}
