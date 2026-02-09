# SceneNode.ai

Visual workflow platform for AI video generation. Build video creation pipelines by connecting nodes, with each node representing an AI operation (image generation, video creation, voiceover, etc.).

## Features

- **Visual Workflow Editor**: Drag-and-drop node-based editor built on React Flow
- **Graph-Based Workflows**: Branching, merging, multiple inputs/outputs
- **Build from Prompt**: Describe a video in plain text, get a complete workflow auto-generated
- **Asset Management**: Characters, locations, objects with reference images for visual consistency
- **Scene Node**: Cinematic control center combining characters, cinematography, mood, and dialogue
- **Model Agnostic**: Swap AI providers without changing workflows
- **45 Node Types**: Input (5), Parameter (8), AI (16), Scene (1), Assets (3), Processing (9), Output (2), Utility (1)
- **Light/Dark Mode**: Premium styling with glassmorphism effects
- **Organized Node Menus**: Sub-group headers in sidebar and popup (AI: Script & Text, Image, Video, Audio & Speech, Suno Music, Quality; Processing: Video, Audio)
- **Keyboard Shortcuts**: Tab (add node), Ctrl+K (search), Ctrl+L (assets), Shift+S (sticky note)

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 14 (App Router) + shadcn/ui + Tailwind |
| Visual Editor | React Flow |
| Backend | Fastify (Node.js/TypeScript) |
| Database + Auth | Supabase (PostgreSQL + Google OAuth) |
| Queue | Redis + BullMQ |
| Storage | Cloudflare R2 |
| AI Providers | Replicate (default), KIE.ai (cloud edition) |

### Supported AI Models

| Category | Providers |
|----------|-----------|
| Image | nano-banana, nano-banana-pro, flux, grok, gpt-image |
| Video | minimax, veo3, veo3.1, kling, kling-turbo, sora2-pro |
| Script | google/gemini-2.5-flash |
| TTS | ElevenLabs Turbo v2.5, Multilingual v2 (26 voices, KIE.ai) |
| Music | MusicGen, MiniMax, Lyria, Bark |
| Audio SFX | TangoFlux, Tango, AudioLDM, Bark, ElevenLabs SFX v2 |
| Suno | Generate, Cover, Extend, Lyrics, Separate, Music Video (KIE.ai) |
| Lip Sync | kling-avatar, hailuo-avatar (KIE.ai) |

## Editions

| Edition | `EDITION` env | Admin | Credits | Use Case |
|---------|---------------|-------|---------|----------|
| Community | `community` | No | No | Open-source self-hosted |
| Business | `business` | Yes | No | Self-hosted with admin |
| Cloud | `cloud` | Yes | Yes | Managed SaaS |

## Suno Music Integration

Full Suno music pipeline via KIE.ai API:

- **Suno Generate** (3 credits) -- Generate songs from text prompts with style, genre, and vocal options
- **Suno Cover** (3 credits) -- Create covers from audio files or social media URLs (YouTube, TikTok, Instagram, Facebook, X)
- **Suno Extend** (3 credits) -- Continue/extend existing tracks from a specific timestamp
- **Suno Lyrics** (1 credit) -- AI-generated lyrics from a text prompt
- **Suno Separate** (2 credits) -- Split tracks into Vocal + Instrumental, or up to 12 individual stems (drums, bass, guitar, piano, etc.)
- **Suno Music Video** (3 credits) -- Generate MP4 visualizer video from Suno audio tracks

Video URL nodes automatically download audio for Suno Cover compatibility. Social media URLs are resolved to direct audio files via yt-dlp before sending to the API.

## Quick Start

### Requirements
- Node.js 18+
- Supabase project (free tier works)
- Redis (for job queue)
- Replicate API token

### Installation

```bash
git clone https://github.com/scenenode/scenenode.git
cd scenenode
cp .env.example .env

# Frontend
cd frontend && npm install && npm run dev

# Backend (separate terminal)
cd backend && npm install && npm run dev

# Open http://localhost:3000
```

### Environment Variables

```bash
# Frontend (.env in frontend/)
NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
NEXT_PUBLIC_EDITION=community

# Backend (.env in backend/)
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
REDIS_URL=redis://localhost:6379
REPLICATE_API_TOKEN=r8_xxxxx
EDITION=community

# KIE.ai (optional, cloud edition)
KIE_API_KEY=kie_xxxxx
```

### Getting API Keys
- **Supabase**: https://supabase.com/dashboard
- **Replicate**: https://replicate.com/account/api-tokens
- **KIE.ai** (optional): https://kie.ai

## Project Structure

```
scenenode/
├── frontend/                     # Next.js 14
│   └── src/
│       ├── app/                  # Pages (auth, dashboard, editor, admin)
│       ├── components/           # UI: editor/, nodes/, ui/, credits/
│       ├── hooks/                # Zustand stores, auth, file upload
│       ├── lib/                  # Supabase, API client, utils
│       └── types/                # Node types + definitions
├── backend/                      # Fastify (Node.js/TypeScript)
│   └── src/
│       ├── routes/               # API endpoints (22 route files)
│       ├── billing/              # CreditsService, credit routes
│       ├── middleware/           # creditGuard, file validation
│       ├── providers/            # AI providers + FFmpeg processing
│       ├── services/             # Business logic, provider routing
│       ├── workers/              # BullMQ job workers
│       └── lib/                  # Config, Supabase, Redis, R2
├── CLAUDE.md                     # Full project specification
└── README.md
```

## Development

```bash
# Frontend
cd frontend
npm run dev      # Dev server on :3000
npm run build    # Production build

# Backend
cd backend
npm run dev      # Dev server on :8000
npm run worker   # BullMQ worker (requires Redis)

# Tests
cd frontend && npm test
cd backend && npm test
```

## API

REST API at `http://localhost:8000`. Key endpoints:

| Endpoint | Description |
|----------|-------------|
| `GET /health` | Health check |
| `POST /v1/generate-image` | Generate image (nano-banana, flux, grok, etc.) |
| `POST /v1/generate-video` | Generate video from image |
| `POST /v1/generate-script` | Generate script via Gemini |
| `POST /v1/text-to-speech` | TTS via ElevenLabs |
| `POST /v1/text-to-video` | Text-to-video generation |
| `POST /v1/generate-music` | Music generation |
| `POST /v1/suno/generate` | Suno music generation |
| `POST /v1/suno/cover` | Suno cover from audio/URL |
| `POST /v1/suno/extend` | Extend/continue Suno tracks |
| `POST /v1/suno/lyrics` | AI-generated lyrics |
| `POST /v1/suno/separate` | Vocal/instrumental stem separation |
| `POST /v1/suno/music-video` | Generate music video from Suno track |
| `POST /v1/combine-videos` | FFmpeg video concatenation |
| `POST /v1/workflows/:id/run` | Execute workflow |

Full API documentation in [CLAUDE.md](./CLAUDE.md).

## License

Sustainable Use License - See [LICENSE](./LICENSE)

## Issues

Report bugs and request features at https://github.com/scenenode/scenenode/issues
