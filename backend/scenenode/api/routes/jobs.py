from fastapi import APIRouter

router = APIRouter()


@router.post("/workflows/{workflow_id}/run")
async def run_workflow(workflow_id: str) -> dict:
    return {"data": {}}


@router.get("/jobs")
async def list_jobs() -> dict:
    return {"data": [], "meta": {"total": 0, "page": 1, "limit": 20}}


@router.get("/jobs/{job_id}")
async def get_job(job_id: str) -> dict:
    return {"data": {}}


@router.post("/jobs/{job_id}/cancel")
async def cancel_job(job_id: str) -> dict:
    return {"success": True}


@router.post("/jobs/{job_id}/retry")
async def retry_job(job_id: str) -> dict:
    return {"data": {}}
