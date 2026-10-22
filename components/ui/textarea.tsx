import * as React from "react"

import { cn } from "@/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-16 w-full rounded-none border border-input bg-background px-2.5 py-2 text-base transition-[border-color,box-shadow,background-color] outline-none placeholder:font-mono placeholder:text-[0.8rem] placeholder:tracking-wide placeholder:text-muted-foreground focus-visible:border-edge focus-visible:shadow-xs disabled:cursor-not-allowed disabled:bg-input/40 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/20 dark:disabled:bg-input/40",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
