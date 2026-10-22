import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

/**
 * HUD tag: rectangular, mono, uppercase-ish tracking. Never a pill.
 */
const badgeVariants = cva(
  "group/badge inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-none border px-1.5 py-0.5 font-mono text-[0.65rem] font-medium tracking-wide whitespace-nowrap transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/60 has-data-[icon=inline-end]:pr-1 has-data-[icon=inline-start]:pl-1 aria-invalid:border-destructive [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        default: "border-edge bg-primary text-primary-foreground [a]:hover:bg-primary/90",
        secondary:
          "border-edge/50 bg-secondary text-secondary-foreground [a]:hover:bg-secondary/80",
        destructive:
          "border-destructive bg-destructive/10 text-destructive [a]:hover:bg-destructive/20",
        outline: "border-edge/60 bg-transparent text-foreground [a]:hover:bg-muted",
        ghost: "border-transparent text-muted-foreground hover:bg-muted",
        brand: "border-brand bg-brand text-brand-foreground [a]:hover:bg-brand/90",
        hazard: "border-hazard bg-hazard/15 text-hazard [a]:hover:bg-hazard/25",
        link: "border-transparent text-brand underline-offset-4 hover:underline",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span"

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
