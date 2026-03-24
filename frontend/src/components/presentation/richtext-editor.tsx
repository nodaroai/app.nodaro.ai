import { useEditor, EditorContent } from "@tiptap/react"
import StarterKit from "@tiptap/starter-kit"
import Link from "@tiptap/extension-link"
import { Bold, Italic, Heading2, Heading3, Link as LinkIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useCallback, useRef, useEffect } from "react"

interface RichtextEditorProps {
  readonly content: string
  readonly onChange: (html: string) => void
  readonly placeholder?: string
}

export function RichtextEditor({ content, onChange, placeholder }: RichtextEditorProps) {
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  const debouncedOnChange = useCallback((html: string) => {
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => onChange(html), 300)
  }, [onChange])

  useEffect(() => () => clearTimeout(debounceRef.current), [])

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
      }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: { class: "text-pink-400 underline" },
      }),
    ],
    content,
    onUpdate: ({ editor: e }) => {
      debouncedOnChange(e.getHTML())
    },
    editorProps: {
      attributes: {
        class:
          "prose prose-sm prose-invert max-w-none min-h-[80px] px-3 py-2 text-sm text-foreground focus:outline-none",
        ...(placeholder ? { "data-placeholder": placeholder } : {}),
      },
    },
  })

  const toggleLink = useCallback(() => {
    if (!editor) return
    if (editor.isActive("link")) {
      editor.chain().focus().unsetLink().run()
      return
    }
    const url = window.prompt("URL")
    if (url) {
      editor.chain().focus().setLink({ href: url }).run()
    }
  }, [editor])

  if (!editor) return null

  return (
    <div className="rounded-lg border border-border bg-muted/30 overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center gap-0.5 border-b border-border px-1 py-1">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={`h-7 w-7 ${editor.isActive("bold") ? "bg-muted text-foreground" : "text-muted-foreground"}`}
          onClick={() => editor.chain().focus().toggleBold().run()}
          aria-label="Bold"
          aria-pressed={editor.isActive("bold")}
        >
          <Bold className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={`h-7 w-7 ${editor.isActive("italic") ? "bg-muted text-foreground" : "text-muted-foreground"}`}
          onClick={() => editor.chain().focus().toggleItalic().run()}
          aria-label="Italic"
          aria-pressed={editor.isActive("italic")}
        >
          <Italic className="h-4 w-4" />
        </Button>

        <div className="w-px h-4 bg-border mx-0.5" />

        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={`h-7 w-7 ${editor.isActive("heading", { level: 2 }) ? "bg-muted text-foreground" : "text-muted-foreground"}`}
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          aria-label="Heading 2"
          aria-pressed={editor.isActive("heading", { level: 2 })}
        >
          <Heading2 className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={`h-7 w-7 ${editor.isActive("heading", { level: 3 }) ? "bg-muted text-foreground" : "text-muted-foreground"}`}
          onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
          aria-label="Heading 3"
          aria-pressed={editor.isActive("heading", { level: 3 })}
        >
          <Heading3 className="h-4 w-4" />
        </Button>

        <div className="w-px h-4 bg-border mx-0.5" />

        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={`h-7 w-7 ${editor.isActive("link") ? "bg-muted text-foreground" : "text-muted-foreground"}`}
          onClick={toggleLink}
          aria-label="Link"
          aria-pressed={editor.isActive("link")}
        >
          <LinkIcon className="h-4 w-4" />
        </Button>
      </div>

      {/* Editor area */}
      <EditorContent editor={editor} />
    </div>
  )
}
