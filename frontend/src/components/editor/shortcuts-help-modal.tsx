import { Keyboard } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Kbd } from "@/components/ui/kbd"
import {
  SHORTCUTS,
  SHORTCUT_CATEGORIES,
  formatBindingCaps,
  isMacPlatform,
  type ShortcutDef,
} from "@/lib/shortcuts"

interface ShortcutsHelpModalProps {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
}

export function ShortcutsHelpModal({ open, onOpenChange }: ShortcutsHelpModalProps) {
  const isMac = isMacPlatform()
  const defs = (Object.values(SHORTCUTS) as ShortcutDef[]).filter((d) => !d.hidden)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[640px] max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Keyboard className="h-4 w-4 text-[#ff0073]" />
            Keyboard shortcuts
          </DialogTitle>
        </DialogHeader>

        <div className="grid gap-x-8 gap-y-6 sm:grid-cols-2">
          {SHORTCUT_CATEGORIES.map((cat) => {
            const items = defs.filter((d) => d.category === cat)
            if (items.length === 0) return null
            return (
              <section key={cat}>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#ff0073]">
                  {cat}
                </h3>
                <ul className="space-y-1.5">
                  {items.map((d) => (
                    <li key={d.id} className="flex items-center justify-between gap-3 text-sm">
                      <span className="text-muted-foreground">{d.description}</span>
                      <span className="flex shrink-0 items-center gap-1">
                        {formatBindingCaps(d.bindings[0], isMac).map((cap, i) => (
                          <Kbd key={i}>{cap}</Kbd>
                        ))}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )
          })}
        </div>
      </DialogContent>
    </Dialog>
  )
}
