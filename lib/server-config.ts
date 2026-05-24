/**
 * 集中管理服务器 Base URL 配置。
 *
 * 运行时可变对象 + getter 对象，支持用户自定义服务器地址。
 * 修改后需重新登录才能生效（cookie 域名变更）。
 */

import ysuConfig from './school-configs/ysu.json';
import nbuConfig from './school-configs/nbu.json';

// ─── Types ────────────────────────────────────────────────────────────── //

export interface SchoolConfig {
  readonly id: string;
  readonly name: string;
  readonly nameEn: string;
  readonly cas: {
    readonly cerBaseUrl: string;
    readonly aesChars: string;
    readonly mfaMethodToCode: Readonly<Record<string, string>>;
    readonly mfaMethodToAuthCodeType: Readonly<Record<string, string>>;
  };
  readonly jwxt: {
    readonly jwxtBaseUrl: string;
    readonly portalPath: string;
    readonly appShowPath: string;
    readonly appIds: Readonly<Record<string, string>>;
    readonly apiPaths: Readonly<Record<string, string>>;
  };
  readonly features: {
    readonly hasMobile: boolean;
    readonly hasLabSchedule: boolean;
    readonly hasMfa: boolean;
  };
}

// ─── Available school configs ──────────────────────────────────────────── //

const schoolConfigs: Readonly<Record<string, SchoolConfig>> = {
  ysu: ysuConfig as SchoolConfig,
  nbu: nbuConfig as SchoolConfig,
};

let currentSchoolId = 'ysu';
let currentSchoolConfig: SchoolConfig = ysuConfig as SchoolConfig;

// ─── Mutable config ────────────────────────────────────────────────────── //

export const serverConfig = {
  get cerBaseUrl() {
    return serverConfig._customCerBaseUrl || currentSchoolConfig.cas.cerBaseUrl;
  },
  get jwxtBaseUrl() {
    return serverConfig._customJwxtBaseUrl || currentSchoolConfig.jwxt.jwxtBaseUrl;
  },
  _customCerBaseUrl: '',
  _customJwxtBaseUrl: '',
};

// ─── URL getters ───────────────────────────────────────────────────────── //

export const casUrls = {
  get cerBase() { return serverConfig.cerBaseUrl; },
  get authLogin() { return `${serverConfig.cerBaseUrl}/authserver/login`; },
  get authIndex() { return `${serverConfig.cerBaseUrl}/authserver/index.do`; },
  get checkCaptcha() { return `${serverConfig.cerBaseUrl}/authserver/checkNeedCaptcha.htl`; },
  get captcha() { return `${serverConfig.cerBaseUrl}/authserver/getCaptcha.htl`; },
  get reauthType() { return `${serverConfig.cerBaseUrl}/authserver/reAuthCheck/changeReAuthType.do`; },
  get reauthSendCode() { return `${serverConfig.cerBaseUrl}/authserver/dynamicCode/getDynamicCodeByReauth.do`; },
  get reauthSubmit() { return `${serverConfig.cerBaseUrl}/authserver/reAuthCheck/reAuthSubmit.do`; },
  get defaultLoginService() { return `${serverConfig.cerBaseUrl}/personalInfo/personCenter/index.html`; },
};

export const jwxtUrls = {
  get jwxtBase() { return serverConfig.jwxtBaseUrl; },
  get appBase() { return `${serverConfig.jwxtBaseUrl}/jwapp/sys`; },
  get portal() { return `${serverConfig.jwxtBaseUrl}${currentSchoolConfig.jwxt.portalPath}`; },
  get appShow() { return `${serverConfig.jwxtBaseUrl}${currentSchoolConfig.jwxt.appShowPath}`; },
};

export const mobileUrls = {
  get apiBase() { return `${serverConfig.jwxtBaseUrl}/jwmobile/biz/v410`; },
  get auth() { return `${serverConfig.jwxtBaseUrl}/jwmobile/auth/index`; },
  get cookieDomain() { return getJwxtCookieDomain(); },
  cookiePath: '/jwmobile',
};

// ─── School config accessors ───────────────────────────────────────────── //

export function getSchoolConfig(): SchoolConfig {
  return currentSchoolConfig;
}

export function getSchoolId(): string {
  return currentSchoolId;
}

export function isFeatureAvailable(feature: keyof SchoolConfig['features']): boolean {
  return currentSchoolConfig.features[feature];
}

export function getAvailableSchools(): Array<{ id: string; name: string; nameEn: string }> {
  return Object.values(schoolConfigs).map((c) => ({
    id: c.id,
    name: c.name,
    nameEn: c.nameEn,
  }));
}

export function setSchoolConfig(schoolId: string): boolean {
  const config = schoolConfigs[schoolId];
  if (!config) return false;
  currentSchoolId = schoolId;
  currentSchoolConfig = config;
  // Reset custom URLs when switching school
  serverConfig._customCerBaseUrl = '';
  serverConfig._customJwxtBaseUrl = '';
  // Notify dependent modules to refresh their caches
  onSchoolConfigChanged();
  return true;
}

// Callbacks for modules that cache school config
type SchoolConfigChangeCallback = () => void;
const _onSchoolConfigChanged: SchoolConfigChangeCallback[] = [];

export function onSchoolConfigChanged(callback?: SchoolConfigChangeCallback): void {
  if (callback) {
    _onSchoolConfigChanged.push(callback);
  } else {
    // Notify all registered callbacks
    for (const cb of _onSchoolConfigChanged) {
      cb();
    }
  }
}

// ─── Domain extraction ─────────────────────────────────────────────────── //

export function getCasCookieDomain(): string {
  try { return new URL(serverConfig.cerBaseUrl).hostname; }
  catch { return 'cer.ysu.edu.cn'; }
}

export function getJwxtCookieDomain(): string {
  try { return new URL(serverConfig.jwxtBaseUrl).hostname; }
  catch { return 'jwxt.ysu.edu.cn'; }
}

// ─── Init / reset ──────────────────────────────────────────────────────── //

export function initServerConfig(): void {
  try {
    const raw = localStorage.getItem('ysu-settings');
    if (!raw) return;
    const parsed = JSON.parse(raw);

    // Load school ID first
    if (parsed.state?.schoolId) {
      setSchoolConfig(parsed.state.schoolId);
    }

    // Load custom URLs (these override school defaults)
    if (parsed.state?.customCerBaseUrl) {
      serverConfig._customCerBaseUrl = parsed.state.customCerBaseUrl;
    }
    if (parsed.state?.customJwxtBaseUrl) {
      serverConfig._customJwxtBaseUrl = parsed.state.customJwxtBaseUrl;
    }
  } catch { /* ignore */ }
}

export function resetServerConfig(): void {
  serverConfig._customCerBaseUrl = '';
  serverConfig._customJwxtBaseUrl = '';
}

export function applyServerConfig(cerBaseUrl: string, jwxtBaseUrl: string): void {
  serverConfig._customCerBaseUrl = cerBaseUrl;
  serverConfig._customJwxtBaseUrl = jwxtBaseUrl;
}
