import type { DashboardFeature } from "@/lib/dashboard-features"
import { ecardFeature } from "./ecard/feature"
import { meterFeature } from "./meter/feature"
import { epayFeature } from "./epay/feature"

/** Shared ordering for the profile page and desktop sidebar. */
export const FEE_FEATURES: DashboardFeature[] = [ecardFeature, meterFeature, epayFeature]
