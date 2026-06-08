import ysuConfig from './ysu.json';
import nbuConfig from './nbu.json';
import type { SchoolConfig } from './types';

export const DEFAULT_SCHOOL_ID = 'ysu';

const bundledSchoolConfigs = [
  ysuConfig as SchoolConfig,
  nbuConfig as SchoolConfig,
] as const;

const schoolConfigs: Record<string, SchoolConfig> = Object.fromEntries(
  bundledSchoolConfigs.map((config) => [config.id, config]),
);

export function registerSchoolConfig(config: SchoolConfig): void {
  schoolConfigs[config.id] = config;
}

export function getSchoolConfigById(schoolId: string): SchoolConfig | undefined {
  return schoolConfigs[schoolId];
}

export function hasSchoolConfig(schoolId: string): boolean {
  return Object.prototype.hasOwnProperty.call(schoolConfigs, schoolId);
}

export function getAllSchoolConfigs(): readonly SchoolConfig[] {
  return Object.values(schoolConfigs);
}

export function getVisibleSchoolConfigs(): readonly SchoolConfig[] {
  return getAllSchoolConfigs().filter((config) => config.visible);
}
