"use client";

import * as React from "react";
import { X } from "lucide-react";
import { Dialog as BaseDialogNamespace } from "@base-ui/react/dialog";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const BaseDialogRoot = BaseDialogNamespace.Root;
const BaseDialogTrigger = BaseDialogNamespace.Trigger;
const BaseDialogClose = BaseDialogNamespace.Close;
const BaseDialogPortal = BaseDialogNamespace.Portal;

const DialogPortal = BaseDialogPortal;
const BaseDialogBackdrop = BaseDialogNamespace.Backdrop;
const BaseDialogPopup = BaseDialogNamespace.Popup;
const BaseDialogTitle = BaseDialogNamespace.Title;
const BaseDialogDescription = BaseDialogNamespace.Description;

function Dialog({
  ...props
}: React.ComponentProps<typeof BaseDialogRoot>) {
  return <BaseDialogRoot data-slot="dialog" {...props} />;
}

function DialogTrigger({
  asChild,
  children,
  ...props
}: React.ComponentProps<typeof BaseDialogTrigger> & { asChild?: boolean }) {
  if (asChild) {
    const child = React.isValidElement(children)
      ? children
      : React.Children.only(children);
    if (React.isValidElement(child)) {
      return (
        <BaseDialogTrigger
          data-slot="dialog-trigger"
          {...props}
          render={(triggerProps) =>
            React.cloneElement(child as React.ReactElement, triggerProps)
          }
        />
      );
    }
  }
  return (
    <BaseDialogTrigger data-slot="dialog-trigger" {...props}>
      {children}
    </BaseDialogTrigger>
  );
}

function DialogClose({
  asChild,
  children,
  ...props
}: React.ComponentProps<typeof BaseDialogClose> & { asChild?: boolean }) {
  if (asChild) {
    const child = React.isValidElement(children)
      ? children
      : React.Children.only(children);
    if (React.isValidElement(child)) {
      return (
        <BaseDialogClose
          data-slot="dialog-close"
          {...props}
          render={(closeProps) =>
            React.cloneElement(child as React.ReactElement, closeProps)
          }
        />
      );
    }
  }
  return (
    <BaseDialogClose data-slot="dialog-close" {...props}>
      {children}
    </BaseDialogClose>
  );
}

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof BaseDialogBackdrop>,
  React.ComponentPropsWithoutRef<typeof BaseDialogBackdrop>
>(({ className, ...props }, ref) => (
  <BaseDialogBackdrop
    ref={ref}
    className={cn(
      "fixed inset-0 z-50 bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className,
    )}
    {...props}
  />
));
DialogOverlay.displayName = BaseDialogBackdrop.displayName;

/**
 * 尺寸档位。此前 DialogContent 只有硬编码的 max-w-lg，导致 11 处调用各自覆写，
 * 实测长出 5 种宽度（lg/2xl/5xl/6xl/1100px）× 3 种高度（86/90/92vh），
 * 且「设置类大面板」都要重复写一遍 p-0 gap-0 flex flex-col 才能自排版。
 * 这里把「宽度 + 高度 + 内部布局模式」打包成四档，调用方选档不再拼数值。
 * 默认 sm 等价于改造前的 max-w-lg + p-6，不改变既有行为。
 */
const dialogContentVariants = cva(
  "fixed left-[50%] top-[50%] z-50 w-full translate-x-[-50%] translate-y-[-50%] border bg-card shadow-pop-4 duration-200 ease-standard data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] sm:rounded-2xl",
  {
    variants: {
      size: {
        /** 表单、确认框：内容自然高度 */
        sm: "grid max-w-lg gap-4 p-6",
        /** 详情、单栏列表：内容自然高度，上限 90vh */
        md: "grid max-w-2xl max-h-[90vh] gap-4 p-6",
        /** 设置面板：定高 + 自排版（内部通常是左导航 + 右内容） */
        lg: "flex max-w-5xl h-[88vh] flex-col gap-0 p-0",
        /** 市场、双栏浏览：定高 + 自排版 */
        xl: "flex max-w-6xl h-[88vh] flex-col gap-0 p-0",
      },
    },
    defaultVariants: { size: "sm" },
  },
);

const DialogContent = React.forwardRef<
  React.ElementRef<typeof BaseDialogPopup>,
  React.ComponentPropsWithoutRef<typeof BaseDialogPopup> &
    VariantProps<typeof dialogContentVariants> & {
      onEscapeKeyDown?: (event: KeyboardEvent) => void;
      onPointerDownOutside?: (event: PointerEvent) => void;
      onOpenAutoFocus?: (event: Event) => void;
    }
>(({ className, children, size, onEscapeKeyDown, onPointerDownOutside, onOpenAutoFocus, ...props }, ref) => {
  const internalRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    if (!onEscapeKeyDown && !onPointerDownOutside) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && onEscapeKeyDown) {
        onEscapeKeyDown(event);
      }
    };

    const handlePointerDownOutside = (event: PointerEvent) => {
      if (onPointerDownOutside) {
        onPointerDownOutside(event);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("pointerdown", handlePointerDownOutside);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("pointerdown", handlePointerDownOutside);
    };
  }, [onEscapeKeyDown, onPointerDownOutside]);

  React.useEffect(() => {
    if (!onOpenAutoFocus) return;

    const handleFocus = (event: Event) => {
      onOpenAutoFocus(event);
    };

    const popup = internalRef.current;
    if (popup) {
      popup.addEventListener("focusin", handleFocus as EventListener);
      return () => {
        popup.removeEventListener("focusin", handleFocus as EventListener);
      };
    }
  }, [onOpenAutoFocus]);

  return (
    <BaseDialogPortal>
      <DialogOverlay />
      <BaseDialogPopup
        ref={(node) => {
          internalRef.current = node;
          if (typeof ref === "function") {
            ref(node);
          } else if (ref) {
            ref.current = node;
          }
        }}
        className={cn(
          dialogContentVariants({ size }),
          className,
        )}
        {...props}
      >
        {children}
        <DialogClose className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground">
          <X className="h-4 w-4" />
          <span className="sr-only">Close</span>
        </DialogClose>
      </BaseDialogPopup>
    </BaseDialogPortal>
  );
});
DialogContent.displayName = BaseDialogPopup.displayName;

const DialogHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col space-y-1.5 text-center sm:text-left",
      className,
    )}
    {...props}
  />
);
DialogHeader.displayName = "DialogHeader";

const DialogFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2",
      className,
    )}
    {...props}
  />
);
DialogFooter.displayName = "DialogFooter";

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof BaseDialogTitle>,
  React.ComponentPropsWithoutRef<typeof BaseDialogTitle>
>(({ className, ...props }, ref) => (
  <BaseDialogTitle
    ref={ref}
    className={cn(
      "text-lg font-semibold leading-none tracking-tight",
      className,
    )}
    {...props}
  />
));
DialogTitle.displayName = "DialogTitle";

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof BaseDialogDescription>,
  React.ComponentPropsWithoutRef<typeof BaseDialogDescription>
>(({ className, ...props }, ref) => (
  <BaseDialogDescription
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
));
DialogDescription.displayName = "DialogDescription";

export {
  Dialog,
  DialogTrigger,
  DialogClose,
  DialogPortal,
  DialogOverlay,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
};
