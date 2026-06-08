import {
  MobileBusinessError,
  MobileError,
  MobileNotLoggedInError,
  MobileProtocolError,
  queryCurrentLesson,
  querySigninDetail,
  queryStudentSigninStatus,
  studentSign,
} from "../protocol/jwmobile";
import { ProviderError, ProviderErrorCode, wrapError } from "../../errors";
import type {
  CurrentLesson,
  CurrentLessonQuery,
  SigninActivityDetail,
  SigninDetailQuery,
  StudentSignInput,
  StudentSignResult,
  StudentSigninStatus,
} from "../../types";

function mapMobileError(error: unknown): ProviderError {
  if (error instanceof MobileNotLoggedInError) {
    return new ProviderError(
      ProviderErrorCode.AUTH_SESSION_EXPIRED,
      error.message,
      error,
      401,
    );
  }
  if (error instanceof MobileBusinessError) {
    return new ProviderError(
      ProviderErrorCode.BACKEND_BUSINESS_ERROR,
      error.msg ?? error.message,
      error,
      400,
    );
  }
  if (error instanceof MobileProtocolError) {
    return new ProviderError(
      ProviderErrorCode.BACKEND_PROTOCOL_ERROR,
      error.message,
      error,
      500,
    );
  }
  if (error instanceof MobileError) {
    return new ProviderError(
      ProviderErrorCode.BACKEND_PROTOCOL_ERROR,
      error.message,
      error,
      500,
    );
  }
  return wrapError(error);
}

async function withMobile<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    throw mapMobileError(error);
  }
}

export class YSUMobileAdapter {
  getCurrentLesson(input: CurrentLessonQuery): Promise<CurrentLesson> {
    return withMobile(async () => {
      const result = await queryCurrentLesson(input);
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
      };
    });
  }

  getSigninDetail(input: SigninDetailQuery): Promise<SigninActivityDetail> {
    return withMobile(async () => {
      const result = await querySigninDetail(input);
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
      };
    });
  }

  getStudentSigninStatus(input: SigninDetailQuery): Promise<StudentSigninStatus> {
    return withMobile(async () => {
      const result = await queryStudentSigninStatus(input);
      return {
        signStatus: result.signStatus,
        attendanceStatus: result.attendanceStatus,
        signOrder: result.signOrder,
        signinType: result.signinType,
        raw: result.raw,
      };
    });
  }

  doStudentSign(input: StudentSignInput): Promise<StudentSignResult> {
    return withMobile(async () => {
      const result = await studentSign(input);
      return {
        signStatus: result.signStatus,
        attendanceStatus: result.attendanceStatus,
        signOrder: result.signOrder,
        signinType: result.signinType,
        raw: result.raw,
      };
    });
  }
}
