# SceneNode.ai

Visual workflow platform for AI video generation. Build video creation pipelines by connecting nodes, with each node representing an AI operation (image generation, video creation, voiceover, etc.).

## Current Status

**Phase 1.2 (Editor) - Complete.** The visual workflow editor is fully functional with 28 node types, field mapping, and provider configuration. Backend execution engine (Phase 1.3) is next.

## Features

### Visual Workflow Editor
- Drag-and-drop node-based editor built on React Flow
- Single input handle per node with field mapping in the config panel
- Connect multiple source nodes to one target and map which source feeds which field
- Dropdown filtering by compatible node types
- Provider cascading dropdowns: Category -> Provider -> Model
- Graph-based workflows: branching, merging, multiple inputs/outputs
- Manual save with unsaved changes indicator and exit confirmation

### 28 Node Types

| Category | Nodes |
|----------|-------|
| **Input** | Text Prompt, Upload Image, Upload Video, RSS Feed |
| **Parameter** | Provider, Duration, Aspect Ratio, Tone, Style Guide, Scene Count, Motion, Camera Motion |
| **AI** | Generate Script, Generate Image, Image to Video, Text to Video, Text to Speech, QA Check |
| **Processing** | Combine Videos, Add Audio, Extract Audio, Mix Audio, Add Captions, Resize Video, Trim Video, Adjust Volume |
| **Output** | Save to Storage, Webhook Output |

### Dashboard
- Projects with folders
- Workflow management
- Mobile responsive (collapsible sidebar, touch targets, pinch-to-zoom)
- Light/Dark mode

### Authentication
- Google OAuth via Supabase

## Tech Stack

| Layer | Technology | Status |
|-------|-----------|--------|
| Frontend | Next.js 14 (App Router) | Built |
| UI Components | shadcn/ui + Tailwind CSS | Built |
| Visual Editor | React Flow | Built |
| State Management | Zustand | Built |
| Database + Auth | Supabase (PostgreSQL) | Built |
| Backend | Fastify (Node.js/TypeScript) | Built |
| Queue | Redis + BullMQ | Planned |
| Storage | Cloudflare R2 | Planned |

## Quick Start

### Requirements
- Node.js 18+
- Supabase project (free tier works)
- AI provider API keys (Replicate for MVP)

### Installation

```bash
git clone https://github.com/scenenode/scenenode.git
cd scenenode

cp .env.example .env
# Edit .env with your credentials (see below)

# Frontend
cd frontend
npm install
npm run dev

# Backend (in separate terminal)
cd backend
npm install
npm run dev

# Open http://localhost:3000
```

### Environment Variables

```bash
# Frontend (.env in frontend/)
NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...

# Backend (.env in backend/)
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
REDIS_URL=redis://localhost:6379
REPLICATE_API_TOKEN=r8_xxxxx
```

### Getting API Keys

- **Supabase**: https://supabase.com/dashboard - Create a project, copy URL and anon key
- **Replicate**: https://replicate.com/account/api-tokens - Provides access to Nano Banana (images) and VEO (video)
- **ElevenLabs** (optional): https://elevenlabs.io/api - For voice generation

## Project Structure

```
scenenode/
├── frontend/                     # Next.js 14
│   ├── src/
│   │   ├── app/
│   │   │   ├── (auth)/           # Login, signup
│   │   │   └── (main)/           # Dashboard, projects, editor
│   │   ├── components/
│   │   │   ├── editor/           # Workflow canvas, config panel, toolbar
│   │   │   ├── nodes/            # 28 node components + base-node
│   │   │   └── ui/               # shadcn/ui components
│   │   ├── hooks/
│   │   │   ├── use-workflow-store.ts  # Zustand workflow state
│   │   │   ├── use-auth.ts           # Auth hook
│   │   │   └── use-projects-store.ts # Projects state
│   │   ├── lib/
│   │   │   ├── providers-config.ts   # Provider/model mappings
│   │   │   ├── supabase.ts           # Supabase client
│   │   │   └── utils.ts
│   │   └── types/
│   │       └── nodes.ts              # All node types + definitions
│   └── package.json
├── backend/                      # Fastify (Node.js/TypeScript)
│   ├── src/
│   │   ├── routes/               # API endpoints
│   │   ├── services/             # Business logic
│   │   ├── workers/              # BullMQ job workers
│   │   └── lib/                  # Config, Supabase, Redis
│   ├── package.json
│   └── tsconfig.json
├── supabase/
│   └── migrations/               # Database schema
├── CLAUDE.md                     # Full project specification
└── README.md
```

## Development

```bash
# Frontend
cd frontend
npm install
npm run dev      # Development server
npm run build    # Production build
npm run lint     # ESLint

# Backend
cd backend
npm install
npm run dev      # Development server
npm run worker   # BullMQ worker (requires Redis)
```

### Testing

```bash
# Frontend
cd frontend
npm test

# Backend
cd backend
npm test
```

## API

The backend exposes a REST API at `http://localhost:8000`:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/v1/projects` | GET, POST | List/create projects |
| `/v1/projects/:id` | GET, PATCH, DELETE | Project CRUD |
| `/v1/projects/:id/workflows` | GET, POST | List/create workflows |
| `/v1/workflows/:id` | GET, PATCH, DELETE | Workflow CRUD |
| `/v1/workflows/:id/run` | POST | Execute workflow |
| `/v1/jobs` | GET | List jobs |
| `/v1/jobs/:id` | GET | Job status |
| `/v1/render` | POST | Quick render (one-shot) |

Full API documentation: see [CLAUDE.md](./CLAUDE.md)

## Planned Features

- Backend execution engine (workflow runner + job queue)
- AI provider integrations (Nano Banana, VEO, ElevenLabs via Replicate)
- Job progress tracking
- Asset storage (Cloudflare R2)
- Project-level characters for visual consistency
- Style presets library
- Build from Prompt (auto-generate workflow from text description)
- Workflow export/import as JSON
- API access for n8n/Make.com integration

## License

Sustainable Use License - See [LICENSE](./LICENSE)

## Issues

Report bugs and request features at https://github.com/scenenode/scenenode/issues
