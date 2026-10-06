import * as React from "react"

import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "file:text-foreground placeholder:text-muted-foreground/70 selection:bg-brand selection:text-brand-foreground h-12 w-full min-w-0 rounded-[10px] border border-input bg-card px-3.5 py-1 text-base transition-[box-shadow,border-color] outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground",
        "focus-visible:border-foreground focus-visible:ring-[3px] focus-visible:ring-mustard-300",
        "aria-invalid:border-destructive aria-invalid:border-[1.5px]",
        className
      )}
      {...props}
    />
  )
}

export { Input }
