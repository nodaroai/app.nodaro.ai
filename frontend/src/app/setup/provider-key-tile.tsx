import type { ProviderTile } from "@/lib/provider-tiles"
import { useProviderKeyEditor } from "@/lib/use-provider-key-editor"

/**
 * One Install-health provider tile with its paste field.
 *
 * The paste / remove state machine is `useProviderKeyEditor` (shared with
 * the Integrations "Model providers" row); this file is only the setup
 * screen's look. Env wins: a key managed by the environment is read-only
 * here, with the variable named; the OAuth-connected nodaro.ai tile is
 * read-only too (its lever is Integrations).
 */

const INK = "#0b0d12"
const MUTED = "#5b5f68"
const FAINT = "#a3a7ae"
const ACCENT = "#ff0073"
const MONO = "'JetBrains Mono Variable', 'Geist Mono Variable', ui-monospace, monospace"

interface Props {
  readonly tile: ProviderTile
  /** Fired after a successful save/clear so the page re-reads /setup/status. */
  readonly onChanged: () => void
}

export function ProviderKeyTile({ tile, onChanged }: Props) {
  const editor = useProviderKeyEditor(tile.id, onChanged)
  const { phase, value, error, busy } = editor
  const inputId = `provider-key-${tile.id}`
  const stateColor = tile.present ? "#166534" : FAINT

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        padding: "14px 22px",
        borderBottom: "1px solid rgba(11,13,18,.05)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
          <span style={{ fontSize: 14, fontWeight: 500 }}>{tile.name}</span>
          <span style={{ fontFamily: MONO, fontSize: 11, color: FAINT }}>
            {tile.env}
            {tile.powers ? <span style={{ color: MUTED }}> · {tile.powers}</span> : null}
          </span>
        </div>
        <span
          style={{
            fontFamily: MONO,
            fontSize: 11,
            letterSpacing: ".06em",
            textTransform: "uppercase",
            color: stateColor,
            border: tile.present ? "1px solid rgba(22,163,74,.35)" : "1px dashed rgba(11,13,18,.18)",
            borderRadius: 6,
            padding: "3px 8px",
            whiteSpace: "nowrap",
          }}
        >
          {tile.state}
        </span>
      </div>

      {!tile.cloudCovered && tile.id !== "nodaro" && !tile.present && (
        <span style={{ fontFamily: MONO, fontSize: 10.5, color: MUTED }}>
          own key needed — connecting nodaro.ai does not cover this
        </span>
      )}

      {tile.editable ? (
        phase === "idle" || phase === "removing" ? (
          <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
            <button type="button" onClick={editor.startEditing} style={linkButton}>
              {tile.present ? "CHANGE KEY →" : "PASTE KEY →"}
            </button>
            {tile.present && tile.source === "app" && (
              <button type="button" onClick={() => void editor.remove()} disabled={busy} style={{ ...linkButton, color: "#b60a43" }}>
                {phase === "removing" ? "REMOVING…" : "REMOVE"}
              </button>
            )}
            {tile.whereToGet && !tile.present && (
              <span style={{ fontFamily: MONO, fontSize: 10.5, color: FAINT }}>get one at {tile.whereToGet}</span>
            )}
          </div>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              void editor.save()
            }}
            style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}
          >
            <label htmlFor={inputId} style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>
              {tile.env}
            </label>
            <input
              id={inputId}
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder={`paste your ${tile.name} key`}
              value={value}
              onChange={(e) => editor.setValue(e.target.value)}
              disabled={busy}
              style={{
                flex: "1 1 260px",
                fontFamily: MONO,
                fontSize: 12.5,
                padding: "8px 10px",
                border: "1px solid rgba(11,13,18,.18)",
                borderRadius: 8,
                background: "#fff",
                color: INK,
              }}
            />
            <button
              type="submit"
              disabled={busy}
              style={{
                border: "none",
                background: ACCENT,
                color: "#fff",
                fontWeight: 700,
                fontSize: 12.5,
                padding: "8px 14px",
                borderRadius: 8,
                cursor: busy ? "wait" : "pointer",
                opacity: busy ? 0.75 : 1,
              }}
            >
              {phase === "saving" ? "Saving…" : "Save"}
            </button>
            <button type="button" disabled={busy} onClick={editor.cancel} style={linkButton}>
              CANCEL
            </button>
          </form>
        )
      ) : tile.source === "env" ? (
        <span style={{ fontFamily: MONO, fontSize: 10.5, color: MUTED }}>
          set by the environment — remove {tile.env} from .env to manage it here
        </span>
      ) : null}

      {error && (
        <span role="alert" style={{ fontSize: 12.5, lineHeight: 1.45, color: "#b60a43" }}>
          {error}
        </span>
      )}
    </div>
  )
}

const linkButton: React.CSSProperties = {
  border: "none",
  background: "transparent",
  cursor: "pointer",
  fontFamily: MONO,
  fontSize: 11,
  letterSpacing: ".08em",
  color: INK,
  textDecoration: "underline",
  textUnderlineOffset: 4,
  whiteSpace: "nowrap",
  padding: 0,
}
