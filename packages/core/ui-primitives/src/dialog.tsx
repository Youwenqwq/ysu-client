import * as React from "react"
import { Dialog as DialogPrimitive } from "radix-ui"
import { XIcon } from "lucide-react"

import { BackLayer, useBackOpenState } from "./back-layer"
import { Button } from "./button"
import { cn } from "./utils"

export interface DialogScopeConfig {
  /** Portal container for scoped dialogs (e.g. a window frame in a multi-window shell). */
  readonly container?: HTMLElement | null
  /**
   * When true, dialogs run in non-modal Radix mode (`modal={false}`) so other windows
   * and the desktop taskbar stay interactive while a scoped overlay blocks only the
   * owning parent window.
   */
  readonly scopedModal?: boolean
}

const DialogScopeContext = React.createContext<DialogScopeConfig | null>(null)

export interface DialogScopeProviderProps extends DialogScopeConfig {
  readonly children: React.ReactNode
}

function DialogScopeProvider({ container, scopedModal, children }: DialogScopeProviderProps) {
  const value = React.useMemo<DialogScopeConfig>(
    () => ({ container, scopedModal }),
    [container, scopedModal]
  )
  return <DialogScopeContext.Provider value={value}>{children}</DialogScopeContext.Provider>
}

function useDialogScope(): DialogScopeConfig | null {
  return React.useContext(DialogScopeContext)
}

function Dialog(props: React.ComponentProps<typeof DialogPrimitive.Root>) {
  const scope = useDialogScope()
  const { open, onOpenChange } = useBackOpenState(props)
  const modal = props.modal ?? (scope?.scopedModal ? false : undefined)
  return (
    <BackLayer enabled={open} onBack={() => onOpenChange(false)}>
      <DialogPrimitive.Root
        data-slot="dialog"
        {...props}
        {...(modal !== undefined ? { modal } : {})}
        open={open}
        onOpenChange={onOpenChange}
      />
    </BackLayer>
  )
}

function DialogTrigger({ ...props }: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({ container, ...props }: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  const scope = useDialogScope()
  const resolvedContainer = container ?? scope?.container ?? undefined
  return (
    <DialogPrimitive.Portal
      data-slot="dialog-portal"
      {...(resolvedContainer ? { container: resolvedContainer } : {})}
      {...props}
    />
  )
}

function DialogClose({ ...props }: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 isolate z-50 bg-black/10 duration-100 supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
        className
      )}
      {...props}
    />
  )
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  closeLabel,
  onInteractOutside,
  onPointerDownOutside,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean
  closeLabel?: string
}) {
  const scope = useDialogScope()
  const isScoped = Boolean(scope?.scopedModal)
  const [flashing, setFlashing] = React.useState(false)

  const triggerBlockedFlash = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.stopPropagation()
    setFlashing(false)
    if (typeof window !== "undefined") {
      window.requestAnimationFrame(() => setFlashing(true))
    }
  }, [])

  return (
    <DialogPortal>
      {isScoped ? (
        <div
          data-slot="dialog-overlay"
          data-scoped-modal="true"
          className="absolute inset-0 z-30 bg-transparent"
          onPointerDown={triggerBlockedFlash}
          onClick={(event) => event.stopPropagation()}
        />
      ) : (
        <DialogOverlay />
      )}
      <DialogPrimitive.Content
        data-slot="dialog-content"
        data-scoped-modal={isScoped ? "true" : undefined}
        data-modal-flash={flashing ? "true" : undefined}
        onAnimationEnd={() => {
          if (flashing) setFlashing(false)
        }}
        onPointerDownOutside={(event) => {
          if (isScoped) {
            event.preventDefault()
          }
          onPointerDownOutside?.(event)
        }}
        onInteractOutside={(event) => {
          if (isScoped) {
            event.preventDefault()
          }
          onInteractOutside?.(event)
        }}
        className={cn(
          isScoped
            ? "absolute top-1/2 left-1/2 z-31 grid w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-xl bg-popover p-4 text-sm text-popover-foreground ring-1 ring-foreground/10 outline-none sm:max-w-sm"
            : "fixed top-1/2 left-1/2 z-50 grid w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-xl bg-popover p-4 text-sm text-popover-foreground ring-1 ring-foreground/10 duration-100 outline-none sm:max-w-sm data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          className
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close data-slot="dialog-close" asChild>
            <Button
              variant="ghost"
              className="absolute top-2 right-2"
              size="icon-sm"
              aria-label={closeLabel}
            >
              <XIcon />
              {closeLabel ? <span className="sr-only">{closeLabel}</span> : null}
            </Button>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div data-slot="dialog-header" className={cn("flex flex-col gap-2", className)} {...props} />
  )
}

function DialogFooter({
  className,
  showCloseButton = false,
  closeLabel,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean
  closeLabel?: React.ReactNode
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "-mx-4 -mb-4 flex flex-col-reverse gap-2 rounded-b-xl border-t bg-muted/50 p-4 sm:flex-row sm:justify-end",
        className
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close asChild>
          <Button variant="outline">{closeLabel}</Button>
        </DialogPrimitive.Close>
      )}
    </div>
  )
}

function DialogTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("font-heading text-base leading-none font-medium", className)}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(
        "text-sm text-muted-foreground *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground",
        className
      )}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogScopeProvider,
  DialogTitle,
  DialogTrigger,
  useDialogScope,
}
