/**
 * Upload-handoff route: a tiny user-facing upload page (GET) plus its
 * multipart receiver (POST), both gated by an HMAC-signed token.
 *
 * Why this exists: Claude.ai web's bash sandbox blocks egress to every
 * object-storage host (r2.cloudflarestorage.com, mcp.nodaro.ai, even
 * s3.amazonaws.com / storage.googleapis.com) — confirmed by probe — so
 * the curl-presigned path (`prepare_*_upload` → /v1/upload-proxy/...)
 * cannot work from inside Claude.ai's chat. Anthropic's "Additional
 * allowed domains" UI at claude.ai/settings/capabilities is also broken
 * (issue #19087): adds don't propagate to the JWT allowlist.
 *
 * The handoff path solves that by routing the upload through the user's
 * own browser instead of Claude's sandbox. Claude calls
 * `request_*_upload`, which mints a token and tells Claude the eventual
 * public URL up-front (deterministic from the token's `key` field).
 * Claude shows the user a download button (for the attached image they
 * want to edit) plus an upload-page link. The user opens the link in a
 * fresh browser tab — no sandbox involved — drops the file, this route
 * stores it at the predetermined R2 key, and Claude reuses the URL it
 * already had.
 *
 * Token TTL: 1 hour. Body limit: 256 MB. Token IS the auth — the user
 * doesn't need a Nodaro session to use the page.
 */
import type { FastifyInstance } from "fastify"
import multipart from "@fastify/multipart"
import sharp from "sharp"
import { PutObjectCommand } from "@aws-sdk/client-s3"
import { s3 } from "../lib/storage.js"
import { config } from "../lib/config.js"
import { verifyUploadToken } from "./upload-proxy.js"

const MAX_HANDOFF_BYTES = 256 * 1024 * 1024 // 256 MB

const KIND_MIME_PREFIX: Record<"image" | "audio" | "video", string> = {
  image: "image/",
  audio: "audio/",
  video: "video/",
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case "&":
        return "&amp;"
      case "<":
        return "&lt;"
      case ">":
        return "&gt;"
      case '"':
        return "&quot;"
      case "'":
        return "&#39;"
      default:
        return c
    }
  })
}

function renderPage(opts: {
  token: string
  kind: "image" | "audio" | "video"
}): string {
  const accept = `${opts.kind}/*`
  const kindLabel = opts.kind.charAt(0).toUpperCase() + opts.kind.slice(1)
  const escToken = escapeHtml(opts.token)
  const escKind = escapeHtml(opts.kind)
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Upload ${kindLabel} — Nodaro</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
         background: #0c0c0e; color: #f5f5f7; min-height: 100vh;
         display: flex; align-items: center; justify-content: center; padding: 24px; }
  .card { width: 100%; max-width: 480px; background: #16161a; border: 1px solid #2a2a30;
          border-radius: 16px; padding: 32px; box-shadow: 0 12px 48px rgba(0,0,0,0.4); }
  h1 { font-size: 18px; margin: 0 0 4px; font-weight: 600; }
  .subtitle { color: #9a9aa3; font-size: 14px; margin: 0 0 24px; }
  .drop { border: 2px dashed #3a3a44; border-radius: 12px; padding: 40px 20px; text-align: center;
          transition: border-color .15s, background .15s; cursor: pointer; }
  .drop.over { border-color: #6366f1; background: #1a1a24; }
  .drop p { margin: 0; color: #c8c8d0; font-size: 14px; }
  .drop strong { color: #f5f5f7; }
  input[type=file] { display: none; }
  .filename { margin-top: 16px; font-size: 13px; color: #a8a8b0; word-break: break-all; }
  .progress { margin-top: 20px; height: 6px; background: #2a2a30; border-radius: 3px; overflow: hidden; display: none; }
  .progress.show { display: block; }
  .bar { height: 100%; background: linear-gradient(90deg, #6366f1, #8b5cf6); width: 0%; transition: width .15s; }
  .status { margin-top: 16px; font-size: 14px; min-height: 20px; }
  .status.ok { color: #34d399; }
  .status.err { color: #f87171; }
  button.upload { margin-top: 20px; width: 100%; padding: 12px; background: #6366f1; color: white;
                  border: 0; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer;
                  transition: background .15s; }
  button.upload:hover:not(:disabled) { background: #5558e3; }
  button.upload:disabled { background: #2a2a30; color: #6a6a72; cursor: not-allowed; }
  .footer { margin-top: 20px; font-size: 12px; color: #6a6a72; text-align: center; }
  .nodaro { color: #c8c8d0; font-weight: 600; letter-spacing: 0.2px; }
</style>
</head>
<body>
<div class="card">
  <h1>Upload ${kindLabel}</h1>
  <p class="subtitle">Drop your file or click to pick. After upload, return to your chat and tell the assistant you're done.</p>
  <label class="drop" id="drop">
    <p><strong>Click to select</strong> or drag your ${escKind} here</p>
    <input type="file" id="file" accept="${accept}">
    <div class="filename" id="filename"></div>
  </label>
  <div class="progress" id="progress"><div class="bar" id="bar"></div></div>
  <div class="status" id="status"></div>
  <button class="upload" id="upload" disabled>Upload</button>
  <div class="footer">Powered by <span class="nodaro">Nodaro</span></div>
</div>
<script>
(function () {
  var drop = document.getElementById('drop');
  var fileInput = document.getElementById('file');
  var filename = document.getElementById('filename');
  var progress = document.getElementById('progress');
  var bar = document.getElementById('bar');
  var status = document.getElementById('status');
  var btn = document.getElementById('upload');
  var token = ${JSON.stringify(escToken)};
  var picked = null;

  function setFile(f) {
    picked = f;
    filename.textContent = f ? f.name + ' (' + Math.round(f.size / 1024) + ' KB)' : '';
    btn.disabled = !f;
  }

  fileInput.addEventListener('change', function (e) {
    var f = e.target.files && e.target.files[0];
    if (f) setFile(f);
  });

  ;['dragenter', 'dragover'].forEach(function (ev) {
    drop.addEventListener(ev, function (e) {
      e.preventDefault();
      drop.classList.add('over');
    });
  });
  ;['dragleave', 'drop'].forEach(function (ev) {
    drop.addEventListener(ev, function (e) {
      e.preventDefault();
      drop.classList.remove('over');
    });
  });
  drop.addEventListener('drop', function (e) {
    var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) setFile(f);
  });

  btn.addEventListener('click', function () {
    if (!picked) return;
    var fd = new FormData();
    fd.append('file', picked);
    var xhr = new XMLHttpRequest();
    xhr.open('POST', '/v1/upload-page/' + encodeURIComponent(token));
    xhr.upload.addEventListener('progress', function (ev) {
      if (ev.lengthComputable) {
        progress.classList.add('show');
        bar.style.width = (ev.loaded / ev.total * 100) + '%';
      }
    });
    btn.disabled = true;
    status.className = 'status';
    status.textContent = 'Uploading…';
    xhr.onload = function () {
      if (xhr.status >= 200 && xhr.status < 300) {
        status.className = 'status ok';
        status.textContent = 'Uploaded! Return to your chat and say "done".';
        btn.style.display = 'none';
      } else {
        status.className = 'status err';
        var msg = 'Upload failed (' + xhr.status + ')';
        try { msg = (JSON.parse(xhr.responseText).error || {}).message || msg; } catch (e) {}
        status.textContent = msg;
        btn.disabled = false;
      }
    };
    xhr.onerror = function () {
      status.className = 'status err';
      status.textContent = 'Network error. Please try again.';
      btn.disabled = false;
    };
    xhr.send(fd);
  });
})();
</script>
</body>
</html>`
}

export async function uploadHandoffRoutes(app: FastifyInstance): Promise<void> {
  await app.register(multipart, {
    limits: { fileSize: MAX_HANDOFF_BYTES },
  })

  app.get<{ Params: { token: string } }>(
    "/v1/upload-page/:token",
    async (req, reply) => {
      const payload = verifyUploadToken(req.params.token)
      if (!payload || payload.purpose !== "handoff" || !payload.kind) {
        reply.type("text/html").status(403)
        return reply.send(
          `<!doctype html><html><body style="font-family:system-ui;text-align:center;padding:40px"><h2>Link expired or invalid</h2><p>Ask the assistant to issue a fresh upload link.</p></body></html>`,
        )
      }
      reply.type("text/html")
      return reply.send(renderPage({ token: req.params.token, kind: payload.kind }))
    },
  )

  // CORS for cross-origin POSTs from MCP UI widgets (Claude.ai iframe at
  // <hash>.claudemcpcontent.com) is handled by the global origin
  // allowlist in app.ts via the CLAUDE_MCP_IFRAME_RE pattern — per-route
  // config.cors overrides aren't honored by @fastify/cors v11.
  app.post<{ Params: { token: string } }>(
    "/v1/upload-page/:token",
    async (req, reply) => {
      const payload = verifyUploadToken(req.params.token)
      if (!payload || payload.purpose !== "handoff" || !payload.kind) {
        return reply.status(403).send({
          error: { code: "invalid_token", message: "Link expired or invalid." },
        })
      }
      const data = await req.file()
      if (!data) {
        return reply.status(400).send({
          error: { code: "no_file", message: "No file in form." },
        })
      }

      const expectedPrefix = KIND_MIME_PREFIX[payload.kind]
      if (!data.mimetype.startsWith(expectedPrefix)) {
        // Drain stream before responding
        data.file.resume()
        return reply.status(400).send({
          error: {
            code: "wrong_kind",
            message: `Expected a ${payload.kind} file (got ${data.mimetype}).`,
          },
        })
      }

      let buffer: Buffer
      try {
        buffer = await data.toBuffer()
      } catch (err) {
        return reply.status(400).send({
          error: { code: "read_failed", message: (err as Error).message },
        })
      }
      if (buffer.length === 0) {
        return reply.status(400).send({
          error: { code: "empty_body", message: "Empty file." },
        })
      }

      // HEIC/HEIF render only in Safari and aren't accepted by downstream
      // image providers. Convert to JPEG before storing — the public URL is
      // already known to Claude (its key was minted at token-mint time), so
      // we keep the same R2 key and just serve as image/jpeg.
      let finalBuffer = buffer
      let finalMime = data.mimetype
      if (
        payload.kind === "image" &&
        (data.mimetype === "image/heic" || data.mimetype === "image/heif")
      ) {
        try {
          finalBuffer = await sharp(buffer).jpeg({ quality: 90, mozjpeg: true }).toBuffer()
          finalMime = "image/jpeg"
        } catch (err) {
          return reply.status(400).send({
            error: {
              code: "heic_decode_failed",
              message: `Failed to decode ${data.mimetype}: ${(err as Error).message}`,
            },
          })
        }
      }

      try {
        await s3.send(
          new PutObjectCommand({
            Bucket: config.R2_BUCKET_NAME,
            Key: payload.key,
            Body: finalBuffer,
            ContentType: finalMime,
            CacheControl: "public, max-age=31536000, immutable",
          }),
        )
      } catch (err) {
        req.log.error({ err }, "[upload-handoff] R2 upload failed")
        return reply.status(502).send({
          error: { code: "r2_upload_failed", message: (err as Error).message },
        })
      }

      const publicUrl = `${config.R2_PUBLIC_URL}/${payload.key}`
      return reply.send({
        ok: true,
        url: publicUrl,
        bytes: finalBuffer.length,
        mime: finalMime,
      })
    },
  )
}
