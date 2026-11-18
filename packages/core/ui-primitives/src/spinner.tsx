import * as React from "react"
import { Loader2Icon } from "lucide-react"

import { cn } from "./utils"

function Spinner({ className, label, ...props }: React.ComponentProps<"svg"> & { label?: string }) {
  return (
    <Loader2Icon
      role="status"
      aria-label={props["aria-label"] ?? label}
      className={cn("size-4 animate-spin", className)}
      {...props}
    />
  )
}

export { Spinner }
