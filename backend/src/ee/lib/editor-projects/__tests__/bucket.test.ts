import { describe, it, expect, vi, beforeEach } from "vitest"
import { Readable } from "node:stream"
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, type S3Client } from "@aws-sdk/client-s3"

const deletes = vi.hoisted(() => ({ skipped: false }))
vi.mock("@/lib/storage-deletes-setting.js", async (original) => ({
  ...(await original<typeof import("@/lib/storage-deletes-setting.js")>()),
  storageDeletesSkipped: () => deletes.skipped,
}))

import {
  StorageOperationError, createEditorProjectsStore, editorProjectsStore, resetEditorProjectsStoreForTest, resolveEditorProjectsStorageConfig,
  withPrivateEditorProjectParams,
} from "../bucket.js"

/**
 * The private bucket project files live in (EDITOR_PROJECTS_BUCKET): how it is
 * configured, that it is never the media bucket, that its writes carry no
 * public ACL, and that it deletes nothing on a deployment that deletes nothing.
 */

const MEDIA = "media-bucket"

describe("resolveEditorProjectsStorageConfig", () => {
  it("is off (null) when EDITOR_PROJECTS_BUCKET is unset or blank", () => {
    expect(resolveEditorProjectsStorageConfig({}, MEDIA)).toBeNull()
    expect(resolveEditorProjectsStorageConfig({ EDITOR_PROJECTS_BUCKET: "  " }, MEDIA)).toBeNull()
  })

  it("refuses the media bucket itself", () => {
    expect(() => resolveEditorProjectsStorageConfig({ EDITOR_PROJECTS_BUCKET: MEDIA, R2_ACCESS_KEY_ID: "k", R2_SECRET_ACCESS_KEY: "s", R2_ENDPOINT: "https://s3" }, MEDIA)).toThrow(/must not be the public media bucket/)
  })

  it("refuses a bucket with no credentials or endpoint", () => {
    expect(() => resolveEditorProjectsStorageConfig({ EDITOR_PROJECTS_BUCKET: "projects" }, MEDIA)).toThrow(/credentials or endpoint/)
  })

  it("refuses an endpoint that is not an http(s) URL, naming the variable and not its value", () => {
    for (const endpoint of ["not a url", "ftp://store", "secret-host:9000"]) {
      let message = ""
      try {
        resolveEditorProjectsStorageConfig({ EDITOR_PROJECTS_BUCKET: "projects", R2_ACCESS_KEY_ID: "k", R2_SECRET_ACCESS_KEY: "s", EDITOR_PROJECTS_S3_ENDPOINT: endpoint }, MEDIA)
      } catch (err) {
        message = (err as Error).message
      }
      expect(message, endpoint).toContain("EDITOR_PROJECTS_S3_ENDPOINT")
      expect(message).not.toContain(endpoint)
    }
  })

  it("falls back to the media store's endpoint and credentials, and prefers its own", () => {
    expect(resolveEditorProjectsStorageConfig({ EDITOR_PROJECTS_BUCKET: "projects", R2_ACCESS_KEY_ID: "k", R2_SECRET_ACCESS_KEY: "s", R2_ACCOUNT_ID: "acct" }, MEDIA)).toEqual({
      bucket: "projects", endpoint: "https://acct.r2.cloudflarestorage.com", region: "auto", accessKeyId: "k", secretAccessKey: "s", forcePathStyle: false,
    })
    expect(resolveEditorProjectsStorageConfig({
      EDITOR_PROJECTS_BUCKET: "projects", R2_ACCESS_KEY_ID: "k", R2_SECRET_ACCESS_KEY: "s", R2_ENDPOINT: "https://media",
      EDITOR_PROJECTS_S3_ACCESS_KEY_ID: "pk", EDITOR_PROJECTS_S3_SECRET_ACCESS_KEY: "ps", EDITOR_PROJECTS_S3_ENDPOINT: "https://private",
      EDITOR_PROJECTS_S3_REGION: "eu", EDITOR_PROJECTS_S3_FORCE_PATH_STYLE: "true",
    }, MEDIA)).toEqual({ bucket: "projects", endpoint: "https://private", region: "eu", accessKeyId: "pk", secretAccessKey: "ps", forcePathStyle: true })
  })
})

describe("withPrivateEditorProjectParams", () => {
  it("binds the private bucket and refuses a bucket or ACL override", () => {
    expect(withPrivateEditorProjectParams("projects", MEDIA, { Key: "k" })).toEqual({ Key: "k", Bucket: "projects" })
    expect(() => withPrivateEditorProjectParams(MEDIA, MEDIA, { Key: "k" })).toThrow()
    expect(() => withPrivateEditorProjectParams("projects", MEDIA, { Key: "k", ACL: "public-read" } as never)).toThrow()
  })
})

describe("createEditorProjectsStore", () => {
  const sent: unknown[] = []
  const objects = new Map<string, Buffer>()
  const client = {
    send: vi.fn(async (command: unknown) => {
      sent.push(command)
      if (command instanceof PutObjectCommand) {
        objects.set(command.input.Key!, Buffer.from(command.input.Body as Buffer))
        return {}
      }
      if (command instanceof GetObjectCommand) {
        const body = objects.get(command.input.Key!)
        if (!body) throw Object.assign(new Error("NoSuchKey"), { name: "NoSuchKey" })
        return { Body: Readable.from([body]), ContentLength: body.length }
      }
      if (command instanceof DeleteObjectCommand) {
        objects.delete(command.input.Key!)
        return {}
      }
      throw new Error("unexpected command")
    }),
  } as unknown as S3Client
  const store = createEditorProjectsStore(
    { bucket: "projects", endpoint: "https://private", region: "auto", accessKeyId: "k", secretAccessKey: "s", forcePathStyle: false },
    MEDIA,
    client,
  )

  beforeEach(() => {
    sent.length = 0
    objects.clear()
    deletes.skipped = false
  })

  it("writes to the private bucket with no ACL, whatever STORAGE_OBJECT_ACL says, and reads it back", async () => {
    await store.put("editor-projects/u/p/k.json.gz", Buffer.from("gz"))
    const put = sent[0] as PutObjectCommand
    expect(put.input.Bucket).toBe("projects")
    expect("ACL" in put.input).toBe(false)
    expect(put.input.CacheControl).toBe("private, no-store")
    expect(await store.read("editor-projects/u/p/k.json.gz", 10)).toEqual(Buffer.from("gz"))
    expect(await store.read("missing", 10)).toBeNull()
    await expect(store.read("editor-projects/u/p/k.json.gz", 1)).rejects.toMatchObject({ status: 413, code: "too_large" })
  })

  it("deletes from the private bucket, and deletes nothing where storage deletes are off", async () => {
    await store.put("k", Buffer.from("x"))
    deletes.skipped = true
    expect(await store.delete("k")).toBe("skipped")
    expect(objects.has("k")).toBe(true)
    deletes.skipped = false
    expect(await store.delete("k")).toBe("deleted")
    expect(objects.has("k")).toBe(false)
    const del = sent.find((c) => c instanceof DeleteObjectCommand) as DeleteObjectCommand
    expect(del.input.Bucket).toBe("projects")
  })
})

describe("editorProjectsStore (resolved once, at boot)", () => {
  it("a misconfigured bucket is logged once, naming the variable and not its value, and is then treated as unset", () => {
    const saved = { ...process.env }
    try {
      process.env.EDITOR_PROJECTS_BUCKET = "secret-bucket-name"
      process.env.EDITOR_PROJECTS_S3_ACCESS_KEY_ID = ""
      resetEditorProjectsStoreForTest()
      const errors: Array<{ obj: object; msg: string }> = []
      const log = { error: (obj: object, msg: string) => void errors.push({ obj, msg }) }
      expect(editorProjectsStore(log)).toBeNull()
      expect(editorProjectsStore(log)).toBeNull()
      expect(errors).toHaveLength(1)
      expect(errors[0]!.obj).toEqual({ variable: "EDITOR_PROJECTS_BUCKET" })
      expect(errors[0]!.msg).toContain("EDITOR_PROJECTS_BUCKET")
      expect(JSON.stringify(errors)).not.toContain("secret-bucket-name")
    } finally {
      process.env = saved
      resetEditorProjectsStoreForTest()
    }
  })
})

describe("storage failures leave the adapter carrying only the operation, the error name and the status", () => {
  it("drops the error body's fields (Key, BucketName, Resource) and the message", async () => {
    const leaky = Object.assign(new Error("failed for editor-projects/u/p/k.json.gz"), {
      name: "AccessDenied", Key: "editor-projects/u/p/k.json.gz", BucketName: "projects", Resource: "/projects/editor-projects/u/p/k.json.gz",
      $metadata: { httpStatusCode: 403 },
    })
    const client = { send: vi.fn(async () => { throw leaky }) } as unknown as S3Client
    const store = createEditorProjectsStore(
      { bucket: "projects", endpoint: "https://private", region: "auto", accessKeyId: "k", secretAccessKey: "s", forcePathStyle: false },
      MEDIA,
      client,
    )
    for (const call of [() => store.put("editor-projects/u/p/k.json.gz", Buffer.from("x")), () => store.read("editor-projects/u/p/k.json.gz", 10), () => store.stream("editor-projects/u/p/k.json.gz"), () => store.exists("editor-projects/u/p/k.json.gz"), () => store.delete("editor-projects/u/p/k.json.gz")]) {
      const err = await call().then(() => null, (e: unknown) => e)
      expect(err).toBeInstanceOf(StorageOperationError)
      expect(JSON.stringify({ ...(err as object), message: (err as Error).message })).not.toMatch(/editor-projects\/u|projects\/editor|BucketName/)
      expect(err).toMatchObject({ errorName: "AccessDenied", httpStatusCode: 403 })
    }
  })
})
