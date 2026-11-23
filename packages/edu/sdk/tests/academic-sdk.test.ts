import { describe, expect, it, vi } from "vitest"
import {
  Context,
  createObservableSource,
  defineDictionary,
  definePlugin,
  defineStore,
  PLUGIN_API_VERSION,
} from "@orahako/sdk"
import {
  BUILT_IN_ACADEMIC_SLICES,
  defineSchoolProvider,
  getEnabledSlices,
  getSlice,
  hasSlice,
  isProviderError,
  ProviderError,
  ProviderErrorCode,
  requireSlice,
  supportsPlugin,
  wrapError,
  type Course,
  type EcardProfile,
  type EvaluationItem,
  type Exam,
  type FeeItem,
  type GPAInfo,
  type Grade,
  type LabCourse,
  type MakeupExam,
  type OverviewService,
  type ProviderRuntimeSnapshot,
  type QuerySnapshot,
  type SchoolProvider,
  type SessionSnapshot,
  type StudentInfo,
} from "@orahako/academic-sdk"

declare module "@orahako/academic-sdk" {
  interface AcademicSliceMap {
    customLibrary: {
      getBorrowedBooks(): Promise<readonly string[]>
    }
  }
}

describe("ProviderError & wrapError", () => {
  it("preserves ProviderError instances and wraps unknown errors", () => {
    const authErr = new ProviderError(
      ProviderErrorCode.AUTH_SESSION_EXPIRED,
      "JWXT expired",
      undefined,
      401
    )
    expect(isProviderError(authErr)).toBe(true)
    expect(wrapError(authErr)).toBe(authErr)

    const wrappedNative = wrapError(new Error("boom"))
    expect(wrappedNative.code).toBe(ProviderErrorCode.UNKNOWN)
    expect(wrappedNative.message).toBe("boom")

    const wrappedString = wrapError("plain string error")
    expect(wrappedString.message).toBe("plain string error")
  })

  it("recognizes a structurally identical ProviderError copy from a ZIP bundle", () => {
    class BundledProviderError extends Error {
      readonly code: string
      readonly status?: number

      constructor(code: string, message: string, status?: number) {
        super(message)
        this.name = "ProviderError"
        this.code = code
        this.status = status
      }
    }

    const bundledExpired = new BundledProviderError(
      ProviderErrorCode.AUTH_SESSION_EXPIRED,
      "JWXT expired in bundled provider",
      401
    )
    expect(bundledExpired).not.toBeInstanceOf(ProviderError)
    expect(isProviderError(bundledExpired)).toBe(true)
    expect(wrapError(bundledExpired)).toBe(bundledExpired)
    expect(wrapError(bundledExpired).code).toBe(ProviderErrorCode.AUTH_SESSION_EXPIRED)

    const genericError = new Error("not a provider error")
    ;(genericError as Error & { name: string }).name = "ProviderError"
    ;(genericError as Error & { code?: string }).code = "NOT_A_PROVIDER_CODE"
    expect(isProviderError(genericError)).toBe(false)
    expect(wrapError(genericError).code).toBe(ProviderErrorCode.UNKNOWN)

    expect(isProviderError({ name: "ProviderError", message: "x", code: "UNKNOWN" })).toBe(false)
    expect(isProviderError(null)).toBe(false)
  })
})

describe("SchoolProvider & AcademicSliceMap helpers", () => {
  const sampleCourse: Course = {
    name: "高等数学",
    code: "MATH101",
    weekDay: 1,
    startSection: 1,
    endSection: 2,
    weekList: [1, 2, 3],
  }

  const provider: SchoolProvider = defineSchoolProvider({
    id: "ysu",
    name: "燕山大学",
    supportedPlugins: ["orahako.schedule", "orahako.grades"],
    slices: {
      auth: {
        prepareLogin: async () => {},
        resetLoginSession: () => {},
        login: async () => {},
        loginStep1: async (input) => ({
          authenticated: true,
          needsMfa: false,
          username: input.username,
        }),
        checkAuthStatus: async () => ({ authenticated: true }),
        isAuthenticated: () => true,
      },
      timetable: {
        getSchedule: async () => [sampleCourse],
      },
      customLibrary: {
        getBorrowedBooks: async () => ["Compilers"],
      },
    },
    initialize: async () => {},
    reset: async () => {},
    logout: async () => {},
    relogin: async () => true,
  })

  it("exposes all 15 built-in orthogonal slices plus module-augmented slices", async () => {
    expect(BUILT_IN_ACADEMIC_SLICES).toHaveLength(15)
    expect(hasSlice(provider, "timetable")).toBe(true)
    expect(hasSlice(provider, "exams")).toBe(false)
    expect(hasSlice(provider, "customLibrary")).toBe(true)

    expect(getSlice(provider, "exams")).toBeUndefined()
    const timetable = requireSlice(provider, "timetable")
    await expect(timetable.getSchedule()).resolves.toEqual([sampleCourse])

    const library = requireSlice(provider, "customLibrary")
    await expect(library.getBorrowedBooks()).resolves.toEqual(["Compilers"])

    expect(getEnabledSlices(provider)).toEqual(["auth", "timetable", "customLibrary"])

    expect(() => requireSlice(provider, "exams")).toThrow(ProviderError)
    try {
      requireSlice(provider, "exams")
    } catch (error) {
      expect(isProviderError(error)).toBe(true)
      if (isProviderError(error)) {
        expect(error.code).toBe(ProviderErrorCode.FEATURE_NOT_SUPPORTED)
        expect(error.status).toBe(501)
      }
    }
  })

  it("checks supportedPlugins allowlists accurately", () => {
    expect(supportsPlugin(undefined, "any.plugin")).toBe(true)
    expect(supportsPlugin([], "orahako.schedule")).toBe(false)
    expect(supportsPlugin(provider.supportedPlugins, "orahako.schedule")).toBe(true)
    expect(supportsPlugin(provider.supportedPlugins, "orahako.ecard")).toBe(false)
  })

  it("exports all required domain entity interfaces and aliases", () => {
    const checkEntities = (
      lab: LabCourse,
      exam: Exam,
      makeup: MakeupExam,
      grade: Grade,
      gpa: GPAInfo,
      student: StudentInfo,
      evalItem: EvaluationItem,
      ecard: EcardProfile,
      fee: FeeItem
    ) => ({ lab, exam, makeup, grade, gpa, student, evalItem, ecard, fee })
    expect(typeof checkEntities).toBe("function")
  })
})

describe("Cordis academic service & event augmentation", () => {
  it("merges academic services and events cleanly into definePlugin and Context", async () => {
    const widgetDict = defineDictionary({
      zh: { title: "成绩概览" },
      en: { title: "Grades Overview" },
    })
    const widgetStore = defineStore({
      init: () => ({ compact: true }),
      actions: {
        setCompact(ctx, compact: boolean) {
          ctx.set({ compact })
        },
      },
    })
    const gradesQuerySource = createObservableSource<QuerySnapshot<readonly Grade[]>>({
      status: "success",
      data: [],
      error: null,
      isLoading: false,
      isRefreshing: false,
      isStale: false,
      updatedAt: 100,
      refresh: async () => [],
    })

    const gradesPlugin = definePlugin({
      manifest: {
        id: "orahako.grades",
        name: "Grades",
        version: "1.0.0",
        apiVersion: PLUGIN_API_VERSION,
        kind: "feature",
        entry: "index.js",
      },
      inject: ["ui", "query", "provider", "session", "notifications", "overview"],
      apply(ctx) {
        ctx.notifications.registerChannel({
          id: "grades",
          slice: "grades",
          toPollingFlag: "grades",
        })

        ctx.overview.registerWidget(
          {
            id: "grades-summary",
            titleKey: "title",
            icon: () => null,
            region: "summary",
            defaultVisible: true,
            slice: "grades",
            dictionary: widgetDict,
            store: widgetStore,
            inject: () => ({
              hooks: {
                grades: gradesQuerySource,
              },
            }),
          },
          (props) => {
            const label: string = props.t("title")
            const compact: boolean = props.useStore((s) => s.compact)
            const snap = props.useGrades()
            return `${label}:${compact}:${snap.status}`
          }
        )

        ctx.on("provider/ready", (snapshot: ProviderRuntimeSnapshot) => {
          void snapshot.schoolId
        })
        ctx.on("session/expired", (session: SessionSnapshot) => {
          void session.sessionExpired
        })

        if (false) {
          // @ts-expect-error mfa was not declared in inject
          void ctx.mfa
        }
      },
    })

    expect(gradesPlugin.inject).toContain("overview")

    const root = new Context()
    await root.start()
    const readySpy = vi.fn()
    root.on("provider/ready", readySpy)
    root.emit("provider/ready", {
      status: "ready",
      schoolId: "ysu",
      provider: null,
      error: null,
      generation: 1,
    })
    expect(readySpy).toHaveBeenCalledOnce()

    const verifyOverviewContract = (overview: OverviewService) => overview.getSnapshot()
    expect(typeof verifyOverviewContract).toBe("function")
    await root.stop()
  })
})
