import type { DerivedComponentProps } from "@orahako/sdk"
import type { helloDictionary } from "./index"

export function HelloPage({ t }: DerivedComponentProps<Record<string, never>, typeof helloDictionary>) {
  return (
    <main className="hello-plugin">
      <h2>{t("hello.title")}</h2>
      <p>{t("hello.greeting", { name: "Orahako" })}</p>
    </main>
  )
}
