"use client"

import { type ReactNode } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"

/**
 * Rendered view of a Generate Text result — either a syntax-highlighted JSON
 * object/array (when the output parses as JSON) or rendered GitHub-flavored
 * Markdown. Lazy-loaded by the node so `react-markdown` stays out of the
 * editor's main bundle.
 */

/** Syntax-highlighted, indented JSON. Pure tokenizer → colored spans; works in
 *  light + dark. Strings are split into keys (followed by `:`) vs values. */
function JsonHighlight({ value }: { value: unknown }) {
  const json = JSON.stringify(value, null, 2)
  const parts: ReactNode[] = []
  // group 1: string, group 2: trailing colon (→ it's a key), group 3:
  // boolean/null literal, group 4: number.
  const re = /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g
  let last = 0
  let key = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(json)) !== null) {
    if (m.index > last) parts.push(json.slice(last, m.index))
    if (m[1] !== undefined) {
      const isKey = m[2] !== undefined
      parts.push(
        <span key={key++} className={isKey ? "text-sky-600 dark:text-sky-300" : "text-emerald-600 dark:text-emerald-300"}>
          {m[1]}
        </span>,
      )
      if (isKey) parts.push(<span key={key++} className="text-muted-foreground">{m[2]}</span>)
    } else if (m[3] !== undefined) {
      parts.push(<span key={key++} className="text-fuchsia-600 dark:text-fuchsia-400">{m[3]}</span>)
    } else if (m[4] !== undefined) {
      parts.push(<span key={key++} className="text-amber-600 dark:text-amber-300">{m[4]}</span>)
    }
    last = re.lastIndex
  }
  if (last < json.length) parts.push(json.slice(last))
  return (
    <pre className="font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-words px-3 pb-3 pt-0.5 text-foreground/85">
      {parts}
    </pre>
  )
}

// Scoped Markdown typography. `@tailwindcss/typography` (`prose`) isn't
// installed in this project, so style the common elements via arbitrary-variant
// utilities instead — self-contained and won't silently render unstyled.
const MARKDOWN_CLASS =
  "text-sm text-foreground/85 px-3 pb-3 pt-0.5 break-words " +
  "[&>*:first-child]:mt-0 " +
  "[&_h1]:text-base [&_h1]:font-bold [&_h1]:mt-2 [&_h2]:text-sm [&_h2]:font-bold [&_h2]:mt-2 [&_h3]:font-semibold [&_h3]:mt-2 " +
  "[&_p]:my-1.5 [&_p]:leading-relaxed " +
  "[&_ul]:list-disc [&_ul]:pl-5 [&_ul]:my-1.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:my-1.5 [&_li]:my-0.5 " +
  "[&_code]:text-[12px] [&_code]:bg-black/5 dark:[&_code]:bg-white/10 [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded " +
  "[&_pre]:bg-black/5 dark:[&_pre]:bg-white/10 [&_pre]:p-2 [&_pre]:rounded-md [&_pre]:overflow-x-auto [&_pre]:my-2 [&_pre_code]:bg-transparent [&_pre_code]:p-0 " +
  "[&_a]:text-[#ff0073] [&_a]:underline [&_strong]:font-semibold [&_em]:italic " +
  "[&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-2 [&_blockquote]:text-muted-foreground [&_blockquote]:my-2 " +
  "[&_hr]:my-3 [&_hr]:border-border " +
  "[&_table]:w-full [&_table]:text-[11px] [&_table]:my-2 [&_th]:text-left [&_th]:font-semibold [&_th]:p-1 [&_th]:border [&_th]:border-border/50 [&_td]:p-1 [&_td]:border [&_td]:border-border/40"

export function LlmOutputView({ text, json }: { text: string; json?: unknown }) {
  if (json !== undefined) return <JsonHighlight value={json} />
  return (
    <div className={MARKDOWN_CLASS}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
    </div>
  )
}

export default LlmOutputView
