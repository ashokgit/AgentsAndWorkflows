from fastapi import APIRouter, HTTPException, Request
from typing import Dict, List, Any, Optional
from sse_starlette.sse import EventSourceResponse

from app.models.workflow import Workflow
from app.services.workflow_service import run_workflow, log_stream_generator
from app.utils.persistence import workflows_db, workflow_runs, save_workflows_to_disk

router = APIRouter(prefix="/api/workflows", tags=["workflows"])

@router.post("", status_code=201)
async def save_workflow(workflow: Workflow):
    """Save a workflow to the database"""
    workflows_db[workflow.id] = workflow
    save_workflows_to_disk()
    return {"message": "Workflow saved successfully", "workflow_id": workflow.id}

@router.get("/{workflow_id}")
async def get_workflow(workflow_id: str):
    """Get a workflow by ID"""
    workflow = workflows_db.get(workflow_id)
    if not workflow:
        raise HTTPException(status_code=404, detail="Workflow not found")
    return workflow

@router.get("")
async def list_workflows():
    """List all workflows"""
    return list(workflows_db.values())

@router.post("/{workflow_id}/run")
async def run_workflow_and_get_run_id(workflow_id: str, input_data: Optional[Dict[str, Any]] = None):
    """Run a workflow and get the run ID"""
    try:
        run_id = await run_workflow(workflow_id, input_data)
        return {"message": "Workflow execution started", "run_id": run_id, "workflow_id": workflow_id}
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error starting workflow: {str(e)}")

@router.get("/{workflow_id}/runs/{run_id}/stream")
async def stream_logs(request: Request, workflow_id: str, run_id: str):
    """Stream logs for a workflow run"""
    if workflow_id not in workflows_db:
        raise HTTPException(status_code=404, detail="Workflow not found")
    return EventSourceResponse(log_stream_generator(run_id, request))

@router.get("/{workflow_id}/runs")
async def get_workflow_runs(workflow_id: str):
    """Get all runs for a workflow"""
    if workflow_id not in workflows_db:
        raise HTTPException(status_code=404, detail="Workflow not found")
    runs = workflow_runs.get(workflow_id, [])
    return runs 