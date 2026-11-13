import type { ProviderGPAScale } from "@orahako/plugin-sdk/academic"

/**
 * 遵义医科大学平均绩点的客户端诠释，非官方字母定级。
 * 绩点锚点来源：《遵义医科大学本科学生学籍管理办法（试行）》第二十六条。
 * https://www.zmu.edu.cn/info/1100/23519.htm
 */
export const ZMU_GPA_SCALE: ProviderGPAScale = {
  max: 5,
  bands: [
    { min: 0, letter: "F" },
    { min: 1, letter: "D" },
    { min: 2, letter: "C" },
    { min: 3, letter: "B" },
    { min: 4, letter: "A" },
    { min: 4.5, letter: "A+" },
  ],
}
