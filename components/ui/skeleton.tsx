import { cn } from "@/lib/utils"

/** Loading texture: a scanline block instead of a soft pulse. */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("hud-scan animate-pulse rounded-none bg-muted", className)}
      {...props}
    />
  )
}

export { Skeleton }
