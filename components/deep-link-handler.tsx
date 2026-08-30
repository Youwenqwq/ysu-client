"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { isCapacitor } from "@/lib/native/platform"

export function DeepLinkHandler() {
  const router = useRouter()

  useEffect(() => {
    if (!isCapacitor()) return

    let removeListener: (() => void) | undefined

    function handleUrl(url: string) {
      try {
        const parsed = new URL(url)
        if (parsed.protocol === "ysuclient:") {
          if (parsed.host === "schedule") {
            router.push("/dashboard/schedule")
          } else if (parsed.host === "exams") {
            router.push("/dashboard/exams")
          }
        }
      } catch {
        // Ignore invalid URLs
      }
    }

    import("@capacitor/app").then(({ App }) => {
      // Handle cold-start deep link
      App.getLaunchUrl().then((result) => {
        if (result?.url) handleUrl(result.url)
      })

      // Handle warm-start deep link
      App.addListener("appUrlOpen", ({ url }) => {
        handleUrl(url)
      }).then((listener) => {
        removeListener = listener.remove
      })
    })

    return () => {
      removeListener?.()
    }
  }, [router])

  return null
}
