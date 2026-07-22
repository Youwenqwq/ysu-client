import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { Grade } from "../../providers/types";
import { STORAGE_KEYS } from "../storage/keys";

/** 待抽取的新成绩(快照自 Grade,避免持久化整行原始数据) */
export interface PendingGrade {
  key: string;
  courseName: string;
  semester?: string;
  score?: string;
  numericScore?: number;
  gradeLevel?: string;
  credit?: string;
  isPass: boolean;
}

export function gradeKey(g: {
  courseName: string;
  courseCode?: string;
  semester?: string;
}): string {
  return `${g.semester ?? ""}|${g.courseCode ?? ""}|${g.courseName}`;
}

/** 成绩签名:已出分返回分数/等级,未出分返回空串。 */
function gradeSignature(g: Grade): string {
  return g.score || g.gradeLevel || "";
}

interface GradeGachaState {
  /** 已展示给用户的成绩签名基线(key -> 签名),diff 以此为旧数据。 */
  seenSignatures: Record<string, string>;
  /** 待抽取的新成绩;非空时成绩页保持旧数据展示并弹出抽卡。 */
  pending: PendingGrade[];
  hasHydrated: boolean;
  /** 首次运行:以当前成绩为基线,不触发抽取。 */
  setBaseline: (grades: Grade[]) => void;
  /** 将 diff 出的新成绩加入待抽取队列(按 key 去重)。 */
  stagePending: (grades: Grade[]) => void;
  /** 收下全部:pending 并入基线并清空,页面切换为最新数据。 */
  commitPending: () => void;
  setHasHydrated: (v: boolean) => void;
}

export const useGradeGachaStore = create<GradeGachaState>()(
  persist(
    (set) => ({
      seenSignatures: {},
      pending: [],
      hasHydrated: false,

      setBaseline: (grades) =>
        set({
          seenSignatures: Object.fromEntries(
            grades.map((g) => [gradeKey(g), gradeSignature(g)]),
          ),
        }),

      stagePending: (grades) =>
        set((s) => {
          const staged = new Set(s.pending.map((p) => p.key));
          const additions: PendingGrade[] = [];
          for (const g of grades) {
            const sig = gradeSignature(g);
            if (!sig) continue; // 未出分
            const key = gradeKey(g);
            if (staged.has(key)) continue;
            const seenSig = s.seenSignatures[key];
            // 仅识别"新发布":新课程出分,或原有课程由无分变为有分;成绩修订不算
            if (seenSig !== undefined && seenSig !== "") continue;
            additions.push({
              key,
              courseName: g.courseName,
              semester: g.semester,
              score: g.score,
              numericScore: g.numericScore,
              gradeLevel: g.gradeLevel,
              credit: g.credit,
              isPass: g.isPass,
            });
            staged.add(key);
          }
          return additions.length > 0
            ? { pending: [...s.pending, ...additions] }
            : {};
        }),

      commitPending: () =>
        set((s) => {
          if (s.pending.length === 0) return {};
          const seenSignatures = { ...s.seenSignatures };
          for (const p of s.pending) {
            seenSignatures[p.key] = p.score || p.gradeLevel || "";
          }
          return { seenSignatures, pending: [] };
        }),

      setHasHydrated: (hasHydrated) => set({ hasHydrated }),
    }),
    {
      name: STORAGE_KEYS.gradeGacha,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        seenSignatures: s.seenSignatures,
        pending: s.pending,
      }),
      onRehydrateStorage: () => (state) => state?.setHasHydrated(true),
    },
  ),
);
