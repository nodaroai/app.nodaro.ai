import { cn } from "@/lib/utils"
import { BOX } from "./figure-parts"
import type { ContractFigure } from "./types"

/** "What passes between a product and the header": one card per direction, side by side. */
export function ContractFigureView({ figure }: { figure: ContractFigure }) {
  return (
    <section aria-labelledby="figure-contract" className="space-y-2.5">
      <h3 id="figure-contract" className="text-[15px] font-bold">
        {figure.heading}
      </h3>
      <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${figure.columns.length}, minmax(0, 1fr))` }}>
        {figure.columns.map((column) => (
          <div key={column.title} className={cn(BOX, "space-y-2 px-4 py-3.5")}>
            <h4 className="text-[15px] font-semibold">{column.title}</h4>
            <ul className="space-y-1.5 text-sm">
              {column.items.map((item) => (
                <li key={item.name} className="flex gap-2">
                  <span aria-hidden className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary/70" />
                  <span>
                    {item.name}
                    {item.note && <span className="block text-xs text-muted-foreground">{item.note}</span>}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      {figure.caption && <p className="max-w-[78ch] text-[13px] leading-relaxed text-muted-foreground">{figure.caption}</p>}
    </section>
  )
}
