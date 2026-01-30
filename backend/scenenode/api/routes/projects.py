from fastapi import APIRouter

router = APIRouter()


@router.get("/projects")
async def list_projects() -> dict:
    return {"data": [], "meta": {"total": 0, "page": 1, "limit": 20}}


@router.post("/projects")
async def create_project() -> dict:
    return {"data": {}}


@router.get("/projects/{project_id}")
async def get_project(project_id: str) -> dict:
    return {"data": {}}


@router.patch("/projects/{project_id}")
async def update_project(project_id: str) -> dict:
    return {"data": {}}


@router.delete("/projects/{project_id}")
async def delete_project(project_id: str) -> dict:
    return {"success": True}
