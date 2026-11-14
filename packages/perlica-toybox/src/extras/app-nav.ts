export const PERLICA_TABS = ["map", "ride", "history", "account"] as const

export type PerlicaTab = (typeof PERLICA_TABS)[number]

export function isPerlicaTab(value: string | null | undefined): value is PerlicaTab {
  return (
    value !== null && value !== undefined && (PERLICA_TABS as readonly string[]).includes(value)
  )
}

export function perlicaTab(params: Pick<URLSearchParams, "get">): PerlicaTab {
  const tab = params.get("tab")
  return isPerlicaTab(tab) ? tab : "map"
}
