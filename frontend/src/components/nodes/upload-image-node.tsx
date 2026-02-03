"use client"

import { memo, useState } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { ImageIcon, Maximize2 } from "lucide-react"
import { BaseNode } from "./base-node"
import { ImageLightbox } from "@/components/ui/image-lightbox"
import type { UploadImageData } from "@/types/nodes"

function UploadImageNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as UploadImageData
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null)
  const imageUrl = nodeData.url

  return (
    <>
      <BaseNode
        id={id}
        label={nodeData.label}
        icon={<ImageIcon className="h-4 w-4" />}
        category="input"
        credits={0}
        selected={selected}
        handles={[
          { id: "image", type: "source", position: Position.Right, label: "Image" },
        ]}
      >
        {imageUrl ? (
          <div className="relative group">
            <div className="w-full aspect-square rounded-md overflow-hidden bg-muted/30">
              <img
                src={imageUrl}
                alt="Uploaded image"
                className="w-full h-full object-cover cursor-pointer"
                onClick={(e) => {
                  e.stopPropagation()
                  setLightboxSrc(imageUrl)
                }}
              />
            </div>
            <button
              type="button"
              className="absolute bottom-1 right-1 w-5 h-5 flex items-center justify-center bg-black/50 hover:bg-black/70 text-white rounded opacity-0 group-hover:opacity-100 transition-opacity"
              onClick={(e) => {
                e.stopPropagation()
                setLightboxSrc(imageUrl)
              }}
              title="Enlarge"
            >
              <Maximize2 className="w-3 h-3" />
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-center h-16 rounded-md border-2 border-dashed border-muted-foreground/20 text-muted-foreground/40">
            <ImageIcon className="w-5 h-5" />
          </div>
        )}
      </BaseNode>

      <ImageLightbox
        src={lightboxSrc}
        alt="Uploaded image"
        onClose={() => setLightboxSrc(null)}
      />
    </>
  )
}

export const UploadImageNode = memo(UploadImageNodeComponent)
