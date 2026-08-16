"use client"

import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { ProviderTile } from "@/lib/provider-tiles"
import { useProviderKeyEditor } from "@/lib/use-provider-key-editor"

/**
 * One provider row on Integrations → Model providers: name, what the key
 * powers, its state, and paste / change / remove. Same state machine as the
 * /setup tile (`useProviderKeyEditor`); this is the dashboard's look.
 */
interface Props {
  readonly tile: ProviderTile
  /** Fired after a successful save/clear so the card re-reads /setup/status. */
  readonly onChanged: () => void
}

export function ProviderKeyRow({ tile, onChanged }: Props) {
  const editor = useProviderKeyEditor(tile.id, onChanged)
  const { phase, value, error, busy } = editor
  const inputId = `integrations-provider-key-${tile.id}`
  const editing = phase === "editing" || phase === "saving"
  const ownKeyNeeded = !tile.cloudCovered && tile.id !== "nodaro" && !tile.present

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-gray-200 dark:border-[#2D2D2D] bg-gray-50/60 dark:bg-[#252525] p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-900 dark:text-white">{tile.name}</span>
            <StateBadge tile={tile} />
          </div>
          <p className="mt-0.5 text-[11px] font-mono text-gray-500 dark:text-gray-400 break-words">
            {tile.env}
            {tile.powers ? <span className="text-gray-400 dark:text-gray-500"> · {tile.powers}</span> : null}
          </p>
        </div>
      </div>

      {ownKeyNeeded && (
        <p className="text-[11px] text-amber-700 dark:text-amber-400">
          Own key needed — connecting nodaro.ai does not cover this.
        </p>
      )}

      {tile.editable ? (
        editing ? (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              void editor.save()
            }}
            className="flex flex-wrap items-center gap-2"
          >
            <label htmlFor={inputId} className="sr-only">
              {tile.env}
            </label>
            <Input
              id={inputId}
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder={`Paste your ${tile.name} key`}
              value={value}
              onChange={(e) => editor.setValue(e.target.value)}
              disabled={busy}
              className="h-8 flex-1 min-w-[200px] font-mono text-xs"
            />
            <Button type="submit" size="sm" disabled={busy} className="h-8 bg-[#ff0073] hover:bg-[#e0005f] text-white">
              {phase === "saving" && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              {phase === "saving" ? "Saving…" : "Save"}
            </Button>
            <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={editor.cancel} className="h-8">
              Cancel
            </Button>
          </form>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" variant="outline" onClick={editor.startEditing} className="h-7 text-xs">
              {tile.present ? "Change key" : "Paste key"}
            </Button>
            {tile.present && tile.source === "app" && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => void editor.remove()}
                className="h-7 text-xs text-red-600 hover:text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/30"
              >
                {phase === "removing" ? "Removing…" : "Remove"}
              </Button>
            )}
            {tile.whereToGet && !tile.present && (
              <span className="text-[11px] text-gray-400 dark:text-gray-500">get one at {tile.whereToGet}</span>
            )}
          </div>
        )
      ) : tile.source === "env" ? (
        <p className="text-[11px] text-gray-500 dark:text-gray-400">
          Set by the environment — remove <span className="font-mono">{tile.env}</span> from .env to manage it here.
        </p>
      ) : tile.id === "nodaro" && tile.source === "oauth" ? (
        <p className="text-[11px] text-gray-500 dark:text-gray-400">Connected above — disconnect there to use a personal API key instead.</p>
      ) : null}

      {error && (
        <p role="alert" className="text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  )
}

function StateBadge({ tile }: { readonly tile: ProviderTile }) {
  if (tile.present) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
        {tile.state}
      </span>
    )
  }
  return (
    <span className="inline-flex items-center rounded-full border border-dashed border-gray-300 dark:border-gray-600 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500">
      missing
    </span>
  )
}
