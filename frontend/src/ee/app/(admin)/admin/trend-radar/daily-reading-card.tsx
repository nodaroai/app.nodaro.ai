// Admin → Trend Radar → Settings → "How many trends to check each day": the
// daily reading in the units an admin decides in (trends a day, credits), with
// what that buys: how often each trend is checked and how long the balance
// lasts. The server keeps it as a search budget; daily-reading.ts converts.

import { useState } from "react"
import type { TrendRadarReadingCost } from "@nodaro/sdk/trend-radar"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"
import { READ_PRESETS, budgetOf, readingOutlook, readsOf } from "./daily-reading"
import { Section } from "./parts"

const count = (n: number) => n.toLocaleString("en-US")
const days = (n: number) => `${count(n)} day${n === 1 ? "" : "s"}`

const TITLE = "How many trends to check each day"
const WHY = "Every morning the radar checks trends again: who posted them and how many views they have. More trends a day means fresher numbers, and more credits."

interface Props {
  step: number
  /** The draft's search budget per day. */
  budget: number
  onBudget: (budget: number) => void
  /** What reading costs, from the summary; absent while it loads or from an older server. */
  reading: TrendRadarReadingCost | undefined
  /** Trends open now (checked every day if the budget allows), or null while unknown. */
  open: number | null
}

function Fact({ title, value, note, warn }: { title: string; value: string; note: string; warn?: boolean }) {
  return (
    <div className={cn("rounded-lg border p-3", warn && "border-destructive/60 bg-destructive/5")} role={warn ? "alert" : undefined}>
      <div className="text-xs text-muted-foreground">{title}</div>
      <div className={cn("text-lg font-semibold mt-0.5", warn && "text-destructive")}>{value}</div>
      <div className={cn("text-xs mt-0.5", warn ? "text-destructive" : "text-muted-foreground")}>{note}</div>
    </div>
  )
}

export function DailyReadingCard({ step, budget, onBudget, reading, open }: Props) {
  const [customPicked, setCustomPicked] = useState(false)

  if (!reading) {
    // Without the cost the budget stays in searches, as the server keeps it.
    return (
      <Section step={step} title={TITLE} description={WHY}>
        <div className="flex flex-wrap items-center gap-3">
          <Label htmlFor="t-dailySearchBudget">Searches per day (one trend takes one per platform)</Label>
          <Input id="t-dailySearchBudget" className="w-[120px]" type="number" min={0} value={Number.isNaN(budget) ? "" : budget} onChange={(e) => onBudget(e.target.value.trim() === "" ? Number.NaN : Number(e.target.value))} />
        </div>
      </Section>
    )
  }

  const perRead = reading.searchesPerRead
  const reads = readsOf(budget, perRead)
  const custom = customPicked || !READ_PRESETS.includes(reads)
  const valid = Number.isFinite(reads)
  const o = valid ? readingOutlook(reads, reading, open) : null
  const deepCredits = reading.creditsPerDeepSearch === null ? null : reading.deepSearchesMax * reading.creditsPerDeepSearch

  return (
    <Section step={step} title={TITLE} description={WHY}>
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Trends checked per day">
        {READ_PRESETS.map((n) => (
          <Button
            key={n}
            variant={!custom && reads === n ? "default" : "outline"}
            aria-pressed={!custom && reads === n}
            className="min-w-[72px]"
            onClick={() => {
              setCustomPicked(false)
              onBudget(budgetOf(n, perRead))
            }}
          >
            {count(n)}
          </Button>
        ))}
        <Button variant={custom ? "default" : "outline"} aria-pressed={custom} onClick={() => setCustomPicked(true)}>
          Other number
        </Button>
        {custom && (
          <Input
            type="number"
            min={0}
            max={Math.floor(reading.maxSearchesPerDay / perRead)}
            step={1}
            className="w-[120px]"
            aria-label="Trends per day"
            value={valid ? reads : ""}
            onChange={(e) => onBudget(budgetOf(e.target.value.trim() === "" ? Number.NaN : Math.floor(Number(e.target.value)), perRead))}
          />
        )}
        <span className="text-sm text-muted-foreground">trends a day</span>
      </div>

      {o && (
        <>
          <div className="grid gap-3 sm:grid-cols-3 mt-4">
            {o.creditsPerDay !== null && reading.creditsPerRead !== null && (
              <Fact title="Costs" value={`${count(o.creditsPerDay)} credits a day`} note={`${count(reading.creditsPerRead)} credits per trend`} />
            )}
            {open !== null && (
              <Fact
                title="Each trend is checked"
                value={o.reads === 0 ? "never" : o.everyDays === null ? "every day" : `every ${days(o.everyDays)}`}
                note={
                  o.reads === 0
                    ? "Only new names are looked for."
                    : `${count(open)} trends are being followed${o.everyDays === null ? "" : "; the ones checked longest ago go first"}.`
                }
              />
            )}
            {reading.runnerCredits !== null && o.daysOfCredits !== null && (
              <Fact
                title="Credits left"
                value={count(reading.runnerCredits)}
                warn={o.short}
                note={o.short ? "Less than one day: the radar stops when they run out. Top up first." : `Enough for about ${days(o.daysOfCredits)} at this pace.`}
              />
            )}
          </div>

          <div className="mt-4 space-y-1.5 text-xs text-muted-foreground">
            {reading.deepSearchesMax > 0 && (
              <p>
                <span className="font-semibold text-foreground">Big trends get a closer count.</span> When one search already comes back full, the radar searches up to{" "}
                {reading.deepSearchesMax} more times{deepCredits !== null && ` (${count(deepCredits)} credits)`} so it can count everyone who posted. That comes out of the same daily amount, so a day with many big trends checks a few fewer.
              </p>
            )}
            <p>
              In searches: {count(o.searches)} a day, {perRead} per trend (one per platform). Credits come from the account of whoever last pressed Save.
            </p>
          </div>
        </>
      )}
    </Section>
  )
}
