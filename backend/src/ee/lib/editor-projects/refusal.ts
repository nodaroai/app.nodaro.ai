/**
 * An editor-project refusal: a status and the code the editor reads
 * (`{ error: "<code>" }`). Pure, with no imports, so the heavy-work thread
 * (`heavy-worker.ts`) throws the same refusals the routes answer; the codes
 * and their meanings are listed in `errors.ts`.
 */
export class EditorProjectRefusal extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code)
    this.name = "EditorProjectRefusal"
  }
}

export const refuse = (status: number, code: string): EditorProjectRefusal => new EditorProjectRefusal(status, code)
