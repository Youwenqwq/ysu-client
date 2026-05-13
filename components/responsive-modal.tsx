"use client";

import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";

interface ResponsiveModalProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: React.ReactNode;
}

export function ResponsiveModal({ open, onOpenChange, children }: ResponsiveModalProps) {
  const isMobile = useIsMobile();
  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        {children}
      </Drawer>
    );
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {children}
    </Dialog>
  );
}

interface ResponsiveModalContentProps extends React.HTMLAttributes<HTMLDivElement> {
  drawerClassName?: string;
}

export function ResponsiveModalContent({
  className,
  drawerClassName,
  children,
  ...props
}: ResponsiveModalContentProps) {
  const isMobile = useIsMobile();
  if (isMobile) {
    return (
      <DrawerContent className={cn("max-h-[92svh]", drawerClassName)}>
        {children}
      </DrawerContent>
    );
  }
  return (
    <DialogContent className={className} {...props}>
      {children}
    </DialogContent>
  );
}

export function ResponsiveModalHeader({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  const isMobile = useIsMobile();
  if (isMobile) {
    return (
      <DrawerHeader className={className} {...props}>
        {children}
      </DrawerHeader>
    );
  }
  return (
    <DialogHeader className={className} {...props}>
      {children}
    </DialogHeader>
  );
}

export function ResponsiveModalTitle({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLHeadingElement>) {
  const isMobile = useIsMobile();
  if (isMobile) {
    return (
      <DrawerTitle className={className} {...props}>
        {children}
      </DrawerTitle>
    );
  }
  return (
    <DialogTitle className={className} {...props}>
      {children}
    </DialogTitle>
  );
}

export function ResponsiveModalDescription({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  const isMobile = useIsMobile();
  if (isMobile) {
    return (
      <DrawerDescription className={className} {...props}>
        {children}
      </DrawerDescription>
    );
  }
  return (
    <DialogDescription className={className} {...props}>
      {children}
    </DialogDescription>
  );
}

interface ResponsiveModalFooterProps extends React.HTMLAttributes<HTMLDivElement> {
  drawerClassName?: string;
}

export function ResponsiveModalFooter({
  className,
  drawerClassName,
  children,
  ...props
}: ResponsiveModalFooterProps) {
  const isMobile = useIsMobile();
  if (isMobile) {
    return (
      <DrawerFooter className={cn(drawerClassName)} {...props}>
        {children}
      </DrawerFooter>
    );
  }
  return (
    <DialogFooter className={className} {...props}>
      {children}
    </DialogFooter>
  );
}

interface ResponsiveModalBodyProps extends React.HTMLAttributes<HTMLDivElement> {
  drawerClassName?: string;
}

export function ResponsiveModalBody({
  className,
  drawerClassName,
  children,
  ...props
}: ResponsiveModalBodyProps) {
  const isMobile = useIsMobile();
  if (isMobile) {
    return (
      <div
        className={cn(
          "min-h-0 flex-1 overflow-y-auto px-4 pb-2",
          className,
          drawerClassName,
        )}
        {...props}
      >
        {children}
      </div>
    );
  }
  return (
    <div className={className} {...props}>
      {children}
    </div>
  );
}
