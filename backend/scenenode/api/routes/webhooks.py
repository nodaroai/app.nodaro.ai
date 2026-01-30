from fastapi import APIRouter

router = APIRouter()


@router.get("/webhooks")
async def list_webhooks() -> dict:
    return {"data": []}


@router.post("/webhooks")
async def create_webhook() -> dict:
    return {"data": {}}


@router.patch("/webhooks/{webhook_id}")
async def update_webhook(webhook_id: str) -> dict:
    return {"data": {}}


@router.delete("/webhooks/{webhook_id}")
async def delete_webhook(webhook_id: str) -> dict:
    return {"success": True}
