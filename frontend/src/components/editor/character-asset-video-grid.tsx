"use client"

/**
 * Read-only grid for character video assets (motion clips + uploaded reference
 * videos). Mirrors `AssetGrid`'s layout (`grid grid-cols-3 gap-4`, same
 * empty-state style) and `DraggableImage`'s label styling, but renders an inline
 * `<video controls>` per item — no drag/delete/add-to-canvas (videos are not
 * draggable onto the canvas the way images are).
 */
export function CharacterAssetVideoGrid({
  items,
  emptyMessage,
}: {
  readonly items: readonly { readonly name: string; readonly url: string }[]
  readonly emptyMessage: string
}) {
  if (items.length === 0) {
    return (
      <p className="text-sm text-muted-foreground text-center py-12">
        {emptyMessage}
      </p>
    )
  }
  return (
    <div className="grid grid-cols-3 gap-4">
      {items.map((item, i) => (
        <div key={`${item.name}-${i}`} className="flex flex-col gap-1.5">
          <video
            src={item.url}
            controls
            preload="metadata"
            className="w-full rounded-lg border border-border aspect-square object-cover"
          />
          {item.name && (
            <p className="text-xs text-muted-foreground text-center truncate">{item.name}</p>
          )}
        </div>
      ))}
    </div>
  )
}
