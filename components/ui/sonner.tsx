"use client"

import { useTheme } from "next-themes"
import { Toaster as Sonner, type ToasterProps } from "sonner"
import {
  CircleCheckIcon,
  InfoIcon,
  TriangleAlertIcon,
  OctagonXIcon,
  Loader2Icon,
} from "lucide-react"
import { useIsMobile } from "@/hooks/use-mobile"

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()
  const isMobile = useIsMobile()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
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
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--edge)",
          "--border-radius": "0px",
          ...(isMobile ? { "--width": "min(20rem, calc(100vw - 2rem))" } : {}),
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: isMobile
            ? "cn-toast cn-toast-mobile rounded-none! border-2! border-edge! shadow-md!"
            : "cn-toast rounded-none! border-2! border-edge! shadow-md!",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
