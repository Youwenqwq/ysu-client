import * as React from "react"
import { ChevronLeftIcon, ChevronRightIcon, MoreHorizontalIcon } from "lucide-react"

import { Button } from "./button"
import { cn } from "./utils"

function Pagination({
  className,
  label,
  ...props
}: React.ComponentProps<"nav"> & { label?: string }) {
  return (
    <nav
      role="navigation"
      aria-label={props["aria-label"] ?? label}
      data-slot="pagination"
      className={cn("mx-auto flex w-full justify-center", className)}
      {...props}
    />
  )
}

function PaginationContent({ className, ...props }: React.ComponentProps<"ul">) {
  return (
    <ul
      data-slot="pagination-content"
      className={cn("flex items-center gap-0.5", className)}
      {...props}
    />
  )
}

function PaginationItem({ ...props }: React.ComponentProps<"li">) {
  return <li data-slot="pagination-item" {...props} />
}

type PaginationLinkProps = {
  isActive?: boolean
} & Pick<React.ComponentProps<typeof Button>, "size"> &
  React.ComponentProps<"a">

function PaginationLink({ className, isActive, size = "icon", ...props }: PaginationLinkProps) {
  return (
    <Button asChild variant={isActive ? "outline" : "ghost"} size={size} className={cn(className)}>
      <a
        aria-current={isActive ? "page" : undefined}
        data-slot="pagination-link"
        data-active={isActive}
        {...props}
      />
    </Button>
  )
}

function PaginationPrevious({
  className,
  text,
  ariaLabel,
  ...props
}: React.ComponentProps<typeof PaginationLink> & { text?: string; ariaLabel?: string }) {
  return (
    <PaginationLink
      aria-label={props["aria-label"] ?? ariaLabel ?? text}
      size="default"
      className={cn("pl-1.5!", className)}
      {...props}
    >
      <ChevronLeftIcon data-icon="inline-start" />
      {text ? <span className="hidden sm:block">{text}</span> : null}
    </PaginationLink>
  )
}

function PaginationNext({
  className,
  text,
  ariaLabel,
  ...props
}: React.ComponentProps<typeof PaginationLink> & { text?: string; ariaLabel?: string }) {
  return (
    <PaginationLink
      aria-label={props["aria-label"] ?? ariaLabel ?? text}
      size="default"
      className={cn("pr-1.5!", className)}
      {...props}
    >
      {text ? <span className="hidden sm:block">{text}</span> : null}
      <ChevronRightIcon data-icon="inline-end" />
    </PaginationLink>
  )
}

function PaginationEllipsis({
  className,
  moreLabel,
  ...props
}: React.ComponentProps<"span"> & { moreLabel?: string }) {
  return (
    <span
      aria-hidden
      data-slot="pagination-ellipsis"
      className={cn(
        "flex size-8 items-center justify-center [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      <MoreHorizontalIcon />
      {moreLabel ? <span className="sr-only">{moreLabel}</span> : null}
    </span>
  )
}

export {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
}
