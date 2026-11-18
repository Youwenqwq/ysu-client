import { Toaster as Sonner, type ToasterProps } from "sonner"
import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react"

import { useIsMobile } from "./use-mobile"
import type { CSSCustomProperties } from "./utils"

function Toaster({ theme = "system", style, ...props }: ToasterProps) {
  const isMobile = useIsMobile()
  const toasterStyle: CSSCustomProperties = {
    "--normal-bg": "var(--popover)",
    "--normal-text": "var(--popover-foreground)",
    "--normal-border": "var(--border)",
    "--border-radius": "var(--radius)",
    ...(isMobile ? { "--width": "min(20rem, calc(100vw - 2rem))" } : {}),
    ...style,
  }

  return (
    <Sonner
      theme={theme}
      className="toaster group"
      position={isMobile ? "top-center" : "bottom-right"}
      mobileOffset={{
        top: "calc(0.5rem + var(--safe-area-inset-top, env(safe-area-inset-top)))",
        bottom: "0.5rem",
        left: "0.75rem",
        right: "0.75rem",
      }}
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={toasterStyle}
      toastOptions={{
        classNames: {
          toast: isMobile ? "cn-toast cn-toast-mobile" : "cn-toast",
        },
      }}
      {...props}
    />
  )
}

export { Toaster, type ToasterProps }
