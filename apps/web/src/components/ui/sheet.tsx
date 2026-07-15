"use client";

import * as React from "react";
import { Drawer } from "@base-ui/react/drawer";

import { cn } from "@/lib/utils";

const BaseDrawerRoot = Drawer.Root;
const BaseDrawerTrigger = Drawer.Trigger;
const BaseDrawerClose = Drawer.Close;
const BaseDrawerPortal = Drawer.Portal;
const BaseDrawerBackdrop = Drawer.Backdrop;
const BaseDrawerViewport = Drawer.Viewport;
const BaseDrawerPopup = Drawer.Popup;
const BaseDrawerTitle = Drawer.Title;
const BaseDrawerDescription = Drawer.Description;

const DrawerOverlay = React.forwardRef<
  React.ElementRef<typeof BaseDrawerBackdrop>,
  React.ComponentPropsWithoutRef<typeof BaseDrawerBackdrop>
>(({ className, ...props }, ref) => (
  <BaseDrawerBackdrop
    ref={ref}
    className={cn(
      "fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className,
    )}
    {...props}
  />
));
DrawerOverlay.displayName = BaseDrawerBackdrop.displayName;

const SheetContent = React.forwardRef<
  React.ElementRef<typeof BaseDrawerPopup>,
  React.ComponentPropsWithoutRef<typeof BaseDrawerPopup> & {
    side?: "top" | "right" | "bottom" | "left";
  }
>(({ className, children, side = "right", ...props }, ref) => {
  React.useEffect(() => {
    return () => {
      const style = window.getComputedStyle(document.body);
      if (
        style.pointerEvents === "none" ||
        style.overflow === "hidden" ||
        style.userSelect === "none" ||
        style.cursor === "wait"
      ) {
        document.body.style.pointerEvents = "";
        document.body.style.overflow = "";
        document.body.style.userSelect = "";
        document.body.style.cursor = "";
      }
    };
  }, []);
  return (
    <BaseDrawerPortal>
      <DrawerOverlay />
      <BaseDrawerViewport>
        <BaseDrawerPopup
          ref={ref}
          className={cn(
            "fixed z-50 bg-background shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:duration-300 data-[state=open]:duration-500",
            side === "right" &&
              "data-[state=closed]:translate-x-full data-[state=open]:translate-x-0 inset-y-0 right-0 h-full w-3/4 border-l sm:max-w-sm",
            side === "left" &&
              "data-[state=closed]:-translate-x-full data-[state=open]:translate-x-0 inset-y-0 left-0 h-full w-3/4 border-r sm:max-w-sm",
            side === "top" &&
              "data-[state=closed]:-translate-y-full data-[state=open]:translate-y-0 inset-x-0 top-0 h-auto border-b",
            side === "bottom" &&
              "data-[state=closed]:translate-y-full data-[state=open]:translate-y-0 inset-x-0 bottom-0 h-auto border-t",
            className,
          )}
          {...props}
        >
          {children}
          <BaseDrawerClose className="ring-offset-background focus:ring-ring data-[state=open]:bg-secondary absolute top-4 right-4 rounded-xs opacity-70 transition-opacity hover:opacity-100 focus:ring-2 focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="size-4"
            >
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
            <span className="sr-only">Close</span>
          </BaseDrawerClose>
        </BaseDrawerPopup>
      </BaseDrawerViewport>
    </BaseDrawerPortal>
  );
});
SheetContent.displayName = "SheetContent";

const Sheet = BaseDrawerRoot;
const SheetTrigger = BaseDrawerTrigger;
const SheetClose = BaseDrawerClose;

function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-header"
      className={cn("flex flex-col gap-1.5 p-4", className)}
      {...props}
    />
  );
}
SheetHeader.displayName = "SheetHeader";

function SheetFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-footer"
      className={cn("mt-auto flex flex-col gap-2 p-4", className)}
      {...props}
    />
  );
}
SheetFooter.displayName = "SheetFooter";

const SheetTitle = React.forwardRef<
  React.ElementRef<typeof BaseDrawerTitle>,
  React.ComponentPropsWithoutRef<typeof BaseDrawerTitle>
>(({ className, ...props }, ref) => (
  <BaseDrawerTitle
    ref={ref}
    data-slot="sheet-title"
    className={cn("text-foreground font-semibold", className)}
    {...props}
  />
));
SheetTitle.displayName = "SheetTitle";

const SheetDescription = React.forwardRef<
  React.ElementRef<typeof BaseDrawerDescription>,
  React.ComponentPropsWithoutRef<typeof BaseDrawerDescription>
>(({ className, ...props }, ref) => (
  <BaseDrawerDescription
    ref={ref}
    data-slot="sheet-description"
    className={cn("text-muted-foreground text-sm", className)}
    {...props}
  />
));
SheetDescription.displayName = "SheetDescription";

export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
};
