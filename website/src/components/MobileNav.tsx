import { useState, useEffect, useRef } from "react"
import { Menu, X } from "lucide-react"

interface NavItem {
  label: string
  href: string
}

interface MobileNavProps {
  items: NavItem[]
}

export default function MobileNav({ items }: MobileNavProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener("mousedown", handleClick)
    return () => document.removeEventListener("mousedown", handleClick)
  }, [open])

  return (
    <div ref={ref} className="relative md:hidden">
      <button
        onClick={() => setOpen(!open)}
        className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
      </button>

      {open && (
        <div className="absolute top-full right-0 z-50 mt-2 w-48 overflow-hidden rounded-lg border border-border bg-background shadow-lg">
          <nav className="flex flex-col">
            {items.map((item) => (
              <a
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className="px-4 py-3 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                {item.label}
              </a>
            ))}
          </nav>
        </div>
      )}
    </div>
  )
}
