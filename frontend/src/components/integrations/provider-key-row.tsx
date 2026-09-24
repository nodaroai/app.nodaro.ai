"use client"

import { useState } from "react"

import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { ProviderTile } from "@/lib/provider-tiles"
import { NodaroScopeDialog } from "./nodaro-scope-dialog"
import { useProviderKeyEditor } from "@/lib/use-provider-key-editor"
import { useT } from "@/lib/i18n"

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
  const [scopeDialogOpen, setScopeDialogOpen] = useState(false)
  const t = useT()
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
          {t("integ.ownKeyNeeded")}
        </p>
      )}

      {tile.editable || tile.canReplaceEnv || tile.canDisable ? (
        editing ? (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              // Replace-.env (4b): a plain save over an env-managed key would 409.
              void (tile.canReplaceEnv ? editor.saveReplacingEnv() : editor.save()).then((ok) => {
                // A freshly pasted nodaro key is a new connection — ask how
                // it should route (the 4b post-connect choice).
                if (ok && tile.id === "nodaro") setScopeDialogOpen(true)
              })
            }}
            className="flex flex-wrap items-center gap-2"
          >
            <label htmlFor={inputId} className="sr-only">
              {tile.env}
            </label>
            <Input dir="ltr"
              id={inputId}
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder={t("integ.pasteYourKey", { name: tile.name })}
              value={value}
              onChange={(e) => editor.setValue(e.target.value)}
              disabled={busy}
              className="h-8 flex-1 min-w-[200px] font-mono text-xs"
            />
            <Button type="submit" size="sm" disabled={busy} className="h-8 bg-[#ff0073] hover:bg-[#e0005f] text-white">
              {phase === "saving" && <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" />}
              {phase === "saving" ? t("common.saving") : t("common.save")}
            </Button>
            <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={editor.cancel} className="h-8">
              {t("common.cancel")}
            </Button>
          </form>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            {(tile.editable || tile.canReplaceEnv) && (
              <Button type="button" size="sm" variant="outline" onClick={editor.startEditing} className="h-7 text-xs">
                {tile.canReplaceEnv ? t("integ.replaceEnvKey") : tile.present ? t("integ.changeKey") : t("integ.pasteKey")}
              </Button>
            )}
            {tile.canDisable && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => void editor.setDisabled(!tile.disabled)}
                className={tile.disabled ? "h-7 text-xs text-emerald-600 hover:text-emerald-700" : "h-7 text-xs text-gray-500"}
              >
                {phase === "toggling" ? "…" : tile.disabled ? t("common.enable") : t("common.disable")}
              </Button>
            )}
            {tile.present && tile.source === "app" && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => void editor.remove()}
                className="h-7 text-xs text-red-600 hover:text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/30"
              >
                {phase === "removing" ? t("integ.removing") : t("common.remove")}
              </Button>
            )}
            {tile.whereToGet && !tile.present && (
              <span className="text-[11px] text-gray-400 dark:text-gray-500">{t("integ.getOneAt", { url: tile.whereToGet })}</span>
            )}
          </div>
        )
      ) : tile.source === "env" ? (
        <p className="text-[11px] text-gray-500 dark:text-gray-400">
          {t("integ.setByEnvPre")} <span className="font-mono">{tile.env}</span> {t("integ.setByEnvPost")}
        </p>
      ) : tile.id === "nodaro" && tile.source === "oauth" ? (
        <p className="text-[11px] text-gray-500 dark:text-gray-400">{t("integ.connectedAboveHint")}</p>
      ) : null}

      {error && (
        <p role="alert" className="text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
      {tile.id === "nodaro" && (
        <NodaroScopeDialog open={scopeDialogOpen} onClose={() => setScopeDialogOpen(false)} />
      )}
    </div>
  )
}

function StateBadge({ tile }: { readonly tile: ProviderTile }) {
  const t = useT()
  if (tile.disabled && tile.present) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 dark:bg-gray-800 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
        <span className="h-1.5 w-1.5 rounded-full bg-gray-400" />
        {t("integ.stateDisabled")}
      </span>
    )
  }
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
      {t("integ.stateMissing")}
    </span>
  )
}
