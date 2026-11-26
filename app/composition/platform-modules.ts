import * as primitives from "@orahako/ui-primitives"
import * as sdk from "@orahako/sdk"
import type { PlatformModuleSpecifier } from "@orahako/sdk"
import * as react from "react"
import * as reactDom from "react-dom"
import * as reactDomClient from "react-dom/client"
import * as jsxRuntime from "react/jsx-runtime"
import * as sonner from "sonner"

export const platformModules = {
  react,
  "react-dom": reactDom,
  "react-dom/client": reactDomClient,
  "react/jsx-runtime": jsxRuntime,
  sonner,
  "@orahako/sdk": sdk,
  "@orahako/ui-primitives": primitives,
} satisfies Record<PlatformModuleSpecifier, object>
