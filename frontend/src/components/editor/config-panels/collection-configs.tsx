"use client"

import { useState } from "react"
import { Link } from "react-router-dom"
import { Plus } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useT, tx } from "@/lib/i18n"
import {
  COLLECTION_READ_LIMIT_MAX,
  COLLECTION_READ_WINDOW_HOURS_MAX,
  type Collection,
  type CollectionDigestFormat,
  type CollectionReadOrder,
  type CollectionReadWindowUnit,
} from "@nodaro/shared"
import { useCollectionMutations, useCollections } from "@/hooks/queries/use-collections-queries"
import { CollectionFormDialog } from "@/components/collections/collection-form-dialog"
import { MappableField } from "./mappable-field"
import type { CollectionReadData, CollectionWriteData } from "@/types/nodes"
import type { ConfigProps } from "./types"

const LABEL_CLASS = "text-[11px] font-semibold uppercase tracking-widest text-gray-500 dark:text-[#64748B]"
const HINT_CLASS = "text-[10px] text-muted-foreground mt-1"
const DAYS_MAX = COLLECTION_READ_WINDOW_HOURS_MAX / 24

const clampWindow = (n: number, unit: CollectionReadWindowUnit): number =>
  Math.max(1, Math.min(unit === "days" ? DAYS_MAX : COLLECTION_READ_WINDOW_HOURS_MAX, n))

/**
 * The collection picker both nodes share: the person's collections, a button
 * that makes a new one (and picks it), and the link to the Collections page.
 * A server without collections yet says so instead of showing an empty list.
 */
function CollectionPicker({ collectionId, onPick }: { readonly collectionId: string; readonly onPick: (c: Collection) => void }) {
  const t = useT()
  const { data, isLoading } = useCollections()
  const { create } = useCollectionMutations()
  const [formOpen, setFormOpen] = useState(false)
  const collections = data?.data ?? []
  const available = data?.available !== false
  const value = collections.some((c) => c.id === collectionId) ? collectionId : ""

  return (
    <div>
      <Label className={LABEL_CLASS}>
        {t("collcfg.collection")} <span className="text-red-500">*</span>
      </Label>
      {!available ? (
        <p className="text-xs text-muted-foreground mt-1.5">{t("collcfg.notAvailable")}</p>
      ) : (
        <div className="flex gap-2 mt-1.5">
          <Select
            value={value}
            disabled={isLoading}
            onValueChange={(id) => {
              const picked = collections.find((c) => c.id === id)
              if (picked) onPick(picked)
            }}
          >
            <SelectTrigger aria-label={t("collcfg.collection")}>
              <SelectValue placeholder={collections.length === 0 && !isLoading ? t("collcfg.noCollections") : t("collcfg.selectCollection")} />
            </SelectTrigger>
            <SelectContent>
              {collections.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="icon" variant="outline" aria-label={t("collcfg.newCollection")} title={t("collcfg.newCollection")} onClick={() => setFormOpen(true)}>
            <Plus className="h-4 w-4" />
          </Button>
        </div>
      )}
      <p className={HINT_CLASS}>
        <Link to="/collections" className="underline underline-offset-2">
          {t("collcfg.manage")}
        </Link>
      </p>
      <CollectionFormDialog
        open={formOpen}
        collection={null}
        onOpenChange={setFormOpen}
        busy={create.isPending}
        onSubmit={(input) =>
          create.mutate(input, {
            onSuccess: (created) => {
              setFormOpen(false)
              onPick(created)
              toast.success(tx("collections.created"))
            },
            onError: (err) => toast.error(err instanceof Error ? err.message : tx("apiErr.createCollection")),
          })
        }
      />
    </div>
  )
}

function RunError({ data }: { readonly data: { executionStatus?: string; errorMessage?: string } }) {
  if (data.executionStatus !== "failed" || !data.errorMessage) return null
  return (
    <div className="p-2 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800">
      <p className="text-xs text-red-700 dark:text-red-400">{data.errorMessage}</p>
    </div>
  )
}

// ── Read Collection ────────────────────────────────────────────

export function CollectionReadConfig({ data, onUpdate }: ConfigProps<CollectionReadData>) {
  const t = useT()
  const unit: CollectionReadWindowUnit = data.windowUnit === "days" ? "days" : "hours"
  const amount = data.windowAmount ?? 24
  const limit = data.limit ?? 50

  return (
    <div className="space-y-4">
      <CollectionPicker collectionId={data.collectionId ?? ""} onPick={(c) => onUpdate({ collectionId: c.id, collectionName: c.name })} />

      <div>
        <Label className={LABEL_CLASS}>{t("collcfg.window")}</Label>
        <div className="flex gap-2 mt-1.5">
          <Input
            type="number"
            min={1}
            max={unit === "days" ? DAYS_MAX : COLLECTION_READ_WINDOW_HOURS_MAX}
            value={amount}
            aria-label={t("collcfg.window")}
            className="w-24"
            onChange={(e) => {
              const n = parseInt(e.target.value, 10)
              onUpdate({ windowAmount: Number.isFinite(n) ? clampWindow(n, unit) : 24 })
            }}
          />
          <Select
            value={unit}
            onValueChange={(v) => {
              const next = v as CollectionReadWindowUnit
              onUpdate({ windowUnit: next, windowAmount: clampWindow(amount, next) })
            }}
          >
            <SelectTrigger aria-label={t("collcfg.window")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="hours">{t("collcfg.hours")}</SelectItem>
              <SelectItem value="days">{t("collcfg.days")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <p className={HINT_CLASS}>{t("collcfg.windowHint")}</p>
      </div>

      <div>
        <Label className={LABEL_CLASS}>{t("collcfg.maxRecords")}</Label>
        <Input
          type="number"
          min={1}
          max={COLLECTION_READ_LIMIT_MAX}
          value={limit}
          className="mt-1.5"
          onChange={(e) => {
            const n = parseInt(e.target.value, 10)
            onUpdate({ limit: Number.isFinite(n) ? Math.max(1, Math.min(COLLECTION_READ_LIMIT_MAX, n)) : 50 })
          }}
        />
      </div>

      <div>
        <Label className={LABEL_CLASS}>{t("collcfg.order")}</Label>
        <Select value={data.order ?? "newest"} onValueChange={(v) => onUpdate({ order: v as CollectionReadOrder })}>
          <SelectTrigger aria-label={t("collcfg.order")} className="mt-1.5">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="newest">{t("collcfg.newestFirst")}</SelectItem>
            <SelectItem value="oldest">{t("collcfg.oldestFirst")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div>
        <Label className={LABEL_CLASS}>{t("collcfg.textFormat")}</Label>
        <Select value={data.textFormat ?? "headlines"} onValueChange={(v) => onUpdate({ textFormat: v as CollectionDigestFormat })}>
          <SelectTrigger aria-label={t("collcfg.textFormat")} className="mt-1.5">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="headlines">{t("collcfg.headlines")}</SelectItem>
            <SelectItem value="full">{t("collcfg.full")}</SelectItem>
          </SelectContent>
        </Select>
        <p className={HINT_CLASS}>{t("collcfg.readOutputsHint")}</p>
      </div>

      <RunError data={data} />
    </div>
  )
}

// ── Save to Collection ─────────────────────────────────────────

export function CollectionWriteConfig({ data, onUpdate, sources, fieldMappings, onMapField }: ConfigProps<CollectionWriteData>) {
  const t = useT()
  const mappable = { sources, fieldMappings, onMapField }

  return (
    <div className="space-y-4">
      <CollectionPicker collectionId={data.collectionId ?? ""} onPick={(c) => onUpdate({ collectionId: c.id, collectionName: c.name })} />
      <p className="text-[10px] text-muted-foreground">{t("collcfg.autoIngestHint")}</p>

      <MappableField field="title" label={t("collcfg.title")} {...mappable}>
        <Input value={data.title ?? ""} dir="auto" placeholder={t("collcfg.fromItemPh")} onChange={(e) => onUpdate({ title: e.target.value })} />
      </MappableField>

      <MappableField field="text" label={t("collcfg.text")} {...mappable}>
        <Textarea value={data.text ?? ""} dir="auto" rows={3} placeholder={t("collcfg.fromItemPh")} onChange={(e) => onUpdate({ text: e.target.value })} />
      </MappableField>

      <MappableField field="link" label={t("collcfg.link")} {...mappable}>
        <Input value={data.link ?? ""} dir="ltr" placeholder={t("collcfg.linkPh")} onChange={(e) => onUpdate({ link: e.target.value })} />
      </MappableField>

      <MappableField field="dedupeKey" label={t("collcfg.dedupeKey")} {...mappable}>
        <Input value={data.dedupeKey ?? ""} dir="ltr" placeholder={t("collcfg.dedupeKeyPh")} onChange={(e) => onUpdate({ dedupeKey: e.target.value })} />
      </MappableField>

      <div className="space-y-1">
        <p className="text-[10px] text-muted-foreground">{t("collcfg.dedupeKeyHint")}</p>
        <p className="text-[10px] text-muted-foreground">{t("collcfg.mediaHint")}</p>
        <p className="text-[10px] text-muted-foreground">{t("collcfg.writeOutputHint")}</p>
      </div>

      <RunError data={data} />
    </div>
  )
}
