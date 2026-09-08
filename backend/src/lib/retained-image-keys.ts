import { RetainedImageInUseError } from "./retained-image-errors.js"

const PREFIX = "retained-images/"
const ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i

export function retainedImageKey(id: string): string {
  if (!ID.test(id)) throw new Error("Invalid retained image id")
  return `${PREFIX}${id}`
}

/** Ordinary deletion never owns these objects. Only tombstoned GC tasks do. */
export function assertOrdinaryMediaKey(key: string): void {
  if (key.startsWith(PREFIX)) throw new RetainedImageInUseError()
}
