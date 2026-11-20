import type { QuerySnapshot, StudentInfo } from "@orahako/academic-sdk"
import type { DerivedComponentProps, ObservableSource, SlotComponent } from "@orahako/sdk"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Skeleton,
  useErrorToast,
} from "@orahako/ui-primitives"
import type { StudentInfoDictionary } from "./dictionary"

export interface StudentInfoPageInject {
  readonly hooks: {
    readonly student: ObservableSource<QuerySnapshot<StudentInfo>>
  }
}

export type StudentInfoPageProps = DerivedComponentProps<
  Record<string, never>,
  StudentInfoDictionary,
  undefined,
  undefined,
  StudentInfoPageInject
>

export const StudentInfoPage: SlotComponent<StudentInfoPageProps> = (props) => {
  const { t } = props
  const studentQuery = props.useStudent()
  const student = studentQuery.data

  useErrorToast(studentQuery.error ?? undefined)

  if (studentQuery.isLoading && !student) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-12" />
        <div className="grid gap-4 md:grid-cols-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-16" />
          ))}
        </div>
      </div>
    )
  }

  const fields = [
    { label: t("student.fields.name"), value: student?.name },
    { label: t("student.fields.studentId"), value: student?.studentId },
    { label: t("student.fields.pinyin"), value: student?.namePinyin },
    { label: t("student.fields.gender"), value: student?.gender },
    { label: t("student.fields.nation"), value: student?.nation },
    { label: t("student.fields.nationality"), value: student?.nationality },
    { label: t("student.fields.department"), value: student?.department },
    { label: t("student.fields.major"), value: student?.major },
    { label: t("student.fields.className"), value: student?.className },
    { label: t("student.fields.gradeLevel"), value: student?.gradeLevel },
    { label: t("student.fields.enrollmentDate"), value: student?.enrollmentDate },
    { label: t("student.fields.expectedGraduation"), value: student?.expectedGraduation },
    { label: t("student.fields.educationLevel"), value: student?.educationLevel },
    { label: t("student.fields.campus"), value: student?.campus },
    { label: t("student.fields.studentStatus"), value: student?.studentStatus },
    { label: t("student.fields.studyDuration"), value: student?.studyDuration },
    { label: t("student.fields.foreignLanguage"), value: student?.foreignLanguage },
  ]

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>{t("student.title")}</CardTitle>
          <CardDescription>{t("student.description")}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2">
            {fields.map((field) => (
              <div key={field.label} className="flex flex-col gap-1">
                <span className="text-sm text-muted-foreground">{field.label}</span>
                <span className="font-medium">{field.value || "-"}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
