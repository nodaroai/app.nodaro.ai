// The trend's slots: what a user replaces (people, a place, products, pets).
// A slot's key is stable once saved (examples and runs name slots by key);
// its label and hint are per language; its roleName (hidden) names who it is
// in the source clip; a person / pet / product carries its kind's default chips,
// each shown to people (they may change it) or hidden (fixed at its value).
// A slot may carry a hint picture (e.g. a frame of that actor from the
// original), copied into the trend's storage as it is added; shown with the
// slot, never sent with a run.

import { useState } from "react"
import { ArrowDown, ArrowUp, Plus, Trash2, X } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { TrendChipKey, TrendChoice, TrendSlotKind } from "@/lib/api"
import { useTrendMedia } from "@/ee/hooks/queries/use-admin-queries"
import {
  CHIPS_BY_KIND,
  CHIP_LABELS,
  SLOT_CAPS,
  SLOT_KEY_RE,
  SLOT_KINDS,
  newSlot,
  shownChips,
  withChipShown,
  withKind,
  type FormSlot,
} from "../model"
import { LocalizedField } from "./LocalizedField"
import { MediaPicker } from "./MediaPicker"
import { uploadLocalFile } from "./uploads"

const KIND_LABELS: Readonly<Record<TrendSlotKind, string>> = {
  person: "Person",
  location: "Place",
  product: "Product",
  pet: "Pet",
}

const CHOICES: ReadonlyArray<{ value: TrendChoice | "default"; label: string }> = [
  { value: "default", label: "Engine default" },
  { value: "new", label: "New" },
  { value: "original", label: "Keep original" },
]

/** What a hidden chip is fixed at: its value, else the engine's default (New). */
function fixedLabel(v: TrendChoice | undefined): string {
  return v === "original" ? "Keep original" : "New"
}

interface Props {
  readonly trendId: string
  readonly slots: FormSlot[]
  /** Functional: a hint picture arrives asynchronously, after other edits may have landed. */
  readonly onChange: (fn: (slots: FormSlot[]) => FormSlot[]) => void
}

export function SlotsEditor({ trendId, slots, onChange }: Props) {
  // By uid, on the slots as they are when the change lands (never the ones this render saw).
  const update = (uid: string, fn: (s: FormSlot) => FormSlot) => onChange((ss) => ss.map((s) => (s.uid === uid ? fn(s) : s)))
  const move = (uid: string, by: -1 | 1) =>
    onChange((ss) => {
      const i = ss.findIndex((s) => s.uid === uid)
      const j = i + by
      if (i < 0 || j < 0 || j >= ss.length) return ss
      const next = [...ss]
      ;[next[i], next[j]] = [next[j]!, next[i]!]
      return next
    })
  const remove = (uid: string) => onChange((ss) => ss.filter((s) => s.uid !== uid))
  const countOf = (kind: TrendSlotKind) => slots.filter((s) => s.kind === kind).length

  return (
    <div className="flex flex-col gap-3">
      {slots.length === 0 && <p className="text-sm text-muted-foreground">No slots yet.</p>}
      {slots.map((s, i) => (
        <SlotCard
          key={s.uid}
          trendId={trendId}
          slot={s}
          index={i}
          count={slots.length}
          kindFull={(k) => k !== s.kind && countOf(k) >= SLOT_CAPS[k]}
          onChange={(next) => update(s.uid, () => next)}
          onHintImage={(url) => update(s.uid, (x) => withHintImage(x, url))}
          onMove={(by) => move(s.uid, by)}
          onRemove={() => remove(s.uid)}
        />
      ))}
      <div className="flex flex-wrap gap-2">
        {SLOT_KINDS.map((k) => (
          <Button
            key={k}
            type="button"
            variant="outline"
            size="sm"
            className="min-h-9"
            disabled={countOf(k) >= SLOT_CAPS[k]}
            onClick={() => onChange((ss) => [...ss, newSlot(k, ss)])}
          >
            <Plus className="mr-1 h-4 w-4" /> {KIND_LABELS[k]}
          </Button>
        ))}
      </div>
    </div>
  )
}

/** The slot with this hint picture, or with none (`undefined`: the key is removed, never saved empty). */
function withHintImage(s: FormSlot, url: string | undefined): FormSlot {
  const rest: FormSlot = { ...s }
  delete rest.hintImageUrl
  return url ? { ...rest, hintImageUrl: url } : rest
}

interface CardProps {
  readonly trendId: string
  readonly slot: FormSlot
  readonly index: number
  readonly count: number
  readonly kindFull: (k: TrendSlotKind) => boolean
  readonly onChange: (s: FormSlot) => void
  /** Applied to the slot as it is when the picture lands. */
  readonly onHintImage: (url: string | undefined) => void
  readonly onMove: (by: -1 | 1) => void
  readonly onRemove: () => void
}

function SlotCard({ trendId, slot, index, count, kindFull, onChange, onHintImage, onMove, onRemove }: CardProps) {
  const n = index + 1
  const keyOk = SLOT_KEY_RE.test(slot.key)
  const setChip = (chip: TrendChipKey, v: TrendChoice | "default") => {
    const defaults = { ...slot.defaults }
    if (v === "default") delete defaults[chip]
    else defaults[chip] = v
    onChange({ ...slot, defaults })
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border p-3" data-slot-card>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium">
          Slot {n} · {KIND_LABELS[slot.kind]}
        </span>
        <div className="flex gap-1">
          <Button type="button" variant="ghost" size="sm" className="h-9 w-9 p-0" aria-label={`Move slot ${n} up`} disabled={index === 0} onClick={() => onMove(-1)}>
            <ArrowUp className="h-4 w-4" />
          </Button>
          <Button type="button" variant="ghost" size="sm" className="h-9 w-9 p-0" aria-label={`Move slot ${n} down`} disabled={index === count - 1} onClick={() => onMove(1)}>
            <ArrowDown className="h-4 w-4" />
          </Button>
          <Button type="button" variant="ghost" size="sm" className="h-9 w-9 p-0 text-destructive" aria-label={`Remove slot ${n}`} onClick={onRemove}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Key</span>
          <Input
            value={slot.key}
            readOnly={!slot.isNew}
            aria-invalid={!keyOk}
            autoCapitalize="none"
            onChange={(e) => onChange({ ...slot, key: e.target.value })}
            className="h-9 font-mono"
          />
          <span className="text-xs text-muted-foreground">{slot.isNew ? "a–z, 0–9, _ — fixed once saved" : "Fixed: examples and runs use it"}</span>
        </label>
        <div className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Kind</span>
          <Select value={slot.kind} onValueChange={(k) => onChange(withKind(slot, k as TrendSlotKind))}>
            <SelectTrigger className="h-9" aria-label={`Slot ${n} kind`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SLOT_KINDS.map((k) => (
                <SelectItem key={k} value={k} disabled={kindFull(k)}>
                  {KIND_LABELS[k]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <label className="flex min-h-9 items-center gap-2 self-end text-sm">
          <Switch aria-label={`Slot ${n} required`} checked={slot.required} onCheckedChange={(required) => onChange({ ...slot, required })} />
          Required
        </label>
      </div>

      <LocalizedField label="Label" value={slot.label} maxLength={100} onChange={(label) => onChange({ ...slot, label })} />
      <LocalizedField
        label="Hint"
        optional
        multiline
        value={slot.hint ?? { en: "" }}
        maxLength={500}
        onChange={(hint) => onChange({ ...slot, hint })}
      />
      <HintPicture trendId={trendId} n={n} url={slot.hintImageUrl} onChange={onHintImage} />

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Role name</span>
        <Input
          value={slot.roleName}
          maxLength={200}
          aria-invalid={!slot.roleName.trim()}
          placeholder="the woman on the left"
          onChange={(e) => onChange({ ...slot, roleName: e.target.value })}
          className="h-9"
        />
        <span className="text-xs text-muted-foreground">Who this is in the source clip. Hidden from users; goes into the prompt.</span>
      </label>

      {CHIPS_BY_KIND[slot.kind].length > 0 && (
        <div className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Chips</span>
          <span className="text-xs text-muted-foreground">
            Each chip's starting value, and whether people see it. A hidden chip is fixed at its value: people's runs cannot change it (test runs can).
          </span>
          <div className="grid gap-2 sm:grid-cols-3">
            {CHIPS_BY_KIND[slot.kind].map((chip) => {
              const shown = shownChips(slot).includes(chip)
              return (
                <div key={chip} className="flex flex-col gap-1" data-chip={chip}>
                  <span className="text-xs text-muted-foreground">{CHIP_LABELS[chip]}</span>
                  <Select value={slot.defaults?.[chip] ?? "default"} onValueChange={(v) => setChip(chip, v as TrendChoice | "default")}>
                    <SelectTrigger className="h-9" aria-label={`Slot ${n} ${CHIP_LABELS[chip]}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CHOICES.map((c) => (
                        <SelectItem key={c.value} value={c.value}>
                          {c.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <label className="flex min-h-9 items-center gap-2 text-xs">
                    <Switch
                      aria-label={`Slot ${n} ${CHIP_LABELS[chip]} shown to people`}
                      checked={shown}
                      onCheckedChange={(on) => onChange(withChipShown(slot, chip, on))}
                    />
                    {shown ? "Shown to people" : `Hidden: fixed at ${fixedLabel(slot.defaults?.[chip])}`}
                  </label>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

interface HintProps {
  readonly trendId: string
  readonly n: number
  readonly url: string | undefined
  readonly onChange: (url: string | undefined) => void
}

/** The slot's optional hint picture: added (uploaded or pasted, then copied into trend storage) or removed. */
function HintPicture({ trendId, n, url, onChange }: HintProps) {
  const media = useTrendMedia(trendId)
  const [uploading, setUploading] = useState(false)

  const store = async (from: string) => {
    try {
      onChange((await media.mutateAsync({ url: from, kind: "hint" })).url)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not store the picture")
    }
  }
  const fromFile = async (file: File) => {
    setUploading(true)
    try {
      await store(await uploadLocalFile(file))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed")
    } finally {
      setUploading(false)
    }
  }

  return (
    <div role="group" aria-label={`Slot ${n} hint picture`} className="flex flex-col gap-1 text-sm">
      <span className="font-medium">
        Hint picture <span className="font-normal text-muted-foreground">(optional)</span>
      </span>
      <span className="text-xs text-muted-foreground">
        Who this slot replaces, e.g. a frame of that actor from the original. Shown to people with the slot; never sent with a run.
      </span>
      {url ? (
        <div className="relative self-start">
          <img src={url} alt={`Slot ${n} hint picture`} className="h-20 w-20 rounded object-cover" />
          <button
            type="button"
            aria-label={`Remove slot ${n} hint picture`}
            className="absolute -right-2 -top-2 flex h-7 w-7 items-center justify-center rounded-full border bg-background shadow"
            onClick={() => onChange(undefined)}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : (
        <MediaPicker
          accept="image/*"
          uploadLabel="Add hint picture"
          busy={uploading || media.isPending}
          onFiles={(files) => void fromFile(files[0]!)}
          onUrl={(u) => void store(u)}
        />
      )}
    </div>
  )
}
