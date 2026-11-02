import type { ReactNode } from "react"
import { cn } from "@/lib/utils"
import { BOX_STRONG, Figure, WireDown } from "./figure-parts"
import { ACCENT_TEXT } from "./product-icon"
import type { AnatomyFigure, AnatomyPart, WorldLink } from "./types"

/**
 * "What is in the header": the bar as an English site shows it, left to
 * right, each part pointed at from its name below. The bar itself is a
 * drawing (hidden from screen readers); the names under it carry the words.
 */

const ORDER: readonly AnatomyPart[] = ["logo", "worlds", "developers", "language", "credits", "account"]

/**
 * The bar's columns: the logo and the worlds take what they need, a free
 * stretch keeps the rest at the end (as the real bar does), and the four parts
 * there get equal columns wide enough for their names.
 */
const COLUMNS = "auto auto minmax(0, 1fr) repeat(4, 6.75rem)"
const COLUMN: Record<AnatomyPart, number> = { logo: 1, worlds: 2, developers: 4, language: 5, credits: 6, account: 7 }

/** A sketch: the bar shows this many simple worlds; the rest are under More, as on a narrower bar. */
const SIMPLE_SHOWN = 5

const chip = "whitespace-nowrap rounded-full border bg-card px-2 py-0.5 text-[11px]"

function WorldChips({ worlds }: { worlds: readonly WorldLink[] }) {
  const simple = worlds.filter((world) => world.group === "simple").slice(0, SIMPLE_SHOWN)
  const advanced = worlds.filter((world) => world.group === "advanced")
  return (
    <div className={cn(BOX_STRONG, "flex items-center gap-1 px-1.5 py-1.5")}>
      {simple.map((world) => (
        <span key={world.id} className={chip}>
          {world.label}
        </span>
      ))}
      {advanced.length > 0 && <span className="mx-0.5 h-5 w-px bg-muted-foreground/50" />}
      {advanced.map((world) => (
        <span key={world.id} className={chip}>
          {world.label}
        </span>
      ))}
      <span className="whitespace-nowrap px-1 text-[11px] text-muted-foreground">More ▾</span>
    </div>
  )
}

/** The bar's own look for each part: a sketch, never a working control. */
function mock(part: AnatomyPart, worlds: readonly WorldLink[]): ReactNode {
  switch (part) {
    case "logo":
      return (
        <span className="flex items-center gap-1.5">
          <span className="h-5 w-5 rounded-full bg-primary" />
          <span className="text-[17px] font-bold">nodaro</span>
        </span>
      )
    case "worlds":
      return <WorldChips worlds={worlds} />
    case "developers":
      return (
        <span className="flex gap-1 font-mono text-[11px] text-muted-foreground">
          {["MCP", "</>", "≡"].map((glyph) => (
            <span key={glyph} className="rounded-md border bg-card px-1.5 py-0.5">
              {glyph}
            </span>
          ))}
        </span>
      )
    case "language":
      return <span className="rounded-full border bg-card px-2 py-0.5 text-[11px]">EN</span>
    case "credits":
      return (
        <span className="flex items-center gap-1.5 text-[12.5px] font-semibold">
          <span className="h-3.5 w-3.5 rounded-full bg-amber-500" />
          1,240
        </span>
      )
    case "account":
      return <span className="block h-8 w-8 rounded-full bg-muted-foreground/30" />
  }
}

export function AnatomyFigureView({ figure, worlds }: { figure: AnatomyFigure; worlds: readonly WorldLink[] }) {
  return (
    <Figure id="anatomy" heading={figure.heading} caption={figure.caption} minWidth={960}>
      <div className={cn("mb-2 text-[13px] font-bold", ACCENT_TEXT)}>{figure.barLabel}</div>
      <div className="grid items-center gap-x-3" style={{ gridTemplateColumns: COLUMNS }}>
        {/* The bar: one frame behind the six parts. */}
        <div aria-hidden className="h-[60px] rounded-xl border-2 bg-card" style={{ gridColumn: "1 / -1", gridRow: 1 }} />
        {ORDER.map((part) => (
          <div key={part} aria-hidden className={cn("relative flex justify-center", part === "logo" && "ms-4", part === "account" && "me-2")} style={{ gridColumn: COLUMN[part], gridRow: 1 }}>
            {mock(part, worlds)}
          </div>
        ))}
        {/* Each name points up at its part. */}
        {ORDER.map((part) => (
          <WireDown key={part} accent={part === "worlds"} height={22} className={cn("mt-1 rotate-180", part === "logo" && "ms-4")} style={{ gridColumn: COLUMN[part], gridRow: 2 }} />
        ))}
        {ORDER.map((part) => {
          const { name, note } = figure.parts[part]
          return (
            <div key={part} className={cn("mx-auto max-w-[16rem] self-start text-center", part === "logo" && "ms-4")} style={{ gridColumn: COLUMN[part], gridRow: 3 }} data-part={part}>
              <div className={cn("text-[13.5px] font-bold", part === "worlds" && cn("text-[14.5px]", ACCENT_TEXT))}>{name}</div>
              {note && <div className="text-xs text-muted-foreground">{note}</div>}
            </div>
          )
        })}
      </div>
    </Figure>
  )
}
