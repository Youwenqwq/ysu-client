import { getAvailableSchools } from "@/lib/server-config"
import { providerRegistry } from "./provider-registry"

export function getSelectableSchools(): Array<{
  id: string
  name: string
  nameEn: string
}> {
  return getAvailableSchools().filter((school) => providerRegistry.hasProvider(school.id))
}
