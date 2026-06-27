"use client"

import * as React from "react"
import * as ScrollAreaPrimitive from "@radix-ui/react-scroll-area"

import { cn } from "@/lib/utils"

/**
 * Radix-based scroll area. Renders a real DOM scrollbar (not a browser
 * native one) so styling and visibility behavior is consistent across
 * macOS Safari/Chrome/Firefox regardless of OS "Show scroll bars"
 * preferences. Default `type="hover"` shows the thumb only while the
 * mouse is over the container. Passing `type="always"` keeps it visible.
 */
type ScrollAreaProps = React.ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.Root> & {
  /** Class passed to the internal ScrollBar (e.g., extra padding for inset look). */
  scrollBarClassName?: string
  /** Class passed to the internal Viewport (the actual scroller). */
  viewportClassName?: string
  /** Style passed to the internal Viewport. Use `maxHeight` for an auto-growing
   *  container that scrolls only once content exceeds the cap (the inline canvas
   *  prompt editor): the Root/Viewport size to content up to this height, then
   *  the viewport scrolls. */
  viewportStyle?: React.CSSProperties
}

const ScrollArea = React.forwardRef<
  React.ElementRef<typeof ScrollAreaPrimitive.Root>,
  ScrollAreaProps
>(({ className, children, type = "hover", scrollHideDelay = 0, scrollBarClassName, viewportClassName, viewportStyle, ...props }, ref) => (
  <ScrollAreaPrimitive.Root
    ref={ref}
    type={type}
    scrollHideDelay={scrollHideDelay}
    className={cn("relative overflow-hidden", className)}
    {...props}
  >
    <ScrollAreaPrimitive.Viewport className={cn("h-full w-full rounded-[inherit]", viewportClassName)} style={viewportStyle}>
      {children}
    </ScrollAreaPrimitive.Viewport>
    <ScrollBar className={scrollBarClassName} />
    <ScrollAreaPrimitive.Corner />
  </ScrollAreaPrimitive.Root>
))
ScrollArea.displayName = ScrollAreaPrimitive.Root.displayName

const ScrollBar = React.forwardRef<
  React.ElementRef<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>,
  React.ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>
>(({ className, orientation = "vertical", ...props }, ref) => (
  <ScrollAreaPrimitive.ScrollAreaScrollbar
    ref={ref}
    orientation={orientation}
    className={cn(
      "flex touch-none select-none transition-opacity nodrag",
      orientation === "vertical" && "h-full w-3 p-[2px]",
      orientation === "horizontal" && "h-3 flex-col p-[2px]",
      className,
    )}
    {...props}
  >
    <ScrollAreaPrimitive.ScrollAreaThumb className="relative flex-1 rounded-full bg-foreground/30 hover:bg-foreground/60 transition-colors" />
  </ScrollAreaPrimitive.ScrollAreaScrollbar>
))
ScrollBar.displayName = ScrollAreaPrimitive.ScrollAreaScrollbar.displayName

export { ScrollArea, ScrollBar }
