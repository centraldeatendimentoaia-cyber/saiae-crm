import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center justify-center gap-1 rounded-full h-7 px-3 text-[13px] font-bold w-fit whitespace-nowrap shrink-0 [&>svg]:size-4 [&>svg]:pointer-events-none",
  {
    variants: {
      variant: {
        // Etiqueta de destaque: tinta + mostarda, canto balão
        default: "rounded-balao h-auto bg-foreground text-brand uppercase tracking-[0.04em] text-xs py-1.5 px-3 [a&]:hover:bg-foreground/90",
        secondary: "bg-muted text-secondary-foreground [a&]:hover:bg-muted/70",
        destructive: "bg-err-bg text-err-tx",
        outline: "border border-input bg-card text-foreground [a&]:hover:bg-muted",
        success: "bg-ok-bg text-ok-tx",
        warning: "bg-warn-bg text-warn-tx",
        info: "bg-info-bg text-info-tx",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant,
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "span"

  return (
    <Comp
      data-slot="badge"
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
