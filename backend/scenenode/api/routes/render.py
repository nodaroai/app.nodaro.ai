from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter()


class QuickRenderRequest(BaseModel):
    prompt: str
    style: str = "children-book"
    duration: int = 60
    voice: str = "narrator-male"
    aspect_ratio: str = "9:16"
    webhook_url: str | None = None
    options: dict | None = None


@router.post("/render")
async def quick_render(request: QuickRenderRequest) -> dict:
    return {
        "job_id": "",
        "status": "queued",
        "estimated_credits": 209,
    }
