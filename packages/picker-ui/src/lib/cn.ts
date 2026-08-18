import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

/** Local `cn` — mirrors the app's `@/lib/utils` helper so moved components
 *  keep their exact class-merging semantics without importing app paths. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
