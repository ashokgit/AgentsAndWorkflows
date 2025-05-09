from fastapi import APIRouter, HTTPException, Request, Body, Query
from typing import Dict, List, Any, Optional, Union
from sse_starlette.sse import EventSourceResponse
from datetime import datetime
import logging
import traceback
import os
import json

from app.models.workflow import Workflow
from app.services.workflow_service import run_workflow, log_stream_generator, test_workflow
from app.utils.persistence import workflows_db, workflow_runs, save_workflows_to_disk, get_run_logs, runs_dir

router = APIRouter(prefix="/api/workflows", tags=["workflows"])
logger = logging.getLogger(__name__)

@router.post("", status_code=201)
async def save_workflow(workflow: Workflow):
    """Save a workflow to the database"""
    # If workflow exists and was active, preserve active state
    if workflow.id in workflows_db:
        old_workflow = workflows_db[workflow.id]
        # When a workflow is modified, reset tested state and set to inactive
        # Only preserve active state if nothing was changed in the workflow logic
        if (old_workflow.nodes != workflow.nodes or 
            old_workflow.edges != workflow.edges):
            workflow.tested = False
            workflow.is_active = False
        else:
            # If no logic changes, preserve active state
            workflow.is_active = old_workflow.is_active
            workflow.tested = old_workflow.tested
            workflow.last_tested = old_workflow.last_tested
    
    workflows_db[workflow.id] = workflow
    save_workflows_to_disk()
    return {"message": "Workflow saved successfully", "workflow_id": workflow.id}

@router.post("/import_single", status_code=200)
async def import_single_workflow(workflow_to_import: Workflow = Body(...)):
    """
    Imports a single workflow from its JSON representation.
    If a workflow with the same ID already exists, it will be overwritten.
    """
    if not workflow_to_import or not workflow_to_import.id:
        # This case should ideally be caught by Pydantic validation if ID is not optional
        logger.error("Import failed: Workflow data or ID missing in request.")
        raise HTTPException(status_code=400, detail="Workflow data and ID are required.")
    
    try:
        logger.info(f"Attempting to import workflow ID: {workflow_to_import.id}, Name: {workflow_to_import.name}")
        
        # FastAPI automatically parses the request body into the Workflow Pydantic model.
        # This includes validation against the model's schema.
        
        # Add or update the workflow in the in-memory database
        workflows_db[workflow_to_import.id] = workflow_to_import
        
        # Persist all changes (including this import) to disk
        # The save_workflows_to_disk function now handles all relevant files.
        save_workflows_to_disk()
        
        logger.info(f"Workflow '{workflow_to_import.name}' (ID: {workflow_to_import.id}) imported successfully.")
        return {
            "message": "Workflow imported successfully", 
            "workflow_id": workflow_to_import.id,
            "workflow_name": workflow_to_import.name
        }
    except HTTPException: # Re-raise HTTPExceptions directly
        raise
    except Exception as e:
        logger.error(f"Error importing workflow {workflow_to_import.id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"An unexpected error occurred while importing the workflow: {str(e)}")

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

@router.post("/{workflow_id}/test")
async def test_workflow_and_get_run_id(workflow_id: str, input_data: Optional[Dict[str, Any]] = None):
    """Test a workflow and get the run ID. If successful, marks workflow as tested."""
    try:
        logger.info(f"Starting test for workflow: {workflow_id}")
        test_result = await test_workflow(workflow_id, input_data)
        logger.info(f"Test started successfully for workflow: {workflow_id}, run_id: {test_result.get('run_id')}")
        return {
            "message": "Workflow test started", 
            "run_id": test_result["run_id"], 
            "workflow_id": workflow_id
        }
    except ValueError as e:
        logger.error(f"Workflow not found error: {str(e)}")
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        error_traceback = traceback.format_exc()
        logger.error(f"Error testing workflow {workflow_id}: {str(e)}\n{error_traceback}")
        raise HTTPException(status_code=500, detail=f"Error testing workflow: {str(e)}")

@router.post("/{workflow_id}/toggle_active")
async def toggle_workflow_active(workflow_id: str, active: bool = Body(..., embed=True)):
    """Toggle the active state of a workflow"""
    workflow = workflows_db.get(workflow_id)
    if not workflow:
        raise HTTPException(status_code=404, detail="Workflow not found")
    
    # Only allow activating if workflow has been tested
    if active and not workflow.tested:
        raise HTTPException(status_code=400, detail="Cannot activate workflow that hasn't been successfully tested")
    
    workflow.is_active = active
    workflows_db[workflow_id] = workflow
    save_workflows_to_disk()
    
    return {"message": f"Workflow {workflow_id} {'activated' if active else 'deactivated'}", "is_active": active}

@router.get("/{workflow_id}/runs/{run_id}/stream")
async def stream_logs(request: Request, workflow_id: str, run_id: str):
    """Stream logs for a workflow run"""
    if workflow_id not in workflows_db:
        raise HTTPException(status_code=404, detail="Workflow not found")
    return EventSourceResponse(log_stream_generator(run_id, request))

@router.get("/{workflow_id}/runs")
async def get_workflow_runs(
    workflow_id: str, 
    limit: int = Query(50, description="Maximum number of logs to return"),
    include_archived: bool = Query(True, description="Whether to include archived logs")
):
    """Get all runs for a workflow with pagination and filtering"""
    if workflow_id not in workflows_db:
        raise HTTPException(status_code=404, detail="Workflow not found")
    
    # Use the new function to retrieve logs with metadata
    runs = get_run_logs(workflow_id, limit, include_archived)
    return runs 

@router.get("/{workflow_id}/runs/{run_id}")
async def get_workflow_run_by_id(workflow_id: str, run_id: str):
    """Get a specific run by ID"""
    if workflow_id not in workflows_db:
        raise HTTPException(status_code=404, detail="Workflow not found")
    
    # First check in-memory runs
    for run_log in workflow_runs.get(workflow_id, []):
        # Find the run with matching run_id
        if run_log and len(run_log) > 0 and run_log[0].get('run_id') == run_id:
            return {
                "run_id": run_id,
                "workflow_id": workflow_id,
                "logs": run_log
            }
    
    # If not found in memory, check in archived files
    workflow_run_dir = os.path.join(runs_dir, workflow_id)
    if not os.path.exists(workflow_run_dir):
        raise HTTPException(status_code=404, detail="Run not found")
        
    # Search through archived run files
    run_files = os.listdir(workflow_run_dir)
    for run_file in run_files:
        if run_id in run_file:  # Quick check before loading file
            try:
                with open(os.path.join(workflow_run_dir, run_file), 'r') as f:
                    run_data = json.load(f)
                    if run_data.get('metadata', {}).get('run_id') == run_id:
                        return run_data  # Return the full data with metadata and logs
            except Exception as e:
                logger.error(f"Error loading archived run log {run_file}: {e}")
    
    raise HTTPException(status_code=404, detail="Run not found") 