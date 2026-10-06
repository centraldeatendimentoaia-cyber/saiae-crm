import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[14px] text-base font-semibold transition-[transform,background-color,box-shadow] duration-100 ease-[cubic-bezier(.2,.8,.2,1)] active:scale-[0.97] disabled:pointer-events-none disabled:opacity-40 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-5 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-brand aria-invalid:outline-destructive",
  {
    variants: {
      variant: {
        // Primário: mostarda com texto tinta. Um por tela.
        default: "bg-brand text-brand-foreground hover:bg-mustard-400 hover:shadow-[inset_0_0_0_1.5px_var(--color-mustard-600)]",
        // Secundário: tinta
        secondary: "bg-foreground text-background hover:bg-foreground/90",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        outline: "bg-transparent text-foreground shadow-[inset_0_0_0_1.5px_var(--foreground)] hover:bg-foreground/5",
        ghost: "bg-transparent text-foreground hover:bg-muted",
        link: "h-auto rounded-none p-0 text-foreground underline underline-offset-4 hover:text-foreground/70",
        glass: "bg-muted text-foreground hover:bg-muted/70",
      },
      size: {
        default: "h-12 px-5 has-[>svg]:px-4",
        sm: "h-9 rounded-xl px-3.5 text-sm has-[>svg]:px-3 [&_svg:not([class*='size-'])]:size-[18px]",
        lg: "h-14 px-6 text-[17px] font-bold",
        xl: "h-16 px-7 text-lg font-bold",
        icon: "size-12 p-0 bg-muted text-foreground hover:bg-muted/70",
        "icon-sm": "size-9 rounded-xl p-0",
        "icon-lg": "size-14 p-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ComponentProps<"button">,
  VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
