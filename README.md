# SceneNode.ai

Visual workflow platform for AI video generation. Build video creation pipelines by connecting nodes, with each node representing an AI operation (image generation, video creation, voiceover, etc.).

## Current Status

**Phase 1.2 (Editor) - Complete.** The visual workflow editor is fully functional with 27 node types, field mapping, and provider configuration. Backend execution engine (Phase 1.3) is next.

## Features

### Visual Workflow Editor
- Drag-and-drop node-based editor built on React Flow
- Single input handle per node (like n8n) with field mapping in the config panel
- Connect multiple source nodes to one target and map which source feeds which field
- Dropdown filtering by compatible node types (text nodes only appear in text fields, provider nodes only in provider fields)
- Provider cascading dropdowns: Category -> Provider -> Model
- Graph-based workflows: branching, merging, multiple inputs/outputs
- Debounced auto-save with Ctrl+S support

### 27 Node Types

| Category | Nodes |
|----------|-------|
| **Input** | Text Prompt, Upload Image, Upload Video, RSS Feed |
| **Parameter** | Provider, Duration, Aspect Ratio, Tone, Style Guide, Scene Count, Motion, Camera Motion |
| **AI** | Generate Script, Generate Image, Image to Video, Text to Speech, QA Check |
| **Processing** | Combine Videos, Add Audio, Extract Audio, Mix Audio, Add Captions, Resize Video, Trim Video, Adjust Volume |
| **Output** | Save to Storage, Webhook Output |

### Dashboard
- Projects with folders
- Workflow management
- Mobile responsive (collapsible sidebar, touch targets, pinch-to-zoom)
- Light/Dark mode

### Admin Panel
- User management at `/admin` (cloud edition only)
- Role-based access control (user, admin, super_admin)
- Protected routes via middleware

### Edition System
- **Self-hosted** (free): Full editor, all nodes, no admin panel
- **Cloud** (SaaS): Admin panel, billing, team features

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
| Backend | FastAPI (Python) | Planned |
| Queue | Redis + BullMQ | Planned |
| Storage | Cloudflare R2 | Planned |
| Payments | Paddle | Planned |

## Project Structure

```
scenenode/
├── frontend/                     # Next.js 14
│   ├── src/
│   │   ├── app/
│   │   │   ├── (auth)/           # Login, signup
│   │   │   ├── (main)/           # Dashboard, projects, editor
│   │   │   └── admin/            # Admin panel
│   │   ├── components/
│   │   │   ├── editor/           # Workflow canvas, config panel, toolbar
│   │   │   ├── nodes/            # 27 node components + base-node
│   │   │   └── ui/               # shadcn/ui components
│   │   ├── hooks/
│   │   │   ├── use-workflow-store.ts  # Zustand workflow state
│   │   │   ├── use-auth.ts           # Auth hook with role checking
│   │   │   └── use-projects-store.ts # Projects state
│   │   ├── lib/
│   │   │   ├── providers-config.ts   # Provider/model mappings
│   │   │   ├── edition.ts            # Self-hosted vs cloud
│   │   │   ├── supabase.ts           # Supabase client
│   │   │   └── utils.ts
│   │   └── types/
│   │       └── nodes.ts              # All node types + definitions
│   └── package.json
├── supabase/
│   └── migrations/               # Database schema
├── CLAUDE.md                     # Full project specification
└── README.md
```

## Quick Start

### Cloud (Recommended)

1. Go to https://app.scenenode.ai
2. Sign up with Google
3. Create a project and start building workflows

### Self-Hosted (Docker)

```bash
git clone https://github.com/scenenode/scenenode.git
cd scenenode

cp .env.example .env
# Edit .env with your Supabase credentials

cd frontend
npm install
npm run dev

# Open http://localhost:3000
```

### Environment Variables

```bash
# Required
NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...

# Optional
NEXT_PUBLIC_EDITION=cloud  # or "self-hosted" (default)
```

## Planned Features

- Backend execution engine (FastAPI + Redis + BullMQ)
- AI provider integrations (Nano Banana, VEO, ElevenLabs via Replicate)
- Job queue with progress tracking
- Asset storage (Cloudflare R2)
- Project-level characters for visual consistency
- Style presets library
- Build from Prompt (auto-generate workflow from text description)
- Workflow export/import as JSON
- API access for n8n/Make.com integration
- Credits and billing system (Paddle)

## License

Sustainable Use License - See [LICENSE](./LICENSE)

## Development

```bash
cd frontend
npm install
npm run dev      # Development server
npm run build    # Production build
npm run lint     # ESLint
```
