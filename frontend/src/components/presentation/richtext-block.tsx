import { useMemo } from "react"
import DOMPurify from "dompurify"

interface RichtextBlockProps {
  readonly content: string
}

export function RichtextBlock({ content }: RichtextBlockProps) {
  const sanitized = useMemo(() => DOMPurify.sanitize(content), [content])
  return (
    <div
      className="prose prose-sm prose-invert max-w-none text-muted-foreground"
      dangerouslySetInnerHTML={{ __html: sanitized }}
    />
  )
}
