import { getAvailableSchools } from "@/lib/server-config"
import { hasProvider } from "./provider-registry"

export function getSelectableSchools(): Array<{
  id: string
  name: string
  nameEn: string
}> {
  return getAvailableSchools().filter((school) => hasProvider(school.id))
}
