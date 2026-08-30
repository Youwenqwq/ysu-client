import { useState, useEffect } from "react"
import { Sun, Moon } from "lucide-react"

export default function ThemeToggle() {
  const [isDark, setIsDark] = useState(false)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    const saved = localStorage.getItem("theme")
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches
    const isDarkMode = saved === "dark" || (!saved && prefersDark)
    setIsDark(isDarkMode)
    document.documentElement.classList.toggle("dark", isDarkMode)
  }, [])

  const toggle = () => {
    const next = !isDark
    setIsDark(next)
    document.documentElement.classList.toggle("dark", next)
    localStorage.setItem("theme", next ? "dark" : "light")
  }

  if (!mounted) {
    return (
      <button className="rounded-lg p-2 transition-colors hover:bg-muted" aria-label="Toggle theme">
        <Sun className="h-5 w-5" />
      </button>
    )
  }

  return (
    <button
      onClick={toggle}
      className="rounded-lg p-2 transition-colors hover:bg-muted"
      aria-label="Toggle theme"
    >
      {isDark ? <Moon className="h-5 w-5" /> : <Sun className="h-5 w-5" />}
    </button>
  )
}
