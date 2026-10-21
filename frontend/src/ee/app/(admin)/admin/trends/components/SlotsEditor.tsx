// The trend's slots: what a user replaces (people, a place, products, pets).
// A slot's key is stable once saved (examples and runs name slots by key);
// its label and hint are per language; its roleName (hidden) names who it is
// in the source clip; a person / pet / product carries its kind's default chips.

import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react"
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
import {
  CHIPS_BY_KIND,
  CHIP_LABELS,
  SLOT_CAPS,
  SLOT_KEY_RE,
  SLOT_KINDS,
  newSlot,
  withKind,
  type FormSlot,
} from "../model"
import { LocalizedField } from "./LocalizedField"

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

interface Props {
  readonly slots: FormSlot[]
  readonly onChange: (slots: FormSlot[]) => void
}

export function SlotsEditor({ slots, onChange }: Props) {
  const update = (i: number, next: FormSlot) => onChange(slots.map((s, j) => (j === i ? next : s)))
  const move = (i: number, by: -1 | 1) => {
    const j = i + by
    if (j < 0 || j >= slots.length) return
    const next = [...slots]
    ;[next[i], next[j]] = [next[j]!, next[i]!]
    onChange(next)
  }
  const remove = (i: number) => onChange(slots.filter((_, j) => j !== i))
  const countOf = (kind: TrendSlotKind) => slots.filter((s) => s.kind === kind).length

  return (
    <div className="flex flex-col gap-3">
      {slots.length === 0 && <p className="text-sm text-muted-foreground">No slots yet.</p>}
      {slots.map((s, i) => (
        <SlotCard
          key={s.uid}
          slot={s}
          index={i}
          count={slots.length}
          kindFull={(k) => k !== s.kind && countOf(k) >= SLOT_CAPS[k]}
          onChange={(next) => update(i, next)}
          onMove={(by) => move(i, by)}
          onRemove={() => remove(i)}
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
            onClick={() => onChange([...slots, newSlot(k, slots)])}
          >
            <Plus className="mr-1 h-4 w-4" /> {KIND_LABELS[k]}
          </Button>
        ))}
      </div>
    </div>
  )
}

interface CardProps {
  readonly slot: FormSlot
  readonly index: number
  readonly count: number
  readonly kindFull: (k: TrendSlotKind) => boolean
  readonly onChange: (s: FormSlot) => void
  readonly onMove: (by: -1 | 1) => void
  readonly onRemove: () => void
}

function SlotCard({ slot, index, count, kindFull, onChange, onMove, onRemove }: CardProps) {
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
          <span className="font-medium">Defaults</span>
          <div className="grid gap-2 sm:grid-cols-3">
            {CHIPS_BY_KIND[slot.kind].map((chip) => (
              <div key={chip} className="flex flex-col gap-1">
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
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
