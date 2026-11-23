import type { CreditBatch } from "@orahako/academic-sdk"
import type { Translator } from "@orahako/sdk"
import type { CreditsDictionary } from "./dictionary"

export const CURRENT_BATCH_VALUE = "__current"

export function getBatchFilters(
  batches: readonly CreditBatch[],
  batch: string | undefined,
  t: Translator<CreditsDictionary>
) {
  const chips = [
    { value: CURRENT_BATCH_VALUE, label: batches[0]?.name ?? t("credits.batch") },
    { value: "all", label: t("credits.allBatches") },
    ...batches.slice(1).map((item) => ({ value: item.batchId, label: item.name })),
  ]
  const activeValue = batch ?? CURRENT_BATCH_VALUE
  const activeLabel = chips.find((chip) => chip.value === activeValue)?.label ?? t("credits.batch")
  return { chips, activeValue, activeLabel }
}
