# Nodaro.ai

Visual workflow platform for AI video generation. Build video creation pipelines by connecting nodes, with each node representing an AI operation (image generation, video creation, voiceover, etc.).

## Features

- **Visual Workflow Editor** - Drag-and-drop node-based interface powered by React Flow
- **Graph-Based Workflows** - Branching, merging, and chaining (not just linear pipelines)
- **Multiple Node Types** - Text Prompt, Generate Script, Generate Image, Image to Video, Combine Videos
- **Project Organization** - Projects with folders, drag-and-drop workflow management
- **Mobile Responsive** - Full editor and dashboard on mobile with touch-optimized controls
- **Light/Dark Mode** - System-aware theme toggle on all pages
- **Model Agnostic** - Swap AI providers without changing workflows

<!-- TODO: Add screenshots -->

## Quick Start

### Prerequisites

- Node.js 18+
- npm or pnpm

### Development

```bash
# Clone
git clone https://github.com/nodaro/nodaro.git
cd nodaro/frontend

# Install dependencies
npm install

# Run development server
npm run dev

# Open http://localhost:3000
```

### Build

```bash
npm run build
```

### Test

```bash
npm test
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 16 (App Router) |
| UI Components | shadcn/ui + Tailwind CSS |
| Visual Editor | React Flow |
| State Management | Zustand |
| Backend | FastAPI (Python) - planned |
| Database | Supabase (PostgreSQL) - planned |

## Project Structure

```
frontend/
  src/
    app/              # Next.js app router pages
      (auth)/         # Login, signup (planned)
      (dashboard)/    # Dashboard pages
        projects/     # Projects list and detail
    components/
      dashboard/      # Project cards, folder items, workflow cards
      editor/         # Workflow canvas, toolbar, config panel
      nodes/          # Custom node components (base, text-prompt, etc.)
      ui/             # shadcn/ui components
    hooks/            # Zustand stores (projects, workflow)
    lib/              # Utilities (validation, cn helper)
    types/            # TypeScript type definitions
```

## Routes

| Route | Page |
|-------|------|
| `/projects` | Projects list (grid) |
| `/projects/[id]` | Single project (tabs: Workflows, Assets, Jobs) |
| `/projects/[id]/workflows/[workflowId]` | Workflow editor |
| `/settings` | Settings (placeholder) |

## License

Sustainable Use License - See [LICENSE](../LICENSE)
