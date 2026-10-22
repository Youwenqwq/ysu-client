import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * Instrument input: 1px hairline at rest, 2px ink on focus, hard shadow on focus only.
 * 1px at rest keeps six stacked fields from reading as a wireframe.
 */
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-8 w-full min-w-0 rounded-none border border-input bg-background px-2.5 py-1 text-base transition-[border-color,box-shadow,background-color] outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:font-mono placeholder:text-[0.8rem] placeholder:tracking-wide placeholder:text-muted-foreground focus-visible:border-edge focus-visible:shadow-xs disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/40 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/20 dark:disabled:bg-input/40",
        className
      )}
      {...props}
    />
  )
}

export { Input }
