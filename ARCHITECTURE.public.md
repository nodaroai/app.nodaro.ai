# SceneNode.ai -- Architecture Reference

> Auto-generated on 2026-02-15 10:05:06 UTC at commit `c032ca7`
> Run `npx tsx scripts/generate-architecture.ts` to regenerate.

---

## 1. Project Structure

```
|-- backend/
|   |-- migrations/
|   |-- src/
|   |   |-- config/
|   |   |-- lib/
|   |   |-- middleware/
|   |   |-- providers/
|   |   |-- routes/
|   |   |-- scripts/
|   |   |-- services/
|   |   |-- utils/
|   |   |-- workers/
|   |   |-- app.ts
|   |   |-- server.ts
|   |   `-- worker.ts
|   |-- .env.example
|   |-- .gitignore
|   |-- package-lock.json
|   |-- package.json
|   `-- tsconfig.json
|-- docs/
|   |-- BILLING.md
|   `-- FULL_SPEC.md
|-- frontend/
|   |-- docs/
|   |-- public/
|   |-- src/
|   |   |-- app/
|   |   |-- components/
|   |   |-- hooks/
|   |   |-- lib/
|   |   |-- test/
|   |   |-- types/
|   |   `-- middleware.ts
|   |-- .env.example
|   |-- .env.local1
|   |-- .gitignore
|   |-- components.json
|   |-- Dockerfile
|   |-- eslint.config.mjs
|   |-- next-env.d.ts
|   |-- next.config.ts
|   |-- package-lock.json
|   |-- package.json
|   |-- postcss.config.mjs
|   |-- README.md
|   |-- tsconfig.json
|   |-- tsconfig.tsbuildinfo
|   `-- vitest.config.ts
|-- scripts/
|   `-- generate-architecture.ts
|-- supabase/
|   `-- migrations/
|-- architecture-graph.html
|-- ARCHITECTURE.md
|-- ARCHITECTURE.public.md
|-- CLAUDE.md
|-- docker-compose.dev.yml
|-- docker-compose.yml
|-- Dockerfile
|-- LICENSE
|-- package.json
`-- README.md
```

## 2. API Routes

84 routes across 48 files.

| Method | Path | File |
|--------|------|------|
| GET | `/health` | `backend/src/routes/health.ts` |
| POST | `/v1/add-captions` | `backend/src/routes/add-captions.ts` |
| POST | `/v1/adjust-volume` | `backend/src/routes/adjust-volume.ts` |
| POST | `/v1/ai-writer/generate` | `backend/src/routes/ai-writer.ts` |
| POST | `/v1/ai-writer/generate-stream` | `backend/src/routes/ai-writer.ts` |
| GET | `/v1/characters` | `backend/src/routes/characters.ts` |
| POST | `/v1/characters` | `backend/src/routes/characters.ts` |
| DELETE | `/v1/characters/:id` | `backend/src/routes/characters.ts` |
| GET | `/v1/characters/:id` | `backend/src/routes/characters.ts` |
| POST | `/v1/combine-videos` | `backend/src/routes/combine-videos.ts` |
| POST | `/v1/download-video` | `backend/src/routes/download-video.ts` |
| GET | `/v1/download-video/progress/:id` | `backend/src/routes/download-video.ts` |
| POST | `/v1/edit-image` | `backend/src/routes/edit-image.ts` |
| POST | `/v1/extract-audio` | `backend/src/routes/extract-audio.ts` |
| POST | `/v1/extract-youtube-audio` | `backend/src/routes/extract-youtube-audio.ts` |
| GET | `/v1/faces` | `backend/src/routes/faces.ts` |
| POST | `/v1/faces` | `backend/src/routes/faces.ts` |
| DELETE | `/v1/faces/:id` | `backend/src/routes/faces.ts` |
| GET | `/v1/faces/:id` | `backend/src/routes/faces.ts` |
| GET | `/v1/gallery` | `backend/src/routes/gallery.ts` |
| POST | `/v1/gallery/report` | `backend/src/routes/gallery.ts` |
| POST | `/v1/generate-character` | `backend/src/routes/generate-character.ts` |
| POST | `/v1/generate-character-asset` | `backend/src/routes/generate-character-asset.ts` |
| POST | `/v1/generate-face` | `backend/src/routes/generate-face.ts` |
| POST | `/v1/generate-image` | `backend/src/routes/generate-image.ts` |
| POST | `/v1/generate-location` | `backend/src/routes/generate-location.ts` |
| POST | `/v1/generate-location-asset` | `backend/src/routes/generate-location-asset.ts` |
| POST | `/v1/generate-music` | `backend/src/routes/generate-music.ts` |
| POST | `/v1/generate-object` | `backend/src/routes/generate-object.ts` |
| POST | `/v1/generate-object-asset` | `backend/src/routes/generate-object-asset.ts` |
| POST | `/v1/generate-script` | `backend/src/routes/generate-script.ts` |
| POST | `/v1/generate-video` | `backend/src/routes/generate-video.ts` |
| GET | `/v1/image-proxy` | `backend/src/routes/image-proxy.ts` |
| POST | `/v1/image-to-image` | `backend/src/routes/image-to-image.ts` |
| GET | `/v1/library` | `backend/src/routes/library.ts` |
| DELETE | `/v1/library/:id` | `backend/src/routes/library.ts` |
| POST | `/v1/library/:id/demote` | `backend/src/routes/library.ts` |
| POST | `/v1/library/:id/promote` | `backend/src/routes/library.ts` |
| POST | `/v1/library/save-generated` | `backend/src/routes/library.ts` |
| POST | `/v1/lip-sync` | `backend/src/routes/lip-sync.ts` |
| GET | `/v1/locations` | `backend/src/routes/locations.ts` |
| POST | `/v1/locations` | `backend/src/routes/locations.ts` |
| DELETE | `/v1/locations/:id` | `backend/src/routes/locations.ts` |
| GET | `/v1/locations/:id` | `backend/src/routes/locations.ts` |
| POST | `/v1/merge-video-audio` | `backend/src/routes/merge-video-audio.ts` |
| POST | `/v1/mix-audio` | `backend/src/routes/mix-audio.ts` |
| POST | `/v1/motion-transfer` | `backend/src/routes/motion-transfer.ts` |
| GET | `/v1/objects` | `backend/src/routes/objects.ts` |
| POST | `/v1/objects` | `backend/src/routes/objects.ts` |
| DELETE | `/v1/objects/:id` | `backend/src/routes/objects.ts` |
| GET | `/v1/objects/:id` | `backend/src/routes/objects.ts` |
| GET | `/v1/projects` | `backend/src/routes/projects.ts` |
| POST | `/v1/projects` | `backend/src/routes/projects.ts` |
| DELETE | `/v1/projects/:id` | `backend/src/routes/projects.ts` |
| GET | `/v1/projects/:id` | `backend/src/routes/projects.ts` |
| PATCH | `/v1/projects/:id` | `backend/src/routes/projects.ts` |
| GET | `/v1/projects/:projectId/workflows` | `backend/src/routes/workflows.ts` |
| POST | `/v1/projects/:projectId/workflows` | `backend/src/routes/workflows.ts` |
| POST | `/v1/render` | `backend/src/routes/render.ts` |
| POST | `/v1/resize-video` | `backend/src/routes/resize-video.ts` |
| POST | `/v1/split-image` | `backend/src/routes/split-image.ts` |
| POST | `/v1/suno/cover` | `backend/src/routes/suno.ts` |
| POST | `/v1/suno/extend` | `backend/src/routes/suno.ts` |
| POST | `/v1/suno/generate` | `backend/src/routes/suno.ts` |
| POST | `/v1/suno/lyrics` | `backend/src/routes/suno.ts` |
| POST | `/v1/suno/music-video` | `backend/src/routes/suno.ts` |
| POST | `/v1/suno/separate` | `backend/src/routes/suno.ts` |
| POST | `/v1/text-to-audio` | `backend/src/routes/text-to-audio.ts` |
| POST | `/v1/text-to-speech` | `backend/src/routes/text-to-speech.ts` |
| POST | `/v1/text-to-video` | `backend/src/routes/text-to-video.ts` |
| POST | `/v1/transcribe` | `backend/src/routes/transcribe.ts` |
| POST | `/v1/trim-video` | `backend/src/routes/trim-video.ts` |
| POST | `/v1/upload` | `backend/src/routes/upload.ts` |
| POST | `/v1/upload/audio` | `backend/src/routes/upload.ts` |
| POST | `/v1/upload/image` | `backend/src/routes/upload.ts` |
| GET | `/v1/user/settings` | `backend/src/routes/user-settings.ts` |
| PATCH | `/v1/user/settings` | `backend/src/routes/user-settings.ts` |
| POST | `/v1/video-to-video` | `backend/src/routes/video-to-video.ts` |
| POST | `/v1/video-upscale` | `backend/src/routes/video-upscale.ts` |
| DELETE | `/v1/workflows/:id` | `backend/src/routes/workflows.ts` |
| GET | `/v1/workflows/:id` | `backend/src/routes/workflows.ts` |
| PATCH | `/v1/workflows/:id` | `backend/src/routes/workflows.ts` |
| POST | `/v1/workflows/:id/run` | `backend/src/routes/workflows.ts` |
| POST | `/v1/youtube-audio` | `backend/src/routes/youtube-audio.ts` |

## 3. Database Tables

15 tables found across migration files.

### `profiles`

Source: `supabase/migrations/001_initial_schema.sql`

Columns: `id`, `email`, `full_name`, `avatar_url`, `tier`, `credits_balance`, `storage_used_bytes`, `created_at`, `updated_at`

### `api_keys`

Source: `supabase/migrations/001_initial_schema.sql`

Columns: `id`, `user_id`, `name`, `key_hash`, `key_prefix`, `last_used_at`, `expires_at`, `revoked_at`, `created_at`

### `projects`

Source: `supabase/migrations/001_initial_schema.sql`

Columns: `id`, `user_id`, `name`, `description`, `settings`, `created_at`, `updated_at`

### `folders`

Source: `supabase/migrations/001_initial_schema.sql`

Columns: `id`, `project_id`, `name`, `created_at`

### `characters`

Source: `supabase/migrations/001_initial_schema.sql`

Columns: `id`, `project_id`, `name`, `description`, `reference_image_url`, `visual_traits`, `created_at`

### `style_presets`

Source: `supabase/migrations/001_initial_schema.sql`

Columns: `id`, `name`, `thumbnail_url`, `settings`, `is_system`, `user_id`, `created_at`

### `workflows`

Source: `supabase/migrations/001_initial_schema.sql`

Columns: `id`, `project_id`, `user_id`, `folder_id`, `name`, `description`, `source_prompt`, `nodes`, `edges`, `settings`, `is_template`, `version`, `created_at`, `updated_at`

### `workflow_history`

Source: `supabase/migrations/001_initial_schema.sql`

Columns: `id`, `workflow_id`, `version`, `nodes`, `edges`, `created_at`

### `jobs`

Source: `supabase/migrations/001_initial_schema.sql`

Columns: `id`, `workflow_id`, `user_id`, `parent_job_id`, `status`, `priority`, `progress`, `credits_estimated`, `credits_used`, `input_data`, `output_data`, `error_message`, `started_at`, `completed_at`, `created_at`

### `job_checkpoints`

Source: `supabase/migrations/001_initial_schema.sql`

Columns: `id`, `job_id`, `step`, `data`, `created_at`

### `assets`

Source: `supabase/migrations/001_initial_schema.sql`

Columns: `id`, `user_id`, `job_id`, `type`, `filename`, `mime_type`, `size_bytes`, `r2_key`, `r2_url`, `metadata`, `expires_at`, `created_at`

### `webhooks`

Source: `supabase/migrations/001_initial_schema.sql`

Columns: `id`, `user_id`, `url`, `secret`, `events`, `is_active`, `created_at`

### `webhook_deliveries`

Source: `supabase/migrations/001_initial_schema.sql`

Columns: `id`, `webhook_id`, `job_id`, `event`, `payload`, `response_status`, `response_body`, `attempts`, `next_retry_at`, `delivered_at`, `created_at`

### `usage_logs`

Source: `supabase/migrations/001_initial_schema.sql`

Columns: `id`, `user_id`, `job_id`, `action`, `provider`, `credits_used`, `cost_usd`, `metadata`, `created_at`

### `faces`

Source: `backend/migrations/create_faces_table.sql`

Columns: `id`, `user_id`, `node_id`, `workflow_id`, `project_id`, `name`, `description`, `style`, `source_image_url`, `expressions`, `created_at`, `updated_at`

## 4. Node Types

57 node types defined in `frontend/src/types/nodes.ts`.

| Type | Label | Category | Credits | Component |
|------|-------|----------|---------|-----------|
| `text-prompt` | Text Prompt | input | 0 | `frontend/src/components/nodes/text-prompt-node.tsx` |
| `list` | List | input | 0 | `frontend/src/components/nodes/list-node.tsx` |
| `loop` | Loop | input | 0 | `frontend/src/components/nodes/loop-node.tsx` |
| `upload-image` | Upload Image | input | 0 | `frontend/src/components/nodes/upload-image-node.tsx` |
| `upload-video` | Upload Video | input | 0 | `frontend/src/components/nodes/upload-video-node.tsx` |
| `upload-audio` | Upload Audio | input | 0 | `frontend/src/components/nodes/upload-audio-node.tsx` |
| `rss-feed` | RSS Feed | input | 0 | `frontend/src/components/nodes/rss-feed-node.tsx` |
| `youtube-video` | Video URL | input | 0 | `frontend/src/components/nodes/youtube-video-node.tsx` |
| `reference-audio` | Reference Audio | input | 0 | `frontend/src/components/nodes/reference-audio-node.tsx` |
| `tone` | Tone | parameter | 0 | `frontend/src/components/nodes/tone-node.tsx` |
| `style-guide` | Style Guide | parameter | 0 | `frontend/src/components/nodes/style-guide-node.tsx` |
| `provider` | Provider | parameter | 0 | `frontend/src/components/nodes/provider-node.tsx` |
| `scene-count` | Scene Count | parameter | 0 | `frontend/src/components/nodes/scene-count-node.tsx` |
| `duration` | Duration | parameter | 0 | `frontend/src/components/nodes/duration-node.tsx` |
| `aspect-ratio` | Aspect Ratio | parameter | 0 | `frontend/src/components/nodes/aspect-ratio-node.tsx` |
| `motion` | Motion | parameter | 0 | `frontend/src/components/nodes/motion-node.tsx` |
| `camera-motion` | Camera Motion | parameter | 0 | `frontend/src/components/nodes/camera-motion-node.tsx` |
| `generate-script` | Generate Script | ai | 2 | `frontend/src/components/nodes/generate-script-node.tsx` |
| `generate-image` | Generate Image | ai | 5 | `frontend/src/components/nodes/generate-image-node.tsx` |
| `edit-image` | Edit Image | ai | 3 | `frontend/src/components/nodes/edit-image-node.tsx` |
| `image-to-image` | Image to Image | ai | 5 | `frontend/src/components/nodes/image-to-image-node.tsx` |
| `image-to-video` | Image to Video | ai | 20 | `frontend/src/components/nodes/image-to-video-node.tsx` |
| `video-to-video` | Video to Video | ai | 25 | `frontend/src/components/nodes/video-to-video-node.tsx` |
| `text-to-video` | Text to Video | ai | 25 | `frontend/src/components/nodes/text-to-video-node.tsx` |
| `text-to-speech` | Text to Speech | ai | 3 | `frontend/src/components/nodes/text-to-speech-node.tsx` |
| `qa-check` | QA Check | ai | 1 | `frontend/src/components/nodes/qa-check-node.tsx` |
| `generate-music` | Generate Music | ai | 5 | `frontend/src/components/nodes/generate-music-node.tsx` |
| `text-to-audio` | Text to Audio | ai | 3 | `frontend/src/components/nodes/text-to-audio-node.tsx` |
| `suno-generate` | Suno Generate | ai | 3 | `frontend/src/components/nodes/suno-generate-node.tsx` |
| `suno-cover` | Suno Cover | ai | 3 | `frontend/src/components/nodes/suno-cover-node.tsx` |
| `suno-extend` | Suno Extend | ai | 3 | `frontend/src/components/nodes/suno-extend-node.tsx` |
| `suno-lyrics` | Suno Lyrics | ai | 1 | `frontend/src/components/nodes/suno-lyrics-node.tsx` |
| `suno-separate` | Suno Separate | ai | 2 | `frontend/src/components/nodes/suno-separate-node.tsx` |
| `suno-music-video` | Suno Music Video | ai | 1 | `frontend/src/components/nodes/suno-music-video-node.tsx` |
| `transcribe` | Transcribe | ai | 3 | `frontend/src/components/nodes/transcribe-node.tsx` |
| `combine-videos` | Combine Videos | processing | 2 | `frontend/src/components/nodes/combine-videos-node.tsx` |
| `merge-video-audio` | Merge Video & Audio | processing | 1 | `frontend/src/components/nodes/merge-video-audio-node.tsx` |
| `add-captions` | Add Captions | processing | 2 | `frontend/src/components/nodes/add-captions-node.tsx` |
| `resize-video` | Resize Video | processing | 1 | `frontend/src/components/nodes/resize-video-node.tsx` |
| `extract-audio` | Extract Audio | processing | 1 | `frontend/src/components/nodes/extract-audio-node.tsx` |
| `mix-audio` | Mix Audio | processing | 1 | `frontend/src/components/nodes/mix-audio-node.tsx` |
| `adjust-volume` | Adjust Volume | processing | 0 | `frontend/src/components/nodes/adjust-volume-node.tsx` |
| `trim-video` | Trim Video | processing | 0 | `frontend/src/components/nodes/trim-video-node.tsx` |
| `lip-sync` | Lip Sync | ai | 40 | `frontend/src/components/nodes/lip-sync-node.tsx` |
| `motion-transfer` | Motion Transfer | ai | 30 | `frontend/src/components/nodes/motion-transfer-node.tsx` |
| `video-upscale` | Video Upscale | processing | 15 | `frontend/src/components/nodes/video-upscale-node.tsx` |
| `save-to-storage` | Save to Storage | output | 0 | `frontend/src/components/nodes/save-to-storage-node.tsx` |
| `webhook-output` | Webhook Output | output | 0 | `frontend/src/components/nodes/webhook-output-node.tsx` |
| `character` | Character | character | 5 | `frontend/src/components/nodes/character-node.tsx` |
| `face` | Face | face | 5 | `frontend/src/components/nodes/face-node.tsx` |
| `object` | Object | object | 5 | `frontend/src/components/nodes/object-node.tsx` |
| `location` | Location | location | 5 | `frontend/src/components/nodes/location-node.tsx` |
| `scene` | Scene | scene | 0 | `frontend/src/components/nodes/scene-node.tsx` |
| `ai-writer` | AI Writer | ai | 2 | `frontend/src/components/nodes/ai-writer-node.tsx` |
| `combine-text` | Combine Text | utility | 0 | `frontend/src/components/nodes/combine-text-node.tsx` |
| `split-text` | Split Text | utility | 0 | `frontend/src/components/nodes/split-text-node.tsx` |
| `sticky-note` | Sticky Note | utility | 0 | `frontend/src/components/nodes/sticky-note-node.tsx` |

## 5. AI Providers

### `backend/src/providers/`

Files: `config.ts`, `index.ts`, `provider.interface.ts`, `registry.ts`, `router.ts`

Exports: `ProviderUsed`, `RoutingDecision`, `buildRoutingDecision`, `applyMarkup`, `resolveMarkup`, `initProviders`, `ProviderResult`, `ProviderCapability`, `ProgressCallback`, `ProviderOptions`, `ImageGenerationProvider`, `ImageEditingProvider`, `ImageToVideoProvider`, `TextToVideoProvider`, `VideoToVideoProvider`, `MotionTransferProvider`, `VideoUpscaleProvider`, `LipSyncProvider`, `MusicGenerationProvider`, `TextToSpeechOptions`, `TextToSpeechProvider`, `TranscriptionProvider`, `ProviderInfo`, `providerRegistry`, `RouteResult`, `generateImage`, `editImage`, `imageToVideo`, `textToVideo`, `videoToVideo`, `motionTransfer`, `videoUpscale`, `lipSync`, `generateMusic`, `textToSpeech`

### `backend/src/providers/audio/`

Files: `generate-music.ts`, `text-to-audio.ts`, `transcribe.ts`, `youtube-extractor.ts`

Exports: `MusicProvider`, `generateMusic`, `AudioProvider`, `textToAudio`, `TranscribeProvider`, `transcribe`, `extractYouTubeAudio`

### `backend/src/providers/kie/`

Files: `audio.ts`, `client.ts`, `image.ts`, `index.ts`, `kling3-client.ts`, `models.ts`, `suno-client.ts`, `video.ts`

Exports: `KieAudioProvider`, `KIE_API_BASE`, `POLL_INTERVAL_MS`, `MAX_POLL_ATTEMPTS`, `MAX_POLL_ATTEMPTS_VIDEO`, `KieError`, `createSanitizedError`, `KieTaskResponse`, `KieRecordInfoResponse`, `VeoRecordInfoResponse`, `KieResultJson`, `ProgressCallback`, `sleep`, `runKieTask`, `runVeoTask`, `KieImageProvider`, `registerKieProviders`, `Kling3Params`, `Kling3Result`, `kling3Generate`, `KieModelConfig`, `KIE_IMAGE_MODELS`, `KIE_VIDEO_MODELS`, `KIE_TEXT_TO_VIDEO_MODELS`, `KIE_VIDEO_TO_VIDEO_MODELS`, `KIE_MOTION_TRANSFER_MODELS`, `KIE_VIDEO_UPSCALE_MODELS`, `KIE_LIP_SYNC_MODELS`, `KIE_MUSIC_MODELS`, `KIE_TTS_MODELS`, `KIE_SOUND_EFFECT_MODELS`, `KIE_SPECIAL_MODELS`, `KieCategory`, `getKieModelConfig`, `isKieSupported`, `getKieCost`, `getAllowedDurations`, `usesNFrames`, `durationToNFrames`, `supportsEndFrame`, `getEndFrameParam`, `SunoModel`, `SunoGenerateParams`, `SunoCoverParams`, `SunoExtendParams`, `SunoLyricsParams`, `SunoLyricsResult`, `SunoSeparateType`, `SunoSeparateParams`, `SunoSeparateResult`, `SunoMusicVideoParams`, `SunoMusicVideoResult`, `SunoTrack`, `SunoTaskResult`, `sunoGenerate`, `sunoCover`, `sunoExtend`, `sunoLyrics`, `sunoSeparate`, `sunoMusicVideo`, `KieVideoProvider`

### `backend/src/providers/replicate/`

Files: `client.ts`, `image.ts`, `index.ts`, `video.ts`

Exports: `replicate`, `extractUrl`, `extractCost`, `ReplicateImageProvider`, `registerReplicateProviders`, `ReplicateVideoProvider`

### `backend/src/providers/script/`

Files: `script-generator.ts`

Exports: `ScriptSceneCharacter`, `ScriptSceneDialogue`, `ScriptSceneLocation`, `ScriptSceneCinematography`, `ScriptScene`, `GeneratedScript`, `ScriptProvider`, `generateScript`

### `backend/src/providers/video/`

Files: `add-captions.ts`, `adjust-volume.ts`, `combine-videos.ts`, `extract-audio.ts`, `ffmpeg-utils.ts`, `merge-video-audio.ts`, `mix-audio.ts`, `resize-video.ts`, `trim-video.ts`

Exports: `addCaptions`, `adjustVolume`, `combineVideos`, `extractAudio`, `downloadFile`, `runFfmpeg`, `createWorkDir`, `cleanupWorkDir`, `mergeVideoAudio`, `mixAudio`, `resizeVideo`, `trimVideo`

## 6. Import Graph (Key Files)

### `frontend/src/components/editor/workflow-editor.tsx`

- `./workflow-canvas`
- `./node-toolbar`
- `./config-panel`
- `./editor-toolbar`
- `./unsaved-changes-dialog`
- `./executions-tab`
- `./cost-tab`
- `@/components/ui/button`
- `@/hooks/use-workflow-persistence`
- `@/hooks/use-workflow-store`
- `@/hooks/use-projects-store`
- `@/hooks/use-auth`
- `@/lib/supabase`
- `@/lib/api`
- `@/lib/edition`
- `@/hooks/use-model-credits`
- `@/components/credits/InsufficientCreditsModal`
- `@/types/nodes`
- `@/lib/prompt-builder`
- `@/lib/prompt-templates`
- `@/lib/ai-writer-templates`

### `frontend/src/hooks/use-workflow-store.ts`

- `@/types/nodes`

### `backend/src/app.ts`

- `./lib/config.js`
- `./routes/health.js`
- `./routes/projects.js`
- `./routes/workflows.js`
- `./routes/jobs.js`
- `./routes/render.js`
- `./routes/generate-image.js`
- `./routes/edit-image.js`
- `./routes/image-to-image.js`
- `./routes/generate-video.js`
- `./routes/video-to-video.js`
- `./routes/text-to-video.js`
- `./routes/lip-sync.js`
- `./routes/text-to-speech.js`
- `./routes/generate-script.js`
- `./routes/combine-videos.js`
- `./routes/merge-video-audio.js`
- `./routes/extract-audio.js`
- `./routes/trim-video.js`
- `./routes/resize-video.js`
- `./routes/adjust-volume.js`
- `./routes/add-captions.js`
- `./routes/mix-audio.js`
- `./routes/generate-music.js`
- `./routes/upload.js`
- `./routes/youtube-audio.js`
- `./routes/download-video.js`
- `./routes/extract-youtube-audio.js`
- `./routes/text-to-audio.js`
- `./routes/image-proxy.js`
- `./routes/generate-character.js`
- `./routes/generate-face.js`
- `./routes/generate-character-asset.js`
- `./routes/split-image.js`
- `./routes/characters.js`
- `./routes/faces.js`
- `./routes/objects.js`
- `./routes/generate-object-asset.js`
- `./routes/generate-object.js`
- `./routes/locations.js`
- `./routes/generate-location.js`
- `./routes/generate-location-asset.js`
- `./routes/predictions.js`
- `./routes/motion-transfer.js`
- `./routes/video-upscale.js`
- `./routes/stats.js`
- `./routes/cancel-jobs.js`
- `./routes/library.js`
- `./routes/transcribe.js`
- `./routes/workflow-costs.js`
- `./routes/suno.js`
- `./routes/gallery.js`
- `./routes/user-settings.js`
- `./routes/ai-writer.js`

### `backend/src/worker.ts`

- `./workers/video-worker.js`
