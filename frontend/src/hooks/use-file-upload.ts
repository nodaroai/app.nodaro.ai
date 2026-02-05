"use client"

import { useCallback, useState } from "react"
import { uploadFile, type UploadResult } from "@/lib/api"
import { useAuth } from "./use-auth"

export interface FileUploadState {
  readonly isUploading: boolean
  readonly uploadError: string | null
}

export function useFileUpload() {
  const { user } = useAuth()
  const [isUploading, setIsUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)

  const upload = useCallback(
    async (file: File): Promise<UploadResult> => {
      setIsUploading(true)
      setUploadError(null)

      try {
        const result = await uploadFile(file, user?.id)
        return result
      } catch (err) {
        const message = err instanceof Error ? err.message : "Upload failed"
        setUploadError(message)
        throw err
      } finally {
        setIsUploading(false)
      }
    },
    [user?.id],
  )

  const clearError = useCallback(() => {
    setUploadError(null)
  }, [])

  return { upload, isUploading, uploadError, clearError }
}
