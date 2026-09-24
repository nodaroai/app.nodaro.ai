"use client"

import { useState, useRef } from "react"
import { createPortal } from "react-dom"
import { X, Upload, ImageIcon, FileText, Loader2 } from "lucide-react"
import { CachedImage } from "@/components/ui/cached-image"
import { uploadImage } from "@/lib/api"
import { useT, tx } from "@/lib/i18n"
import type { CharacterDefinition } from "@/types/nodes"

interface DefineCharacterModalProps {
  readonly isOpen: boolean
  readonly onClose: () => void
  readonly onSave: (char: CharacterDefinition) => void
  readonly existingNames: readonly string[]
  readonly editingCharacter?: CharacterDefinition | null
}

export function DefineCharacterModal({
  isOpen,
  onClose,
  onSave,
  existingNames,
  editingCharacter,
}: DefineCharacterModalProps) {
  const [name, setName] = useState("")
  const [type, setType] = useState<"reference" | "description">("description")
  const [description, setDescription] = useState("")
  const [referenceImageUrl, setReferenceImageUrl] = useState("")
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState("")
  const [initialized, setInitialized] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const t = useT()

  // Pre-fill when editing
  if (isOpen && editingCharacter && !initialized) {
    setName(editingCharacter.name)
    setType(editingCharacter.type)
    setDescription(editingCharacter.description ?? "")
    setReferenceImageUrl(editingCharacter.referenceImageUrl ?? "")
    setInitialized(true)
  }

  if (!isOpen) return null

  function reset() {
    setName("")
    setType("description")
    setDescription("")
    setReferenceImageUrl("")
    setUploading(false)
    setError("")
    setInitialized(false)
  }

  function handleClose() {
    reset()
    onClose()
  }

  async function handleFileUpload(file: File) {
    if (!file.type.startsWith("image/")) {
      setError(tx("entity.selectImageFile"))
      return
    }
    setUploading(true)
    setError("")
    try {
      const { url } = await uploadImage(file)
      setReferenceImageUrl(url)
    } catch (err) {
      setError(err instanceof Error ? err.message : tx("pipe.uploadFailed"))
    } finally {
      setUploading(false)
    }
  }

  function handleSave() {
    const trimmedName = name.trim()
    if (!trimmedName) {
      setError(tx("pubTemplate.nameRequired"))
      return
    }
    const isNameTaken = existingNames.includes(trimmedName) && (!editingCharacter || editingCharacter.name !== trimmedName)
    if (isNameTaken) {
      setError(tx("entity.characterNameTaken"))
      return
    }
    if (type === "description" && !description.trim()) {
      setError(tx("entity.descriptionRequired"))
      return
    }
    if (type === "reference" && !referenceImageUrl) {
      setError(tx("entity.uploadReferenceRequired"))
      return
    }

    const char: CharacterDefinition = {
      id: editingCharacter?.id ?? crypto.randomUUID(),
      name: trimmedName,
      type,
      ...(type === "reference" ? { referenceImageUrl } : { description: description.trim() }),
    }
    onSave(char)
    handleClose()
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/50"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) handleClose()
      }}
    >
      <div
        className="bg-background border rounded-lg shadow-xl w-full max-w-md mx-4"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <h3 className="text-sm font-semibold">{editingCharacter ? t("entity.editCharacter") : t("entity.defineNewCharacter")}</h3>
          <button type="button" onClick={handleClose} className="p-1 rounded-md hover:bg-muted">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 flex flex-col gap-4">
          {/* Name */}
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">{t("common.name")}</label>
            <input
              type="text"
              value={name}
              onChange={(e) => { setName(e.target.value); setError("") }}
              placeholder={t("entity.characterNamePlaceholder")}
              className="w-full px-3 py-2 text-sm border rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-primary"
              autoFocus
            />
          </div>

          {/* Type toggle */}
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-2">{t("entity.typeLabel")}</label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setType("reference")}
                className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs rounded-md border transition-colors ${
                  type === "reference" ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted"
                }`}
              >
                <ImageIcon className="w-3.5 h-3.5" /> {t("field.referenceImage")}
              </button>
              <button
                type="button"
                onClick={() => setType("description")}
                className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs rounded-md border transition-colors ${
                  type === "description" ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted"
                }`}
              >
                <FileText className="w-3.5 h-3.5" /> {t("entity.textDescription")}
              </button>
            </div>
          </div>

          {/* Reference image upload */}
          {type === "reference" && (
            <div>
              {referenceImageUrl ? (
                <div className="relative">
                  <CachedImage src={referenceImageUrl} alt={t("imgcfg.referenceAlt")} className="w-full h-32 object-contain rounded-md border" thumbnail thumbnailWidth={480} />
                  <button
                    type="button"
                    onClick={() => setReferenceImageUrl("")}
                    className="absolute top-1 end-1 p-0.5 rounded-full bg-background/80 hover:bg-destructive hover:text-destructive-foreground"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className="w-full h-24 border-2 border-dashed rounded-md flex flex-col items-center justify-center gap-1 text-muted-foreground hover:border-primary hover:text-primary transition-colors"
                >
                  {uploading ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    <>
                      <Upload className="w-5 h-5" />
                      <span className="text-xs">{t("entity.clickToUploadImage")}</span>
                    </>
                  )}
                </button>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/avif,image/heic,image/heif"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) handleFileUpload(file)
                  e.target.value = ""
                }}
              />
            </div>
          )}

          {/* Description textarea */}
          {type === "description" && (
            <div>
              <textarea
                value={description}
                onChange={(e) => { setDescription(e.target.value); setError("") }}
                placeholder={t("entity.characterDescPlaceholder")}
                rows={3}
                className="w-full px-3 py-2 text-sm border rounded-md bg-background resize-none focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <p className="text-[10px] text-muted-foreground mt-1">
                {t("entity.descAppendedHint")}
              </p>
              <p className="text-[10px] text-orange-500/80 mt-1">
                {t("entity.noReferenceTip")}
              </p>
            </div>
          )}

          {/* Error */}
          {error && (
            <p className="text-xs text-destructive">{error}</p>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-4 py-3 border-t">
          <button
            type="button"
            onClick={handleClose}
            className="px-3 py-1.5 text-xs rounded-md border hover:bg-muted transition-colors"
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={uploading || !name.trim() || (type === "description" && !description.trim()) || (type === "reference" && !referenceImageUrl)}
            className="px-3 py-1.5 text-xs rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {editingCharacter ? t("common.update") : t("entity.saveCharacter")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
