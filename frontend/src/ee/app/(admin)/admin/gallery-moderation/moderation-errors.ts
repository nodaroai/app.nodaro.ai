import { GalleryAdminError } from "@/hooks/queries/use-gallery-admin-queries"
import { tx, type MessageKey } from "@/lib/i18n"

/** What the server's refusal codes mean, in the admin's language. */
const ERROR_KEYS: Record<string, MessageKey> = {
  empty_word: "galleryModeration.errEmptyWord",
  exception_without_word: "galleryModeration.errExceptionWithoutWord",
  too_many_words: "galleryModeration.errTooManyWords",
  too_many_entries: "galleryModeration.errTooManyEntries",
  word_too_long: "galleryModeration.errTooLong",
  unknown_word: "galleryModeration.errUnknownWord",
  user_not_found: "galleryModeration.errUserNotFound",
  too_many_users: "galleryModeration.errTooManyUsers",
  busy: "galleryModeration.errBusy",
}

export function moderationErrorText(error: unknown): string {
  const code = error instanceof GalleryAdminError ? error.code : null
  return tx((code && ERROR_KEYS[code]) || "galleryModeration.errGeneric")
}
