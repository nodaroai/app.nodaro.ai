"use client"

import { useState } from "react"
import { Play, Loader2, Sparkles, Check, Maximize2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ImageLightbox } from "@/components/ui/image-lightbox"
import { CachedImage } from "@/components/ui/cached-image"

export function CharacterAssetButton({
  label,
  status,
  itemCount,
  onClick,
  disabled,
}: {
  readonly label: string
  readonly status: "idle" | "running" | "completed" | "failed"
  readonly itemCount: number
  readonly onClick: () => void
  readonly disabled?: boolean
}) {
  const isRunning = status === "running"
  return (
    <Button
      variant="outline"
      size="sm"
      className="w-full justify-between text-xs h-8"
      disabled={isRunning || disabled}
      onClick={onClick}
    >
      <span className="flex items-center gap-1.5">
        {isRunning ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
        {label}
      </span>
      {itemCount > 0 && (
        <span className="text-muted-foreground">{itemCount} images</span>
      )}
    </Button>
  )
}

export function CharacterAssetGrid({ items }: { readonly items: readonly { name: string; url: string }[] }) {
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null)

  if (items.length === 0) return null
  return (
    <>
      <div className="grid grid-cols-3 gap-1">
        {items.map((item) => (
          <button
            key={item.name}
            type="button"
            className="flex flex-col items-center gap-0.5 cursor-pointer"
            onClick={() => setLightboxSrc(item.url)}
            title={`${item.name} - click to enlarge`}
          >
            <div className="w-full aspect-square rounded overflow-hidden bg-muted/30 hover:ring-2 hover:ring-primary/50 transition-shadow">
              <CachedImage src={item.url} alt={item.name} className="w-full h-full object-cover" thumbnail thumbnailWidth={160} />
            </div>
            <span className="text-[9px] text-muted-foreground truncate w-full text-center">{item.name}</span>
          </button>
        ))}
      </div>
      {lightboxSrc && (
        <ImageLightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />
      )}
    </>
  )
}

export function ObjectAssetButton({
  label,
  status,
  itemCount,
  onClick,
  disabled,
}: {
  readonly label: string
  readonly status: string
  readonly itemCount: number
  readonly onClick: () => void
  readonly disabled: boolean
}) {
  const isRunning = status === "running"
  return (
    <Button
      variant="outline"
      size="sm"
      className="w-full text-xs h-7 justify-start"
      disabled={disabled || isRunning}
      onClick={onClick}
    >
      {isRunning ? (
        <>
          <Loader2 className="w-3 h-3 mr-1.5 animate-spin" />
          Generating...
        </>
      ) : itemCount > 0 ? (
        <>
          <Check className="w-3 h-3 mr-1.5 text-emerald-500" />
          {label} ({itemCount})
        </>
      ) : (
        <>
          <Play className="w-3 h-3 mr-1.5" />
          {label}
        </>
      )}
    </Button>
  )
}

export function ObjectAssetGrid({ items }: { readonly items: Array<{ name: string; url: string }> }) {
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null)

  if (items.length === 0) return null
  return (
    <>
      <div className="grid grid-cols-3 gap-1">
        {items.map((item) => (
          <button
            key={item.url}
            type="button"
            className="relative aspect-square rounded overflow-hidden bg-muted/30 group cursor-pointer"
            onClick={() => setLightboxSrc(item.url)}
            title={item.name}
          >
            <CachedImage src={item.url} alt={item.name} className="w-full h-full object-cover" thumbnail thumbnailWidth={160} />
            <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
              <Maximize2 className="w-4 h-4 text-white" />
            </div>
            <span className="absolute bottom-0 left-0 right-0 text-[8px] bg-black/60 text-white text-center truncate px-0.5">
              {item.name}
            </span>
          </button>
        ))}
      </div>
      {lightboxSrc && (
        <ImageLightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />
      )}
    </>
  )
}

export function LocationAssetButton({
  label,
  status,
  itemCount,
  onClick,
  disabled,
}: {
  readonly label: string
  readonly status: string
  readonly itemCount: number
  readonly onClick: () => void
  readonly disabled: boolean
}) {
  const isRunning = status === "running"
  return (
    <Button
      variant="outline"
      size="sm"
      className="w-full text-xs h-7 justify-start"
      disabled={disabled || isRunning}
      onClick={onClick}
    >
      {isRunning ? (
        <>
          <Loader2 className="w-3 h-3 mr-1.5 animate-spin" />
          Generating...
        </>
      ) : itemCount > 0 ? (
        <>
          <Check className="w-3 h-3 mr-1.5 text-cyan-500" />
          {label} ({itemCount})
        </>
      ) : (
        <>
          <Play className="w-3 h-3 mr-1.5" />
          {label}
        </>
      )}
    </Button>
  )
}

export function LocationAssetGrid({ items }: { readonly items: Array<{ name: string; url: string }> }) {
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null)

  if (items.length === 0) return null
  return (
    <>
      <div className="grid grid-cols-3 gap-1">
        {items.map((item) => (
          <button
            key={item.url}
            type="button"
            className="relative aspect-square rounded overflow-hidden bg-muted/30 group cursor-pointer"
            onClick={() => setLightboxSrc(item.url)}
            title={item.name}
          >
            <CachedImage src={item.url} alt={item.name} className="w-full h-full object-cover" thumbnail thumbnailWidth={160} />
            <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
              <Maximize2 className="w-4 h-4 text-white" />
            </div>
            <span className="absolute bottom-0 left-0 right-0 text-[8px] bg-black/60 text-white text-center truncate px-0.5">
              {item.name}
            </span>
          </button>
        ))}
      </div>
      {lightboxSrc && (
        <ImageLightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />
      )}
    </>
  )
}
