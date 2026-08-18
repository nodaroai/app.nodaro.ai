"use client"

import { useEffect, useState } from "react"
import { Cloud, Loader2 } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { getAuthHeaders } from "@/lib/api"
import { toast } from "sonner"

export interface NodaroProviderPrefs {
  readonly scope: "all" | "exclusives"
  readonly precedence: "nodaro" | "local"
}

/**
 * The post-connect choice (4b): how the nodaro.ai credential participates in
 * routing. Pops once right after a connection is made — an API key pasted on
 * a provider tile, or a completed OAuth Connect — and is reachable later
 * from the nodaro card's "Change".
 *
 * Founder defaults (2026-08-18): scope "all" with precedence "nodaro" is
 * pre-selected, and CLOSING the dialog without choosing applies exactly
 * that — the pre-selection IS the answer, so `onOpenChange(false)` saves it
 * too. Installs that connected before this dialog existed have no stored
 * prefs and keep the legacy routing (all/local) until they open it.
 */
const DEFAULT_PREFS: NodaroProviderPrefs = { scope: "all", precedence: "nodaro" }

export async function saveNodaroPrefs(prefs: NodaroProviderPrefs): Promise<boolean> {
  try {
    const headers = await getAuthHeaders()
    const res = await fetch("/v1/nodaro-connect/prefs", {
      method: "PUT",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify(prefs),
    })
    return res.ok
  } catch {
    return false
  }
}

function RadioRow({
  checked,
  onSelect,
  title,
  detail,
  indent,
}: {
  readonly checked: boolean
  readonly onSelect: () => void
  readonly title: string
  readonly detail: string
  readonly indent?: boolean
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      onClick={onSelect}
      className={`flex w-full items-start gap-2.5 rounded-lg border p-3 text-left transition-colors ${
        checked
          ? "border-[#ff0073]/60 bg-[#ff0073]/5"
          : "border-gray-200 dark:border-[#2D2D2D] hover:border-gray-300 dark:hover:border-[#3D3D3D]"
      } ${indent ? "ml-6" : ""}`}
    >
      <span
        aria-hidden
        className={`mt-0.5 inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border ${
          checked ? "border-[#ff0073]" : "border-gray-300 dark:border-gray-600"
        }`}
      >
        {checked && <span className="h-2 w-2 rounded-full bg-[#ff0073]" />}
      </span>
      <span className="flex flex-col gap-0.5">
        <span className="text-sm font-medium">{title}</span>
        <span className="text-xs text-gray-500 dark:text-gray-400">{detail}</span>
      </span>
    </button>
  )
}

export function NodaroScopeDialog({
  open,
  onClose,
  initial,
}: {
  readonly open: boolean
  readonly onClose: (saved: NodaroProviderPrefs | null) => void
  /** Current stored prefs when reopened from the card's "Change". */
  readonly initial?: NodaroProviderPrefs | null
}) {
  const [scope, setScope] = useState<NodaroProviderPrefs["scope"]>(DEFAULT_PREFS.scope)
  const [precedence, setPrecedence] = useState<NodaroProviderPrefs["precedence"]>(DEFAULT_PREFS.precedence)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) {
      setScope(initial?.scope ?? DEFAULT_PREFS.scope)
      setPrecedence(initial?.precedence ?? DEFAULT_PREFS.precedence)
    }
  }, [open, initial])

  async function commit(prefs: NodaroProviderPrefs) {
    setSaving(true)
    const ok = await saveNodaroPrefs(prefs)
    setSaving(false)
    if (!ok) {
      toast.error("Could not save the nodaro.ai routing choice — try again from Integrations")
      onClose(null)
      return
    }
    onClose(prefs)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Dismissal applies the current selection — the pre-selected defaults
        // ARE the answer when the user just closes the dialog.
        if (!next && !saving) void commit({ scope, precedence })
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Cloud className="h-5 w-5 text-[#ff0073]" />
            How should nodaro.ai be used?
          </DialogTitle>
          <DialogDescription>
            You can change this anytime from Integrations → nodaro.ai.
          </DialogDescription>
        </DialogHeader>

        <div role="radiogroup" aria-label="nodaro.ai scope" className="flex flex-col gap-2">
          <RadioRow
            checked={scope === "all"}
            onSelect={() => setScope("all")}
            title="nodaro for everything"
            detail="All generation runs through nodaro.ai — billed to your nodaro.ai account."
          />
          {scope === "all" && (
            <div role="radiogroup" aria-label="who runs when you also have your own provider keys" className="flex flex-col gap-2">
              <RadioRow
                indent
                checked={precedence === "nodaro"}
                onSelect={() => setPrecedence("nodaro")}
                title="nodaro first"
                detail="Ignore my other provider keys — everything is billed to my nodaro.ai account."
              />
              <RadioRow
                indent
                checked={precedence === "local"}
                onSelect={() => setPrecedence("local")}
                title="My keys first"
                detail="My own providers (KIE, Replicate…) run what they can; nodaro.ai fills the gaps."
              />
            </div>
          )}
          <RadioRow
            checked={scope === "exclusives"}
            onSelect={() => setScope("exclusives")}
            title="Only the Nodaro-exclusive nodes"
            detail="Video Pro, Voice Changer Pro, Video Analysis… — everything else keeps using your own providers."
          />
        </div>

        <DialogFooter>
          <Button
            onClick={() => void commit({ scope, precedence })}
            disabled={saving}
            className="bg-[#ff0073] hover:bg-[#e0005f] text-white"
          >
            {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
