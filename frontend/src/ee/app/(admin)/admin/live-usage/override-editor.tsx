import { useState } from "react"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { boundsMessage, LANE_LABELS, wholeIn } from "./format"
import { LANES, type Bounds, type Lane, type LaneSizes } from "./types"
import { useSaveLaneOverride } from "./use-live-usage"

type Draft = Record<Lane, string>

const draftOf = (o: Partial<LaneSizes> | null): Draft =>
  Object.fromEntries(LANES.map((l) => [l, typeof o?.[l] === "number" ? String(o[l]) : ""])) as Draft

/**
 * A user's own lane sizes over their plan. A blank lane follows the plan
 * (its size is the placeholder). A save replaces the whole override; only
 * "Remove override" deletes it (a save with every lane blank would too, so it
 * is not offered). The form follows the stored override and note until the
 * admin edits it, keeps their edits however often the drawer refreshes, and
 * after a save or a removal shows what the server now stores.
 */
export function OverrideEditor({ userId, override, note: storedNote, planSizes, sizeBounds }: {
  userId: string
  override: Partial<LaneSizes> | null
  note: string | null
  planSizes: LaneSizes | null
  /** What a lane's size may be: the server's, from GET /config. */
  sizeBounds: Bounds
}) {
  const [draft, setDraft] = useState<Draft>(() => draftOf(override))
  const [note, setNote] = useState(storedNote ?? "")
  const [dirty, setDirty] = useState(false)
  const save = useSaveLaneOverride(userId)
  // A new answer from the server replaces the form only while it is untouched
  // (adjusted during render, so no effect runs a frame behind).
  const serverKey = JSON.stringify([override, storedNote])
  const [seenKey, setSeenKey] = useState(serverKey)
  if (serverKey !== seenKey) {
    setSeenKey(serverKey)
    if (!dirty) {
      setDraft(draftOf(override))
      setNote(storedNote ?? "")
    }
  }

  const values = Object.fromEntries(LANES.map((l) => [l, wholeIn(draft[l], sizeBounds)])) as Record<Lane, number | null>
  const invalid = LANES.find((l) => draft[l].trim() !== "" && values[l] === null)

  const allBlank = LANES.every((l) => values[l] === null)

  const submit = (body: Record<Lane, number | null>) =>
    save.mutate({ ...body, note: note.trim() || null }, {
      onSuccess: (answer) => {
        setDirty(false)
        setDraft(draftOf(answer.override))
        setNote(answer.note ?? "")
      },
    })

  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold">Lane override</h3>
      <p className="text-xs text-muted-foreground">
        Sizes for this user's own line, over their plan. A blank lane follows the plan. It applies in every environment that reads this database.
      </p>
      <div className="grid grid-cols-4 gap-2">
        {LANES.map((l) => (
          <div key={l} className="space-y-1">
            <Label htmlFor={`override-${l}`} className="text-xs">{LANE_LABELS[l]}</Label>
            <Input
              id={`override-${l}`}
              type="number"
              inputMode="numeric"
              min={sizeBounds.min}
              max={sizeBounds.max}
              value={draft[l]}
              placeholder={planSizes ? String(planSizes[l]) : "plan"}
              onChange={(e) => {
                setDirty(true)
                setDraft({ ...draft, [l]: e.target.value })
              }}
            />
          </div>
        ))}
      </div>
      <Input
        value={note}
        onChange={(e) => {
          setDirty(true)
          setNote(e.target.value)
        }}
        placeholder="Note (why)"
        maxLength={500}
        aria-label="Note"
      />
      {invalid && <p className="text-xs text-destructive">{boundsMessage(LANE_LABELS[invalid], sizeBounds)}</p>}
      {save.error && <p className="text-xs text-destructive">{save.error.message}</p>}
      {save.isSuccess && !dirty && <p className="text-xs text-muted-foreground">{save.data.override === null ? "Override removed." : "Saved."}</p>}
      <div className="flex gap-2">
        <Button size="sm" onClick={() => submit(values)} disabled={save.isPending || invalid !== undefined || allBlank}>
          {save.isPending && <Loader2 className="me-2 h-3.5 w-3.5 animate-spin" />}
          Save override
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => submit({ provider: null, llm: null, local: null, run: null })}
          disabled={save.isPending || override === null}
        >
          Remove override
        </Button>
      </div>
    </section>
  )
}
