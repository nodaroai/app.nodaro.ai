import { cn } from "@/lib/utils"
import { BOX, BOX_STRONG, Figure, GATE, WireDown } from "./figure-parts"
import { ACCENT_TEXT } from "./product-icon"
import type { ReleaseFigure } from "./types"

/**
 * "How a change reaches the sites": the lanes one under the other (first the
 * header's own repository, then each product), the steps down the middle with
 * an arrow from each to the next, and beside a step the check it must pass,
 * in a dashed box. A step that changes what people get stands out.
 */

const STEP_WIDTH = "w-96"

export function ReleaseFigureView({ figure }: { figure: ReleaseFigure }) {
  return (
    <Figure id="release" heading={figure.heading} caption={figure.caption} minWidth={860}>
      {figure.lanes.map((lane, l) => (
        <section key={lane.name} aria-label={lane.name}>
          {l > 0 && <div aria-hidden className="my-3 border-t border-dashed border-muted-foreground/50" />}
          <div className="flex gap-6">
            <div className="w-40 shrink-0 pt-3">
              <div className={cn("text-sm font-bold", ACCENT_TEXT)}>{lane.name}</div>
              {lane.where && <div className="font-mono text-xs text-muted-foreground">{lane.where}</div>}
            </div>
            <ol className="flex-1">
              {lane.steps.map((step, s) => (
                <li key={step.name}>
                  {(s > 0 || l > 0) && (
                    <div className={cn("flex justify-center", STEP_WIDTH)}>
                      <WireDown height={s > 0 ? 18 : 6} />
                    </div>
                  )}
                  <div className="flex items-center">
                    <div className={cn(step.strong ? BOX_STRONG : BOX, STEP_WIDTH, "shrink-0 px-4 py-3 text-center text-sm")}>{step.name}</div>
                    {step.gate && (
                      <>
                        <div aria-hidden className="w-8 shrink-0 border-t border-dashed border-muted-foreground/60" />
                        <div className={cn(GATE, "flex-1 px-3 py-2 text-[13px]")}>{step.gate}</div>
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>
      ))}
    </Figure>
  )
}
