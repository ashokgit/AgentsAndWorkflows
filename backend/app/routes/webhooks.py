from fastapi import APIRouter, Request, HTTPException, BackgroundTasks
from typing import Dict, List, Any, Optional
import logging
import time
import asyncio
import traceback
import uuid

from app.models.workflow import WebhookRegistration
from app.utils.persistence import webhook_payloads, webhook_registry, webhook_mapping, workflows_db, save_webhooks_to_disk
from app.services.workflow_service import run_workflow, signal_webhook_data_for_test, active_webhooks_expecting_test_data

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/webhooks", tags=["webhooks"])

@router.post("/register")
async def register_webhook(data: Dict[str, str]):
    """Register a webhook endpoint for a node in a workflow.
       This creates both:
       1. An internal path at /api/webhooks/wh_{workflow_id}_{node_id}
       2. A user-friendly UUID-based path at /webhooks/{uuid}
    """
    workflow_id = data.get("workflow_id")
    node_id = data.get("node_id")
    
    if not workflow_id or not node_id:
        raise HTTPException(status_code=400, detail="workflow_id and node_id are required")
    
    if workflow_id not in workflows_db:
        raise HTTPException(status_code=404, detail=f"Workflow {workflow_id} not found")

    # Create a unique URL path for this webhook relative to the /api/webhooks prefix
    # Example: wh_workflow123_node456. This will be served at /api/webhooks/wh_workflow123_node456
    webhook_specific_path_segment = f"wh_{workflow_id}_{node_id}" 
    full_path_identifier = f"/api/webhooks/{webhook_specific_path_segment}" # This is the key for our registries
    
    # Generate a UUID for the user-friendly webhook path
    webhook_id = str(uuid.uuid4())
    
    # Store in registry (in-memory for now)
    webhook_registry[full_path_identifier] = {
        "workflow_id": workflow_id, 
        "node_id": node_id,
        "webhook_id": webhook_id
    }
    
    # Also store in webhook_mapping for the user-friendly routes
    webhook_mapping[webhook_id] = {
        "workflow_id": workflow_id,
        "node_id": node_id,
        "internal_path": full_path_identifier
    }
    
    # Initialize the payload store for this webhook
    if full_path_identifier not in webhook_payloads:
        webhook_payloads[full_path_identifier] = []
    
    # Save the webhooks to disk
    save_webhooks_to_disk()
    
    logger.info(f"Registered webhook for Workflow ID: {workflow_id}, Node ID: {node_id} at path {full_path_identifier} with UUID {webhook_id}")
    
    return {
        "webhook_url": full_path_identifier, # The internal API path
        "webhook_id": webhook_id,            # The UUID for user-friendly path
        "workflow_id": workflow_id,
        "node_id": node_id
    }

@router.get("/registry")
async def list_registered_webhooks():
    """List all registered webhooks and their paths."""
    return webhook_registry

@router.get("/{webhook_specific_path:path}/payloads")
async def get_webhook_payloads(webhook_specific_path: str):
    """Get all payloads received by a specific webhook, using its specific path segment."""
    full_path_identifier = f"/api/webhooks/{webhook_specific_path}"
    if full_path_identifier not in webhook_registry:
        raise HTTPException(status_code=404, detail=f"Webhook path {full_path_identifier} not found in registry")
    
    return webhook_payloads.get(full_path_identifier, [])

@router.delete("/{webhook_specific_path:path}/payloads")
async def clear_webhook_payloads(webhook_specific_path: str):
    """Clear all payloads for a specific webhook, using its specific path segment."""
    full_path_identifier = f"/api/webhooks/{webhook_specific_path}"
    if full_path_identifier not in webhook_registry:
        raise HTTPException(status_code=404, detail=f"Webhook path {full_path_identifier} not found in registry")
    
    webhook_payloads[full_path_identifier] = []
    return {"message": f"All payloads cleared for {full_path_identifier}"}

@router.get("/debug")
async def debug_webhooks():
    """Debug endpoint to show all webhook registries and payloads"""
    return {
        "webhook_registry": webhook_registry,
        "webhook_payloads": webhook_payloads,
        "webhook_mappings": webhook_mapping,  # Added for frontend compatibility with legacy code
        "webhook_mapping": webhook_mapping,   # Alias for completeness
        "active_webhooks_expecting_test_data": active_webhooks_expecting_test_data
    }

# This endpoint handles the actual incoming webhook POST/GET requests
# The {webhook_specific_path:path} will capture everything after /api/webhooks/
# e.g., if POST to /api/webhooks/wh_wf1_node1, webhook_specific_path will be "wh_wf1_node1"
@router.api_route("/{webhook_specific_path:path}", methods=["GET", "POST", "PUT", "DELETE"])
async def handle_webhook_callback(webhook_specific_path: str, request: Request, background_tasks: BackgroundTasks):
    """Handle incoming webhook callbacks for a dynamically registered path.
    If the path was not explicitly registered beforehand, attempt to derive the
    workflow_id and node_id from the path pattern (wh_{workflow_id}_{node_id})
    and auto-register it on-the-fly so that explicit registration becomes optional.
    """
    full_path_identifier = f"/api/webhooks/{webhook_specific_path}"  # Reconstruct the key used in registry

    logger.info(f"Webhook callback received for path: {full_path_identifier}, Method: {request.method}")

    # ---------------------------------------------------------------
    # Dynamic auto-registration logic (makes manual registration optional)
    # ---------------------------------------------------------------
    if full_path_identifier not in webhook_registry:
        logger.debug(f"Webhook path {full_path_identifier} not found in registry. Attempting dynamic discovery.")

        derived_workflow_id: Optional[str] = None
        derived_node_id: Optional[str] = None

        # Try to match by iterating over existing workflows and checking prefix
        for wf_id, wf in workflows_db.items():
            prefix = f"wh_{wf_id}_"
            if webhook_specific_path.startswith(prefix):
                # Everything after the prefix is treated as the node_id
                derived_node_id = webhook_specific_path[len(prefix):]
                derived_workflow_id = wf_id
                # Validate that this node actually exists and is a webhook type
                matching_nodes = [n for n in wf.nodes if n.id == derived_node_id and n.type in ["webhook_trigger", "webhook"]]
                if matching_nodes:
                    break  # Found a valid mapping
                else:
                    derived_workflow_id = None  # Reset if validation fails

        if derived_workflow_id and derived_node_id:
            logger.info(f"Dynamically registering webhook path {full_path_identifier} for workflow {derived_workflow_id}, node {derived_node_id}")
            # Use the path itself as the primary key (no separate UUID needed)
            webhook_registry[full_path_identifier] = {
                "workflow_id": derived_workflow_id,
                "node_id": derived_node_id,
                "webhook_id": full_path_identifier  # For backward compatibility
            }
            webhook_mapping[full_path_identifier] = {
                "workflow_id": derived_workflow_id,
                "node_id": derived_node_id,
                "internal_path": full_path_identifier
            }
            # Ensure payloads list exists
            webhook_payloads.setdefault(full_path_identifier, [])
            # Persist to disk asynchronously (blocking call is fine for now)
            save_webhooks_to_disk()
        else:
            logger.warning(f"Could not dynamically resolve webhook path {full_path_identifier}.")
            raise HTTPException(status_code=404, detail=f"Webhook path {full_path_identifier} not recognized and could not be auto-registered.")

    # From this point we are guaranteed to have the path in the registry
    reg_info = webhook_registry[full_path_identifier]
    workflow_id = reg_info["workflow_id"]
    node_id = reg_info["node_id"]
    
    try:
        try:
            payload = await request.json()
            logger.debug(f"Successfully parsed JSON payload for {full_path_identifier}")
        except Exception as json_error:
            logger.debug(f"Failed to parse JSON payload for {full_path_identifier}: {str(json_error)}")
            payload = await request.text()
            
        payload_entry = {
            "data": payload,
            "headers": dict(request.headers),
            "method": request.method,
            "timestamp": time.time(),
            "query_params": dict(request.query_params)
        }
        
        webhook_payloads.setdefault(full_path_identifier, []).append(payload_entry)
        # Limit stored payloads if necessary (e.g., last 100)
        if len(webhook_payloads[full_path_identifier]) > 100:
            webhook_payloads[full_path_identifier] = webhook_payloads[full_path_identifier][-100:]

        logger.info(f"Received webhook payload for {full_path_identifier} (Node: {node_id}): {type(payload)}")
        
        # Check if this webhook is part of an active test run
        if full_path_identifier in active_webhooks_expecting_test_data:
            run_id_for_test = active_webhooks_expecting_test_data[full_path_identifier]
            logger.info(f"Webhook {full_path_identifier} is part of active test run {run_id_for_test}. Signaling node {node_id}.")
            try:
                # This is critical: signal the specific test run. Non-blocking.
                background_tasks.add_task(
                    signal_webhook_data_for_test, 
                    webhook_path=full_path_identifier, # Pass the path key
                    node_id=node_id, 
                    data=payload # Pass the actual data received
                )
                logger.info(f"Successfully scheduled signal_webhook_data_for_test for {full_path_identifier} in test run {run_id_for_test}")
                # Note: signal_webhook_data_for_test will remove it from active_webhooks_expecting_test_data
                return {"status": "success", "message": "Webhook data received and forwarded to test run."}
            except Exception as test_signal_error:
                error_traceback = traceback.format_exc()
                logger.error(f"Error signaling test run for webhook {full_path_identifier}: {str(test_signal_error)}\n{error_traceback}")
                return {"status": "error", "message": f"Error signaling test run: {str(test_signal_error)}"}
        
        # If not for a test, or if test signaling failed/not applicable, proceed with normal active workflow check
        workflow = workflows_db.get(workflow_id)
        if workflow and workflow.is_active:
            logger.info(f"Workflow {workflow_id} is active. Triggering run for node {node_id}.")
            try:
                background_tasks.add_task(run_workflow, workflow_id, {"webhook_data": payload, "triggered_by_node": node_id})
                return {"status": "success", "message": "Webhook received and active workflow triggered"}
            except Exception as run_error:
                error_traceback = traceback.format_exc()
                logger.error(f"Error triggering workflow {workflow_id} from webhook: {str(run_error)}\n{error_traceback}")
                return {"status": "error", "message": f"Error triggering workflow: {str(run_error)}"}
        elif workflow and not workflow.is_active:
            logger.info(f"Webhook received for node {node_id} in workflow {workflow_id}, but workflow is inactive.")
            return {"status": "success", "message": "Webhook received, workflow inactive"}
        else:
            logger.warning(f"Webhook received for node {node_id}, but workflow {workflow_id} not found.")
            return {"status": "success", "message": "Webhook received, workflow not found (or an issue occurred)"}
    except Exception as e:
        error_traceback = traceback.format_exc()
        logger.error(f"Unhandled exception in webhook handler for {full_path_identifier}: {str(e)}\n{error_traceback}")
        return {"status": "error", "message": f"Server error processing webhook: {str(e)}"} 