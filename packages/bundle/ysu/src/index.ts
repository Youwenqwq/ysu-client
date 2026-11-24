import { defineBundle } from "@orahako/sdk"
import identity from "./identity.json"

const schoolId = "ysu"

export const ysuBundle = defineBundle({
  id: "orahako.bundle.ysu",
  identity,
  market: {
    indexUrl:
      "https://raw.githubusercontent.com/Youwenqwq/orahako-plugin-registry/main/dist/plugins.json",
  },
  defaults: { schoolId },
  plugins: [{ id: "ysu.provider", protected: true }],
  patches: [
    { id: "orahako.runtime.session", config: { defaultSchoolId: schoolId }, protected: true },
    { id: "orahako.runtime.provider", config: { defaultSchoolId: schoolId }, protected: true },
  ],
})
