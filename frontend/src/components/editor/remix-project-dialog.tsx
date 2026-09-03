import { useMemo, useState } from "react"
import { useT } from "@/lib/i18n"
import { useProjectDisplayName } from "@/lib/project-display-name"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useProjects } from "@/hooks/queries/use-projects-queries"
import { isStudioProject } from "@/lib/studio"

interface RemixProjectDialogProps {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly onConfirm: (projectId: string) => Promise<void>
}

export function RemixProjectDialog({ open, onOpenChange, onConfirm }: RemixProjectDialogProps) {
  const t = useT()
  const projectDisplayName = useProjectDisplayName()
  const { data: projects = [] } = useProjects()
  const targets = useMemo(() => projects.filter((p) => !isStudioProject(p)), [projects])
  const defaultId = useMemo(() => targets.find((p) => p.isDefault)?.id ?? targets[0]?.id ?? "", [targets])
  // Selection defaults to the default project; an explicit pick overrides it.
  // Deriving (vs mirroring with useEffect) avoids clobbering the user's choice
  // if the project list resolves after mount.
  const [override, setOverride] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const selected = override ?? defaultId

  const confirm = async () => {
    if (!selected) return
    setBusy(true)
    try { await onConfirm(selected); onOpenChange(false) }
    finally { setBusy(false) }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>{t("project.remixTitle")}</DialogTitle>
          <DialogDescription>{t("project.remixDesc")}</DialogDescription>
        </DialogHeader>
        <div className="py-2">
          <Select value={selected} onValueChange={setOverride}>
            <SelectTrigger><SelectValue placeholder={t("project.remixSelect")} /></SelectTrigger>
            <SelectContent>
              {targets.map((p) => (
                <SelectItem key={p.id} value={p.id}>{projectDisplayName(p)}{p.isDefault ? ` ${t("project.defaultSuffix")}` : ""}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>{t("common.cancel")}</Button>
          <Button onClick={confirm} disabled={busy || !selected}>{busy ? t("project.remixCloning") : t("project.remixTitle")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
