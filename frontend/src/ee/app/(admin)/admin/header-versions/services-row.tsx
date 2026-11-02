import { cn } from "@/lib/utils"
import { BOX, Bus, Columns, WireDown } from "./figure-parts"
import type { RuntimeFigure } from "./types"

/**
 * Under the product cards: from every product's page the header reaches the
 * same few services. Each card drops a wire to one bar; from it an arrow goes
 * to each service, with what the header goes there for.
 */

export function ServicesRow({ runtime, products, gap }: { runtime: RuntimeFigure; products: number; gap: number }) {
  const count = runtime.services.length
  return (
    <div aria-labelledby="services-title" role="group" className="mt-1">
      <Columns count={products} gap={gap}>
        {Array.from({ length: products }, (_, i) => (
          <WireDown key={i} bare height={16} />
        ))}
      </Columns>
      <Bus count={products} gap={gap} />
      <div className="flex justify-center">
        <WireDown bare height={10} />
      </div>
      <p id="services-title" className="text-center text-[13px] font-semibold">
        {runtime.fromPages}
      </p>
      <div className="flex justify-center">
        <WireDown bare height={10} />
      </div>
      <div className="mx-auto max-w-4xl">
        <Bus count={count} gap={gap} />
        <Columns count={count} gap={gap}>
          {runtime.services.map((service) => (
            <div key={service.name} className="flex flex-col items-center">
              <WireDown height={14} />
              {service.via && <div className="mb-1 text-center text-xs text-muted-foreground">{service.via}</div>}
              <div className={cn(BOX, "w-full flex-1 px-3 py-3 text-center")}>
                <div className="text-sm font-bold">{service.name}</div>
                {service.address && <div className="mt-0.5 break-all font-mono text-[11px] text-muted-foreground">{service.address}</div>}
                {service.note && <div className="mt-1.5 text-xs text-muted-foreground">{service.note}</div>}
              </div>
            </div>
          ))}
        </Columns>
      </div>
    </div>
  )
}
