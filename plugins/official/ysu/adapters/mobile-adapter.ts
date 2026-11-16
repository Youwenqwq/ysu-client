import {
  MobileBusinessError,
  MobileError,
  MobileNotLoggedInError,
  MobileProtocolError,
  type JWMobileProtocol,
} from "../protocol/jwmobile"
import { ProviderError, ProviderErrorCode, wrapError } from "@orahako/plugin-sdk/provider-errors"
import type {
  CurrentLesson,
  CurrentLessonQuery,
  SigninActivityDetail,
  SigninDetailQuery,
  StudentSignInput,
  StudentSignResult,
  StudentSigninStatus,
} from "@orahako/plugin-sdk/academic"

export class YSUMobileAdapter {
  constructor(
    private readonly mobile: JWMobileProtocol,
    private readonly mapCASSessionError: (error: unknown) => ProviderError | undefined
  ) {}

  private mapMobileError(error: unknown): ProviderError {
    const sessionError = this.mapCASSessionError(error)
    if (sessionError) return sessionError

    if (error instanceof MobileNotLoggedInError) {
      return new ProviderError(ProviderErrorCode.AUTH_SESSION_EXPIRED, error.message, error, 401)
    }
    if (error instanceof MobileBusinessError) {
      return new ProviderError(
        ProviderErrorCode.BACKEND_BUSINESS_ERROR,
        error.msg ?? error.message,
        error,
        400
      )
    }
    if (error instanceof MobileProtocolError) {
      return new ProviderError(ProviderErrorCode.BACKEND_PROTOCOL_ERROR, error.message, error, 500)
    }
    if (error instanceof MobileError) {
      return new ProviderError(ProviderErrorCode.BACKEND_PROTOCOL_ERROR, error.message, error, 500)
    }
    return wrapError(error)
  }

  private async withMobile<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn()
    } catch (error) {
      throw this.mapMobileError(error)
    }
  }

  getCurrentLesson(input: CurrentLessonQuery): Promise<CurrentLesson> {
    return this.withMobile(async () => {
      const result = await this.mobile.queryCurrentLesson(input)
      return {
        lessonId: result.lessonId,
        activityList: result.activityList.map((activity) => ({
          activityId: activity.activityId,
          type: activity.type,
          status: activity.status,
          title: activity.title,
          icon: activity.icon,
          signType: activity.signType,
          signClazz: activity.signClazz,
          isEnd: activity.isEnd,
          isCreator: activity.isCreator,
          createTime: activity.createTime,
          createAt: activity.createAt,
          createTimestamp: activity.createTimestamp,
          raw: activity.raw,
        })),
        raw: result.raw,
      }
    })
  }

  getSigninDetail(input: SigninDetailQuery): Promise<SigninActivityDetail> {
    return this.withMobile(async () => {
      const result = await this.mobile.querySigninDetail(input)
      return {
        activityId: result.activityId,
        duration: result.duration,
        endTime: result.endTime,
        endAt: result.endAt,
        endTimestamp: result.endTimestamp,
        leftSeconds: result.leftSeconds,
        signinType: result.signinType,
        startTime: result.startTime,
        startAt: result.startAt,
        startTimestamp: result.startTimestamp,
        raw: result.raw,
      }
    })
  }

  getStudentSigninStatus(input: SigninDetailQuery): Promise<StudentSigninStatus> {
    return this.withMobile(async () => {
      const result = await this.mobile.queryStudentSigninStatus(input)
      return {
        signStatus: result.signStatus,
        attendanceStatus: result.attendanceStatus,
        signOrder: result.signOrder,
        signinType: result.signinType,
        raw: result.raw,
      }
    })
  }

  doStudentSign(input: StudentSignInput): Promise<StudentSignResult> {
    return this.withMobile(async () => {
      const result = await this.mobile.studentSign(input)
      return {
        signStatus: result.signStatus,
        attendanceStatus: result.attendanceStatus,
        signOrder: result.signOrder,
        signinType: result.signinType,
        raw: result.raw,
      }
    })
  }
}
