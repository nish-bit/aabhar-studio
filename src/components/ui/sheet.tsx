"use client";

import * as React from "react";
import { Dialog as SheetPrimitive } from "radix-ui";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";

function Sheet(props: React.ComponentProps<typeof SheetPrimitive.Root>) {
  return <SheetPrimitive.Root data-slot="sheet" {...props} />;
}
function SheetTrigger(props: React.ComponentProps<typeof SheetPrimitive.Trigger>) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />;
}
function SheetClose(props: React.ComponentProps<typeof SheetPrimitive.Close>) {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} />;
}

type Side = "top" | "right" | "bottom" | "left";

const sideClasses: Record<Side, string> = {
  right:
    "inset-y-0 right-0 h-full w-[88%] max-w-sm border-l data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right",
  left: "inset-y-0 left-0 h-full w-[88%] max-w-sm border-r data-[state=open]:slide-in-from-left data-[state=closed]:slide-out-to-left",
  top: "inset-x-0 top-0 border-b data-[state=open]:slide-in-from-top data-[state=closed]:slide-out-to-top",
  bottom:
    "inset-x-0 bottom-0 max-h-[85dvh] rounded-t-lg border-t data-[state=open]:slide-in-from-bottom data-[state=closed]:slide-out-to-bottom",
};

function SheetContent({
  className,
  children,
  side = "right",
  closeLabel = "Close",
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Content> & { side?: Side; closeLabel?: string }) {
  return (
    <SheetPrimitive.Portal>
      <SheetPrimitive.Overlay className="fixed inset-0 z-50 bg-ink-900/40 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
      <SheetPrimitive.Content
        data-slot="sheet-content"
        className={cn(
          "fixed z-50 flex flex-col gap-4 border-ink-200 bg-surface shadow-lg",
          "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:duration-300 data-[state=closed]:duration-200",
          sideClasses[side],
          className,
        )}
        {...props}
      >
        {children}
        <SheetPrimitive.Close className="absolute right-4 top-4 inline-flex size-10 items-center justify-center rounded-sm text-ink-600 transition-colors hover:bg-ink-100 hover:text-ink-900">
          <X className="size-5" aria-hidden />
          <span className="sr-only">{closeLabel}</span>
        </SheetPrimitive.Close>
      </SheetPrimitive.Content>
    </SheetPrimitive.Portal>
  );
}

function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="sheet-header" className={cn("flex flex-col gap-1 p-6 pb-0", className)} {...props} />;
}
function SheetTitle({ className, ...props }: React.ComponentProps<typeof SheetPrimitive.Title>) {
  return (
    <SheetPrimitive.Title data-slot="sheet-title" className={cn("text-heading-md text-ink-900", className)} {...props} />
  );
}
function SheetDescription({ className, ...props }: React.ComponentProps<typeof SheetPrimitive.Description>) {
  return (
    <SheetPrimitive.Description
      data-slot="sheet-description"
      className={cn("text-body-sm text-ink-600", className)}
      {...props}
    />
  );
}

export { Sheet, SheetTrigger, SheetClose, SheetContent, SheetHeader, SheetTitle, SheetDescription };
