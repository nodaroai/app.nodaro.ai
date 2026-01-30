from fastapi import APIRouter

router = APIRouter()


@router.get("/projects/{project_id}/workflows")
async def list_workflows(project_id: str) -> dict:
    return {"data": [], "meta": {"total": 0, "page": 1, "limit": 20}}


@router.post("/projects/{project_id}/workflows")
async def create_workflow(project_id: str) -> dict:
    return {"data": {}}


@router.get("/workflows/{workflow_id}")
async def get_workflow(workflow_id: str) -> dict:
    return {"data": {}}


@router.patch("/workflows/{workflow_id}")
async def update_workflow(workflow_id: str) -> dict:
    return {"data": {}}


@router.delete("/workflows/{workflow_id}")
async def delete_workflow(workflow_id: str) -> dict:
    return {"success": True}


@router.post("/workflows/{workflow_id}/duplicate")
async def duplicate_workflow(workflow_id: str) -> dict:
    return {"data": {}}
