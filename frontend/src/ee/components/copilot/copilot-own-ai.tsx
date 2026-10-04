/**
 * "Prefer your own AI?" — one quiet row under the Copilot in the middle of the
 * canvas: Claude Code, Claude and ChatGPT, each opening the connect page of
 * nodaro.ai/mcp on that client's tab, in a new browser tab.
 *
 * It floats on the canvas, so it wears the canvas surfaces like the rest of the
 * middle. Platform links: hidden where the deployment hides those (`mcpLinksShown`).
 * The marks are drawn here, not fetched from an icon CDN — the editor makes no
 * third-party request to show them. ChatGPT is a plain circle until its mark
 * arrives as a file.
 */
import { COPILOT_KEYS as K } from "@/ee/lib/copilot/strings"
import { useT } from "@/lib/i18n"
import { useUserLocale } from "@/lib/locale-store"
import { mcpClientUrl, mcpLinksShown, type McpClientSlug } from "@/lib/mcp-links"

/** Claude's spark: eight rays from the middle, in its terracotta. */
function ClaudeMark() {
  return (
    <svg viewBox="0 0 24 24" className="w-[13px] h-[13px] text-[#D97757]" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" aria-hidden>
      {Array.from({ length: 8 }, (_, i) => {
        const angle = (i * Math.PI) / 4
        return (
          <line
            key={i}
            x1={12 + 3 * Math.cos(angle)}
            y1={12 + 3 * Math.sin(angle)}
            x2={12 + 9.5 * Math.cos(angle)}
            y2={12 + 9.5 * Math.sin(angle)}
          />
        )
      })}
    </svg>
  )
}

/** A stand-in until the ChatGPT mark arrives as a file. */
function CircleMark() {
  return <span className="w-3 h-3 flex-none rounded-full border-[1.5px] border-current" aria-hidden />
}

const CLIENTS: ReadonlyArray<{ slug: McpClientSlug; name: string; Mark: () => React.JSX.Element }> = [
  { slug: "claude-code", name: "Claude Code", Mark: ClaudeMark },
  { slug: "claude", name: "Claude", Mark: ClaudeMark },
  { slug: "chatgpt", name: "ChatGPT", Mark: CircleMark },
]

export function CopilotOwnAi() {
  const t = useT()
  const lang = useUserLocale()
  if (!mcpLinksShown()) return null
  // The chips centre under the column, with the question in front of them:
  // the two outer columns share what is left over equally, so the question
  // does not push the chips off the middle. Grid columns follow the reading
  // direction, so the question leads in Hebrew as well.
  return (
    <div className="w-full grid grid-cols-[1fr_auto_1fr] items-center gap-1.5 text-xs text-[var(--pill-fg-muted)]/60">
      <span className="justify-self-end whitespace-nowrap">{t(K.ownAiPrompt)}</span>
      <div className="flex flex-wrap items-center justify-center gap-1.5">
        {CLIENTS.map(({ slug, name, Mark }) => (
          <a
            key={slug}
            href={mcpClientUrl(slug, { lang })}
            target="_blank"
            rel="noopener noreferrer"
            title={t(K.ownAiLinkTitle, { client: name })}
            className="flex items-center gap-1.5 px-2.5 py-[5px] rounded-full border border-border bg-[var(--node-card)] text-[var(--pill-fg-muted)] hover:text-[var(--pill-fg)] hover:border-[var(--pill-fg-muted)]/40 transition-colors"
          >
            <Mark />
            {name}
          </a>
        ))}
      </div>
      <span aria-hidden />
    </div>
  )
}
