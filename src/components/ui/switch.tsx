"use client"

import * as React from "react"
import * as SwitchPrimitive from "@radix-ui/react-switch"

import { cn } from "@/lib/utils"

function Switch({
  className,
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "peer data-[state=checked]:bg-brand data-[state=unchecked]:bg-input focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-brand inline-flex h-7 w-12 shrink-0 items-center rounded-full border-0 transition-colors outline-none disabled:cursor-not-allowed disabled:opacity-40",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          "bg-white data-[state=checked]:bg-[#18171C] shadow-[0_1px_2px_rgba(0,0,0,0.2)] data-[state=checked]:shadow-none pointer-events-none block size-[22px] rounded-full ring-0 transition-transform data-[state=checked]:translate-x-[23px] data-[state=unchecked]:translate-x-[3px]"
        )}
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
