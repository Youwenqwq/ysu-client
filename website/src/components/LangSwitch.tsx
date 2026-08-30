import { useState, useEffect } from "react"
import { Globe } from "lucide-react"

interface LangSwitchProps {
  currentLang: string
  switchLabel: string
  switchUrl: string
}

export default function LangSwitch({ currentLang, switchLabel, switchUrl }: LangSwitchProps) {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) {
    return (
      <button
        className="rounded-lg p-2 transition-colors hover:bg-muted"
        aria-label="Switch language"
      >
        <Globe className="h-5 w-5" />
      </button>
    )
  }

  return (
    <a
      href={switchUrl}
      className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition-colors hover:bg-muted"
      aria-label="Switch language"
    >
      <Globe className="h-4 w-4" />
      <span>{switchLabel}</span>
    </a>
  )
}
