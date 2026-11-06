// The stored settings sets' dialogs (SettingsSetsManager.tsx): a name to save
// or rename a set under, and the review of an imported file before anything
// is done with it.

import { useEffect, useState } from "react"
import { AlertTriangle, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { MotionSettingsCheck, MotionSettingsProblem, MotionSettingsWarning } from "@/ee/lib/nodaro-motion-settings-sets-api"

export function NameDialog({
  open,
  title,
  description,
  initialName,
  submitLabel,
  pending,
  error,
  onSubmit,
  onClose,
}: {
  readonly open: boolean
  readonly title: string
  readonly description: string
  readonly initialName: string
  readonly submitLabel: string
  readonly pending: boolean
  readonly error: string | null
  readonly onSubmit: (name: string) => void
  readonly onClose: () => void
}) {
  const [name, setName] = useState(initialName)
  useEffect(() => {
    if (open) setName(initialName)
  }, [open, initialName])
  const trimmed = name.trim()
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (trimmed) onSubmit(trimmed)
          }}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          <div className="my-4 flex flex-col gap-2">
            <Label htmlFor="settings-set-name">Name</Label>
            <Input id="settings-set-name" value={name} maxLength={120} autoFocus onChange={(e) => setName(e.target.value)} />
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!trimmed || pending}>
              {pending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** The problems that refuse a set or a file, one per line, at their paths. */
export function ProblemList({ problems }: { readonly problems: readonly MotionSettingsProblem[] }) {
  return (
    <ul className="max-h-48 list-disc overflow-auto pl-5 text-sm text-destructive" aria-label="Problems">
      {problems.map((p, i) => (
        <li key={`${p.path}-${i}`}>
          <code className="break-all text-xs">{p.path}</code>: {p.message}
        </li>
      ))}
    </ul>
  )
}

/** What the engines cannot run yet: each section's route would refuse it on Save. */
export function WarningList({ warnings }: { readonly warnings: readonly MotionSettingsWarning[] }) {
  if (warnings.length === 0) return null
  return (
    <div role="status" className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
      <p className="mb-1 flex items-center gap-1.5 font-medium text-amber-800 dark:text-amber-300">
        <AlertTriangle className="size-4 shrink-0" aria-hidden /> Not every engine can run this yet
      </p>
      <ul className="list-disc pl-5 text-foreground/90">
        {warnings.map((w) => (
          <li key={w.section}>
            <span className="font-medium">{w.label}:</span> {w.message}
          </li>
        ))}
      </ul>
      <p className="mt-1 text-xs text-muted-foreground">Saving these sections is refused until then; the others save.</p>
    </div>
  )
}

export function ImportReviewDialog({
  open,
  fileName,
  check,
  pending,
  error,
  onLoad,
  onStore,
  onClose,
}: {
  readonly open: boolean
  readonly fileName: string
  /** The server's check of the file, or a reason it could not be read at all. */
  readonly check: MotionSettingsCheck | null
  readonly pending: boolean
  readonly error: string | null
  readonly onLoad: () => void
  readonly onStore: (name: string) => void
  readonly onClose: () => void
}) {
  const [name, setName] = useState("")
  useEffect(() => {
    if (open) setName(check?.name ?? fileName.replace(/\.json$/i, ""))
  }, [open, check, fileName])
  const valid = check?.valid === true
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Import settings</DialogTitle>
          <DialogDescription>
            {fileName}
            {check?.name ? ` — “${check.name}”` : ""}. Nothing is saved or made live by importing.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          {check && !valid && (
            <>
              <p className="text-sm font-medium text-destructive">This file cannot be imported:</p>
              <ProblemList problems={check.errors} />
            </>
          )}
          {valid && <WarningList warnings={check.warnings} />}
          {valid && check.notes.length > 0 && (
            <ul className="list-disc pl-5 text-xs text-muted-foreground" aria-label="Notes">
              {check.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          )}
          {valid && (
            <div className="flex flex-col gap-2">
              <Label htmlFor="import-set-name">Name in the stored list</Label>
              <Input id="import-set-name" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
            </div>
          )}
        </div>
        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" variant="outline" disabled={!valid || pending || !name.trim()} onClick={() => onStore(name.trim())}>
            Add to stored sets
          </Button>
          <Button type="button" disabled={!valid || pending} onClick={onLoad}>
            {pending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            Load as draft
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
