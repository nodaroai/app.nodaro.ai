import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"

export interface CustomTextRowsProps {
  /** Stable id prefix for label/textarea pairing — must be unique per config. */
  readonly idPrefix: string
  readonly preText?: string
  readonly postText?: string
  readonly prePlaceholder?: string
  readonly postPlaceholder?: string
  readonly onChange: (patch: { preText?: string; postText?: string }) => void
}

/**
 * Two free-text rows (Custom text before / after) that compose around the
 * structured hint of a parameter-picker. Mirrors the pattern used by
 * PersonConfig / MoodConfig / PoseConfig / StylingConfig — the user-typed
 * fragments are prepended and appended to the prompt-hint via the catalog's
 * `build*Hints` function (or via the `withCustomText` helper in
 * `parameter-prompt-hint.ts` for single-string get*PromptHint helpers).
 */
export function CustomTextRows({
  idPrefix,
  preText,
  postText,
  prePlaceholder = "e.g. ...",
  postPlaceholder = "e.g. ...",
  onChange,
}: CustomTextRowsProps) {
  return (
    <>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${idPrefix}-pre-text`} className="text-xs text-muted-foreground">
          Custom text (before)
        </Label>
        <Textarea
          id={`${idPrefix}-pre-text`}
          value={preText ?? ""}
          onChange={(e) => onChange({ preText: e.target.value })}
          placeholder={prePlaceholder}
          rows={2}
          className="text-xs resize-none"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${idPrefix}-post-text`} className="text-xs text-muted-foreground">
          Custom text (after)
        </Label>
        <Textarea
          id={`${idPrefix}-post-text`}
          value={postText ?? ""}
          onChange={(e) => onChange({ postText: e.target.value })}
          placeholder={postPlaceholder}
          rows={2}
          className="text-xs resize-none"
        />
      </div>
    </>
  )
}
