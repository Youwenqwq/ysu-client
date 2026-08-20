"use client";

import * as React from "react";
import { useEffect, useState } from "react";
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

// Root 与子件共享同一个 isMobile：每个组件各自调用 useIsMobile 时，
// 多个 matchMedia 监听器的 setState 不一定落在同一批提交里，
// 断点跨越瞬间可能出现 Root=Drawer + Content=DialogContent 的混合渲染
// （`DialogPortal` must be used within `Dialog`）。
const ResponsiveModalMobileContext = React.createContext<boolean>(false);

function useResponsiveModalIsMobile(): boolean {
  return React.useContext(ResponsiveModalMobileContext);
}

export function ResponsiveModal({ open, onOpenChange, children }: ResponsiveModalProps) {
  const isMobile = useIsMobile();
  return (
    <ResponsiveModalMobileContext.Provider value={isMobile}>
      {isMobile ? (
        <Drawer open={open} onOpenChange={onOpenChange}>
          {children}
        </Drawer>
      ) : (
        <Dialog open={open} onOpenChange={onOpenChange}>
          {children}
        </Dialog>
      )}
    </ResponsiveModalMobileContext.Provider>
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
  const isMobile = useResponsiveModalIsMobile();
  const [maxHeight, setMaxHeight] = useState<number | undefined>(undefined);

  useEffect(() => {
    if (!isMobile) return;
    const vp = window.visualViewport;
    if (!vp) return;
    const update = () => setMaxHeight(Math.floor(vp.height * 0.92));
    update();
    vp.addEventListener("resize", update);
    return () => vp.removeEventListener("resize", update);
  }, [isMobile]);

  if (isMobile) {
    return (
      <DrawerContent
        className={cn("max-h-[92dvh]", drawerClassName)}
        style={maxHeight != null ? { maxHeight } : undefined}
      >
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
  const isMobile = useResponsiveModalIsMobile();
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
  const isMobile = useResponsiveModalIsMobile();
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
  const isMobile = useResponsiveModalIsMobile();
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
  const isMobile = useResponsiveModalIsMobile();
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
  const isMobile = useResponsiveModalIsMobile();
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
