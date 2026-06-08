import { casUrls, getSchoolConfig, serverConfig } from "@/lib/server-config";
import { loadCASTGC } from "@/lib/storage/secure";
import type { ProviderNativeNotification } from "../types";

export interface NativeFieldMappings {
  grade: Record<string, string[]>;
  exam: Record<string, string[]>;
}

export interface NativeApiPath {
  appId: string;
  path: string;
}

export interface NativeServerConfig {
  cerBaseUrl: string;
  jwxtBaseUrl: string;
  fieldMappings: NativeFieldMappings;
  apiPaths: {
    grades: NativeApiPath;
    exams: NativeApiPath;
    currentTerm: NativeApiPath;
  };
  configVersion: number;
}

export function buildNativeServerConfig(): NativeServerConfig {
  const config = getSchoolConfig();
  return {
    cerBaseUrl: serverConfig.cerBaseUrl,
    jwxtBaseUrl: serverConfig.jwxtBaseUrl,
    fieldMappings: {
      grade: {
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
  };
}

export const ysuNativeNotification: ProviderNativeNotification = {
  getServerConfig: buildNativeServerConfig,
  getAuthToken: loadCASTGC,
  getAuthCookieUrl: () => casUrls.authLogin,
};
