// Admin → Nodaro Motion's stored settings sets, at the top of the page: named
// copies of every setting on the page (settings-sections.ts), to save the page
// under a name, load one back as a draft, overwrite, rename or delete one, and
// export or import one as a JSON file.
//
// Loading a set or a file never writes a live setting: it fills the page as a
// draft (DraftBanner.tsx), and Save all saves each section that differs
// through that section's own route — the same validation, engine checks and
// audit as the page's own Save. These settings are shared by staging and
// production. An imported file is checked by the server first
// (POST …/settings-sets/check): its problems are listed and nothing is done
// with it; what the engines cannot run yet is a warning, refused on Save.
//
// "Live: <name>" names the stored set the live settings match; once they no
// longer do, the set they matched last reads "<name>, edited". The page marks
// a set when it sees it live (POST …/:id/live): that is all it remembers.

import { useEffect, useMemo, useRef, useState } from "react"
import { Download, Loader2, MoreHorizontal, Save, Upload } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { DeleteConfirmationDialog } from "@/components/ui/delete-confirmation-dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import {
  checkMotionSettingsDocument,
  exportMotionSettings,
  type MotionSettings,
  type MotionSettingsCheck,
  type MotionSettingsSet,
  type MotionSettingsWarning,
} from "@/ee/lib/nodaro-motion-settings-sets-api"
import {
  useCreateMotionSettingsSet,
  useDeleteMotionSettingsSet,
  useMarkMotionSettingsSetLive,
  useMotionSettingsSets,
  useUpdateMotionSettingsSet,
} from "@/ee/hooks/queries/use-nodaro-motion-settings-sets"
import { MOTION_SETTINGS_KEYS, type MotionSettingsBindings } from "../settings-sections"
import {
  allReady,
  changedSections,
  exportFileName,
  liveMarker,
  liveSettings,
  loadSettings,
  matchesLive,
  needsLiveMark,
  pageSettings,
  saveChangedSections,
  type SectionSaveResult,
} from "../settings-sets-model"
import { DraftBanner, type MotionDraftOrigin } from "./DraftBanner"
import { ImportReviewDialog, NameDialog } from "./SettingsSetDialogs"

type Pending = { kind: "save-as" } | { kind: "rename"; set: MotionSettingsSet } | { kind: "overwrite"; set: MotionSettingsSet } | { kind: "delete"; set: MotionSettingsSet } | { kind: "replace-edits"; then: () => void }

function download(name: string, body: unknown): void {
  const url = URL.createObjectURL(new Blob([`${JSON.stringify(body, null, 2)}\n`], { type: "application/json" }))
  const a = document.createElement("a")
  a.href = url
  a.download = exportFileName(name)
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

/** A file's text (FileReader: read the same in every browser). */
function textOf(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ""))
    reader.onerror = () => reject(reader.error ?? new Error("The file could not be read."))
    reader.readAsText(file)
  })
}

function warningsSaid(warnings: readonly MotionSettingsWarning[]): string | undefined {
  return warnings.length === 0 ? undefined : `Not every engine can run ${warnings.map((w) => w.label).join(", ")} yet: saving those is refused until then.`
}

export function SettingsSetsManager({
  bindings,
  origin,
  onOrigin,
}: {
  readonly bindings: MotionSettingsBindings
  /** The loaded draft (null: none); while one is loaded the page's drafts never follow live by themselves. */
  readonly origin: MotionDraftOrigin | null
  readonly onOrigin: (origin: MotionDraftOrigin | null) => void
}) {
  const list = useMotionSettingsSets()
  const create = useCreateMotionSettingsSet()
  const update = useUpdateMotionSettingsSet()
  const remove = useDeleteMotionSettingsSet()
  const markLive = useMarkMotionSettingsSetLive()
  const [pending, setPending] = useState<Pending | null>(null)
  const [nameError, setNameError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const [results, setResults] = useState<SectionSaveResult[] | null>(null)
  const [imported, setImported] = useState<{ fileName: string; check: MotionSettingsCheck | null; error: string | null } | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const sets = list.data?.sets ?? []
  const sections = list.data?.sections ?? []
  const labels = useMemo(() => new Map(sections.map((s) => [s.key, s.label])), [sections])
  const labelOf = (key: string) => labels.get(key) ?? key
  // The page and the server must know the same sections, or a set would leave one out (or carry one the page cannot load).
  const mismatch = list.data
    ? [...sections.map((s) => s.key).filter((k) => !(MOTION_SETTINGS_KEYS as readonly string[]).includes(k)), ...MOTION_SETTINGS_KEYS.filter((k) => !labels.has(k))]
    : []
  const ready = allReady(bindings) && !!list.data && mismatch.length === 0
  const changed = ready ? changedSections(bindings) : []
  const marker = ready ? liveMarker(bindings, sets) : null

  // The set seen live is remembered, so it reads "<name>, edited" once the live settings move on.
  const marked = useRef<string | null>(null)
  useEffect(() => {
    if (!marker || !needsLiveMark(marker, sets) || marked.current === marker.set.id) return
    marked.current = marker.set.id
    markLive.mutate(marker.set.id)
  }, [marker, sets, markLive])

  // A loaded draft with nothing left to save is no draft any more (every section saved, or put back by hand).
  useEffect(() => {
    if (origin && ready && !saving && changed.length === 0) onOrigin(null)
  }, [origin, ready, saving, changed.length, onOrigin])

  const guardEdits = (then: () => void) => {
    if (changed.length > 0) setPending({ kind: "replace-edits", then })
    else then()
  }

  const loadDraft = (next: MotionDraftOrigin, settings: MotionSettings) => {
    if (matchesLive(bindings, settings)) {
      toast.success(`“${next.name}” matches the live settings.`)
      return
    }
    loadSettings(bindings, settings)
    setResults(null)
    onOrigin(next)
  }

  // A stored set is checked as an import is (its values may predate a section's rules), then loaded.
  const loadSet = (set: MotionSettingsSet) =>
    guardEdits(async () => {
      setBusy(true)
      try {
        const check = await checkMotionSettingsDocument({ format: list.data!.format, version: list.data!.version, name: set.name, settings: set.settings })
        if (!check.valid) {
          toast.error(`“${set.name}” cannot be loaded: ${check.errors.map((e) => `${e.path}: ${e.message}`).join("; ")}`)
          return
        }
        loadDraft({ name: set.name, kind: "set", setId: set.id, warnings: check.warnings, notes: check.notes }, check.settings)
      } catch (e) {
        toast.error(e instanceof Error ? e.message : String(e))
      } finally {
        setBusy(false)
      }
    })

  const onFile = async (file: File) => {
    setImported({ fileName: file.name, check: null, error: null })
    let doc: unknown
    try {
      doc = JSON.parse(await textOf(file))
    } catch {
      setImported({ fileName: file.name, check: null, error: "This file is not JSON." })
      return
    }
    try {
      setImported({ fileName: file.name, check: await checkMotionSettingsDocument(doc), error: null })
    } catch (e) {
      setImported({ fileName: file.name, check: null, error: e instanceof Error ? e.message : String(e) })
    }
  }

  const exportOf = async (name: string, settings: MotionSettings) => {
    try {
      download(name, await exportMotionSettings(name, settings))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    }
  }

  const saveAll = async () => {
    setSaving(true)
    setResults(null)
    try {
      const out = await saveChangedSections(bindings, sections.map((s) => s.key))
      setResults(out)
      if (out.every((r) => r.ok)) {
        toast.success(`Saved ${out.length} ${out.length === 1 ? "section" : "sections"}. Runs pick them up within a minute.`)
        onOrigin(null)
      }
    } finally {
      setSaving(false)
    }
  }

  const named = async (name: string) => {
    if (!pending) return
    setNameError(null)
    try {
      if (pending.kind === "save-as") {
        const { warnings } = await create.mutateAsync({ name, settings: pageSettings(bindings) })
        toast.success(`Stored “${name}”.`, { description: warningsSaid(warnings) })
      } else if (pending.kind === "rename") {
        await update.mutateAsync({ id: pending.set.id, name })
        toast.success(`Renamed to “${name}”.`)
      }
      setPending(null)
    } catch (e) {
      setNameError(e instanceof Error ? e.message : String(e))
    }
  }

  const confirmed = async () => {
    if (!pending) return
    const p = pending
    setPending(null)
    try {
      if (p.kind === "overwrite") {
        const { warnings } = await update.mutateAsync({ id: p.set.id, settings: pageSettings(bindings) })
        toast.success(`Overwrote “${p.set.name}” with the page.`, { description: warningsSaid(warnings) })
      } else if (p.kind === "delete") {
        await remove.mutateAsync(p.set.id)
        toast.success(`Deleted “${p.set.name}”.`)
      } else if (p.kind === "replace-edits") {
        p.then()
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    }
  }

  const disabled = !ready || busy || saving

  return (
    <>
      <section aria-labelledby="settings-sets-heading" className="mb-4 rounded-lg border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <h2 id="settings-sets-heading" className="text-sm font-semibold">
              Stored settings
            </h2>
            <p className="text-xs text-muted-foreground" data-live-marker>
              {marker ? (marker.edited ? `${marker.set.name}, edited` : `Live: ${marker.set.name}`) : "The live settings match no stored set."}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" className="min-h-9" disabled={disabled} onClick={() => setPending({ kind: "save-as" })}>
              <Save className="mr-1 h-4 w-4" aria-hidden /> Save as…
            </Button>
            <Button size="sm" variant="outline" className="min-h-9" disabled={!list.data || busy || saving} onClick={() => fileInput.current?.click()}>
              <Upload className="mr-1 h-4 w-4" aria-hidden /> Import…
            </Button>
            <Button size="sm" variant="outline" className="min-h-9" disabled={disabled} onClick={() => void exportOf("Live settings", liveSettings(bindings))}>
              <Download className="mr-1 h-4 w-4" aria-hidden /> Export live
            </Button>
            <input
              ref={fileInput}
              type="file"
              accept="application/json,.json"
              aria-label="Import a settings file"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                e.target.value = ""
                if (file) void onFile(file)
              }}
            />
          </div>
        </div>
        {list.isLoading && (
          <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
          </p>
        )}
        {list.error && <p className="mt-3 text-xs text-destructive">{list.error.message}</p>}
        {mismatch.length > 0 && (
          <p role="alert" className="mt-3 text-xs text-destructive">
            This page and the server do not know the same settings ({mismatch.join(", ")}): reload the page before using stored sets.
          </p>
        )}
        {list.data && sets.length === 0 && <p className="mt-3 text-xs text-muted-foreground">No stored sets yet. Save as… stores the page as it is now.</p>}
        {sets.length > 0 && (
          <ul className="mt-3 divide-y rounded-md border" aria-label="Stored sets">
            {sets.map((set) => {
              const isLive = marker?.set.id === set.id
              return (
                <li key={set.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {set.name}
                      {isLive && (
                        <span
                          className={`ml-2 rounded-full px-2 py-0.5 text-[11px] font-medium ${marker?.edited ? "bg-amber-500/15 text-amber-800 dark:text-amber-300" : "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300"}`}
                        >
                          {marker?.edited ? "Live, edited" : "Live"}
                        </span>
                      )}
                      {origin?.setId === set.id && <span className="ml-2 rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] text-amber-800 dark:text-amber-300">Draft</span>}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {set.unreadable ?? `Saved ${new Date(set.updatedAt).toLocaleString()}${set.updatedBy ? ` by ${set.updatedBy}` : ""}`}
                    </p>
                  </div>
                  <Button size="sm" variant="secondary" className="min-h-8" disabled={disabled || !!set.unreadable} onClick={() => loadSet(set)}>
                    Load as draft
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button size="sm" variant="ghost" className="min-h-8 px-2" aria-label={`More for ${set.name}`} disabled={busy || saving}>
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem disabled={!ready} onSelect={() => setPending({ kind: "overwrite", set })}>
                        Overwrite with the page…
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => setPending({ kind: "rename", set })}>Rename…</DropdownMenuItem>
                      <DropdownMenuItem disabled={!!set.unreadable} onSelect={() => void exportOf(set.name, set.settings)}>
                        Export JSON
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => setPending({ kind: "delete", set })}>
                        Delete…
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {origin && (
        <DraftBanner
          origin={origin}
          changed={changed.map(labelOf)}
          labelOf={labelOf}
          saving={saving}
          results={results}
          onSaveAll={() => void saveAll()}
          onDiscard={() => {
            setResults(null)
            onOrigin(null)
          }}
        />
      )}

      <NameDialog
        open={pending?.kind === "save-as" || pending?.kind === "rename"}
        title={pending?.kind === "rename" ? "Rename stored set" : "Save the page as a stored set"}
        description={
          pending?.kind === "rename"
            ? `A new name for “${pending.set.name}”. Its settings stay as they are.`
            : "Stores every setting on this page as it is now, unsaved changes included. Nothing goes live."
        }
        initialName={pending?.kind === "rename" ? pending.set.name : ""}
        submitLabel={pending?.kind === "rename" ? "Rename" : "Store"}
        pending={create.isPending || update.isPending}
        error={nameError}
        onSubmit={(name) => void named(name)}
        onClose={() => {
          setNameError(null)
          setPending(null)
        }}
      />
      <DeleteConfirmationDialog
        isOpen={pending?.kind === "delete" || pending?.kind === "overwrite" || pending?.kind === "replace-edits"}
        onClose={() => setPending(null)}
        onConfirm={() => void confirmed()}
        title={
          pending?.kind === "delete"
            ? `Delete “${pending.set.name}”?`
            : pending?.kind === "overwrite"
              ? `Overwrite “${pending.set.name}”?`
              : "Replace your unsaved changes?"
        }
        description={
          pending?.kind === "delete"
            ? "The stored set is removed from the list. The live settings do not change."
            : pending?.kind === "overwrite"
              ? "The stored set takes every setting on this page as it is now, unsaved changes included. The live settings do not change."
              : "Loading fills the page with other values: the changes you have not saved are lost."
        }
        warning={pending?.kind === "delete" ? "This cannot be undone from the page." : undefined}
        confirmLabel={pending?.kind === "delete" ? "Delete" : pending?.kind === "overwrite" ? "Overwrite" : "Replace"}
      />
      <ImportReviewDialog
        open={imported !== null}
        fileName={imported?.fileName ?? ""}
        check={imported?.check ?? null}
        pending={busy || create.isPending}
        error={imported?.error ?? null}
        onClose={() => setImported(null)}
        onLoad={() => {
          const check = imported?.check
          if (!check?.valid) return
          setImported(null)
          guardEdits(() => loadDraft({ name: check.name ?? imported!.fileName, kind: "file", warnings: check.warnings, notes: check.notes }, check.settings))
        }}
        onStore={async (name) => {
          const check = imported?.check
          if (!check?.valid) return
          try {
            const { warnings } = await create.mutateAsync({ name, settings: check.settings })
            toast.success(`Stored “${name}”.`, { description: warningsSaid(warnings) })
            setImported(null)
          } catch (e) {
            setImported({ fileName: imported!.fileName, check, error: e instanceof Error ? e.message : String(e) })
          }
        }}
      />
    </>
  )
}
