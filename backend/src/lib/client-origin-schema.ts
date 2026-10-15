import { z } from "zod"

/**
 * `origin` on a generation request: the slug of the client app that sent it
 * (`create-image`, `studio`, ...). Caller-written, stored in `input_data`, and
 * what `GET /v1/jobs?origin=` filters on. The same shape the character and
 * picker routes accept.
 */
export const clientOriginSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/)
