"use client"

import { useCallback, useState } from "react"
import { uploadFile, StorageExceededError, type UploadResult } from "@/lib/api"
import { useAuth } from "./use-auth"

export interface StorageExceededState {
  readonly exceeded: boolean
  readonly usedBytes: number
  readonly quotaBytes: number
  readonly remainingBytes: number
  readonly tier: string
}

export interface FileUploadState {
  readonly isUploading: boolean
  readonly uploadError: string | null
}

const EMPTY_STORAGE: StorageExceededState = {
  exceeded: false,
  usedBytes: 0,
  quotaBytes: 0,
  remainingBytes: 0,
  tier: "free",
}

export function useFileUpload() {
  const { user } = useAuth()
  const [isUploading, setIsUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [storageExceeded, setStorageExceeded] = useState<StorageExceededState>(EMPTY_STORAGE)

  const upload = useCallback(
    async (file: File): Promise<UploadResult> => {
      setIsUploading(true)
      setUploadError(null)
      setStorageExceeded(EMPTY_STORAGE)

      try {
        const result = await uploadFile(file, user?.id)
        return result
      } catch (err) {
        if (err instanceof StorageExceededError) {
          setStorageExceeded({
            exceeded: true,
            usedBytes: err.usedBytes,
            quotaBytes: err.quotaBytes,
            remainingBytes: err.remainingBytes,
            tier: err.tier,
          })
        }
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

  const clearStorageExceeded = useCallback(() => {
    setStorageExceeded(EMPTY_STORAGE)
  }, [])

  return { upload, isUploading, uploadError, clearError, storageExceeded, clearStorageExceeded }
}
