import type { NativePollingSlice } from "@orahako/academic-sdk"
import type { YSUContext } from "./context"
import { YSU_SECURE_KEY_CAS_TGC } from "./ysu-config"

export interface NativeFieldMappings {
  readonly grade: Record<string, string[]>
  readonly exam: Record<string, string[]>
}

export interface NativeApiPath {
  readonly appId: string
  readonly path: string
}

export interface NativeServerConfig {
  readonly cerBaseUrl: string
  readonly jwxtBaseUrl: string
  readonly fieldMappings: NativeFieldMappings
  readonly apiPaths: {
    readonly grades: NativeApiPath
    readonly exams: NativeApiPath
    readonly currentTerm: NativeApiPath
  }
  readonly configVersion: number
}

export interface YsuNativePolling extends NativePollingSlice {
  readonly handlerId: "ysu"
  getServerConfig(): NativeServerConfig
  getAuthToken(): Promise<string | null>
}

export function createYsuNativePolling(ctx: YSUContext): YsuNativePolling {
  const config = ctx.config

  function getServerConfig(): NativeServerConfig {
    return {
      cerBaseUrl: ctx.urls.cas.cerBase,
      jwxtBaseUrl: ctx.urls.jwxt.base,
      fieldMappings: {
        grade: {
          record_id: ["WID"],
          class_id: ["JXBID"],
          course_name: ["XSKCM", "KCM"],
          course_code: ["XSKCH", "KCH"],
          score: ["ZCJ", "XSZCJMC"],
          grade_level: ["XSZCJMC"],
          grade_point: ["XFJD"],
          credit: ["XF"],
          hours: ["XS"],
          term: ["XNXQDM"],
          course_type: ["KCXZDM_DISPLAY", "KCXZDM"],
          course_category: ["KCLBDM_DISPLAY"],
          exam_type: ["KSLXDM_DISPLAY", "KSLXDM"],
          study_mode: ["XDFSDM_DISPLAY"],
          is_major: ["SFZX"],
          is_retake: ["CXCKDM_DISPLAY"],
          grade_level_type: ["XSDJCJLXDM_DISPLAY"],
          department: ["KKDWDM_DISPLAY"],
          is_pass: ["SFJG"],
          is_valid: ["SFYX"],
          special_reason: ["TSYYDM_DISPLAY"],
          is_degree_course: ["SFZGKC"],
          project_name: ["TYXMDM_DISPLAY"],
        },
        exam: {
          name: ["KCM"],
          exam_name: ["KSMC"],
          exam_location: ["JASMC"],
          seat_number: ["ZWH"],
        },
      },
      apiPaths: {
        grades: {
          appId: config.jwxt.appIds.cjcx,
          path: config.jwxt.apiPaths.cjcx,
        },
        exams: {
          appId: config.jwxt.appIds.studentWdksapApp,
          path: config.jwxt.apiPaths.wdksap,
        },
        currentTerm: {
          appId: config.jwxt.appIds.studentWdksapApp,
          path: config.jwxt.apiPaths.wdksap_dqxnxq,
        },
      },
      configVersion: 2,
    }
  }

  function getAuthToken(): Promise<string | null> {
    return ctx.storage.secure.getItem(YSU_SECURE_KEY_CAS_TGC)
  }

  return {
    handlerId: "ysu",
    getServerConfig,
    getAuthToken,
  }
}
