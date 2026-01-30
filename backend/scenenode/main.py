from contextlib import asynccontextmanager
from typing import AsyncGenerator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from scenenode.config import settings
from scenenode.api.routes import health, projects, workflows, jobs, render, webhooks


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    # Startup
    if settings.sentry_dsn:
        import sentry_sdk
        sentry_sdk.init(
            dsn=settings.sentry_dsn,
            environment=settings.environment,
            traces_sample_rate=0.1,
        )
    yield
    # Shutdown


app = FastAPI(
    title="SceneNode API",
    version=settings.version,
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "https://app.scenenode.ai",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router, tags=["health"])
app.include_router(projects.router, prefix="/v1", tags=["projects"])
app.include_router(workflows.router, prefix="/v1", tags=["workflows"])
app.include_router(jobs.router, prefix="/v1", tags=["jobs"])
app.include_router(render.router, prefix="/v1", tags=["render"])
app.include_router(webhooks.router, prefix="/v1", tags=["webhooks"])
