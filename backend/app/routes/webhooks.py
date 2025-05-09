from fastapi import APIRouter, Request, HTTPException, BackgroundTasks
from typing import Dict, List, Any, Optional
import logging
import time
import asyncio
import traceback
import uuid
from datetime import datetime

from app.models.workflow import WebhookRegistration
from app.utils.persistence import webhook_payloads, webhook_registry, webhook_mapping, workflows_db, save_webhooks_to_disk
from app.services.workflow_service import run_workflow, signal_webhook_data_for_test, active_webhooks_expecting_test_data
import app.services.workflow_service as workflow_service

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
@router.api_route("/{webhook_specific_path:path}", methods=["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"])
async def handle_webhook_callback(
    request: Request,
    webhook_specific_path: str,
    background_tasks: BackgroundTasks
):
    """Handle incoming webhook requests and optionally forward to active nodes"""
    payload = None
    
    # Log the incoming request for debugging
    logger.info(f"Received webhook request to: /{webhook_specific_path}")
    
    # Determine the method
    method = request.method.lower()
    
    # Try to parse JSON payload if it's a POST/PUT/PATCH
    if method in ["post", "put", "patch"]:
        try:
            payload = await request.json()
            logger.info(f"Successfully parsed webhook payload: {payload}")
        except Exception as e:
            logger.warning(f"Failed to parse JSON payload: {str(e)}")
            # Try to get form data instead
            try:
                form_data = await request.form()
                payload = dict(form_data)
                logger.info(f"Successfully parsed form data: {payload}")
            except Exception as e2:
                logger.warning(f"Failed to parse form data: {str(e2)}")
                try:
                    # Last resort: try to get raw body
                    body = await request.body()
                    payload = {"raw": body.decode('utf-8', errors='ignore')}
                    logger.info(f"Using raw body as payload: {payload}")
                except Exception as e3:
                    logger.error(f"Failed to get request body: {str(e3)}")
                    payload = {}
    elif method == "get":
        # For GET requests, use query parameters as payload
        payload = dict(request.query_params)
        logger.info(f"Using query parameters as payload: {payload}")
    else:
        payload = {}
        
    # Store this payload in memory for testing/viewing
    webhook_payloads[webhook_specific_path] = {
        "payload": payload,
        "timestamp": datetime.now().isoformat(),
        "method": method
    }
    
    # Helper function to log webhook events to the frontend
    def log_webhook_event(webhook_id, workflow_id, node_id, message, status="Info", is_success=True):
        """Helper function to create structured webhook log entries for the UI"""
        log_entry = {
            "timestamp": datetime.now().isoformat(),
            "webhook_id": webhook_id,
            "workflow_id": workflow_id,
            "node_id": node_id,
            "message": message,
            "status": status,
            "success": is_success
        }
        logger.info(f"Webhook event: {log_entry}")
        # This could be extended to store logs or send them to websockets in the future
        return log_entry

    # --- Handle Webhook Data Expected During a Test Run ---
    incoming_full_path = f"/api/webhooks/{webhook_specific_path}"

    if incoming_full_path in active_webhooks_expecting_test_data:
        # The workflow test runner is waiting for this webhook data
        run_id = active_webhooks_expecting_test_data[incoming_full_path]

        # Extract workflow_id and node_id from the path. Format: wh_<workflow_id>_<node_id>
        workflow_id = None
        node_id = None
        if webhook_specific_path.startswith("wh_"):
            # First, find where the node_id begins (look for "dndnode_" pattern)
            remainder = webhook_specific_path[3:]  # Remove 'wh_' prefix
            dndnode_index = remainder.find("dndnode_")
            
            if dndnode_index >= 0:
                # If we found the pattern, split at that position
                workflow_id = remainder[:dndnode_index-1] if dndnode_index > 0 else None
                node_id = remainder[dndnode_index:]
            else:
                # Fallback: Just take the last component as node_id
                # This might not be accurate but is better than nothing
                parts = remainder.split("_")
                if len(parts) >= 2:
                    workflow_id = "_".join(parts[:-1])
                    node_id = parts[-1]
                    # Check if this looks wrong (node_id is numeric) and try to fix
                    if node_id.isdigit() and "dndnode" in workflow_id:
                        # Attempt a better split - find the last occurrence of "dndnode"
                        last_dndnode = workflow_id.rfind("dndnode")
                        if last_dndnode >= 0:
                            # Reconstruct the node_id properly
                            node_id = f"{workflow_id[last_dndnode:]}_{node_id}"
                            workflow_id = workflow_id[:last_dndnode-1] if last_dndnode > 0 else None

        logger.info(f"[TestWebhook] Data received for run {run_id}. Workflow: {workflow_id}, Node: {node_id}")

        # Signal the workflow service asynchronously so the paused test run can resume
        background_tasks.add_task(
            signal_webhook_data_for_test,
            webhook_path=incoming_full_path,
            node_id=node_id,
            data=payload
        )

        # Optional: structured log for UI or future websocket notifications
        log_webhook_event(
            webhook_id=incoming_full_path,
            workflow_id=workflow_id,
            node_id=node_id,
            message="Test data received for webhook node. Continuing workflow execution.",
            status="Success"
        )

        return {
            "success": True,
            "message": "✅ Webhook test data received",
            "details": {
                "received_at": datetime.now().isoformat(),
                "payload_size": len(str(payload)),
                "payload_preview": str(payload)[:100] + ("..." if len(str(payload)) > 100 else ""),
                "workflow_continuing": True
            }
        }
    
    # Try to match with a registered webhook from the registry
    matched_webhook = None
    for webhook_id, webhook_info in webhook_registry.items():
        if webhook_specific_path == webhook_id:
            matched_webhook = webhook_info
            break
            
    # Try auto-registering if it has a standard format (wh_{workflow_id}_{node_id})
    # This approach allows clients to use deterministic webhook URLs without explicit registration
    if not matched_webhook and webhook_specific_path.startswith("wh_"):
        try:
            # Extract parts after the wh_ prefix
            remainder = webhook_specific_path[3:]  # Remove 'wh_' prefix
            
            # Handle the case where workflow_id includes the 'wf_' prefix 
            if '_' in remainder:
                # Find the position of the last underscore to extract node_id
                last_underscore_pos = remainder.rfind('_')
                if last_underscore_pos > 0:  # Ensure there's text before the underscore
                    workflow_id = remainder[:last_underscore_pos]
                    node_id = remainder[last_underscore_pos+1:]
                    logger.info(f"Auto-registration parsed: workflow_id={workflow_id}, node_id={node_id}")
                
                # Double-check for common parsing errors
                if node_id.isdigit() and '_' in workflow_id:
                    # It's likely that workflow_id incorrectly includes part of the node_id
                    # Try to fix it - assume the last component after '_' is the node_id
                    try:
                        components = workflow_id.split('_')
                        # If the workflow format is "wf_123456_dndnode", then extract properly
                        if len(components) >= 3 and components[-1].startswith('dndnode'):
                            fixed_node_id = f"{components[-1]}_{node_id}"
                            fixed_workflow_id = "_".join(components[:-1])
                            logger.info(f"Fixed parsing: workflow_id={fixed_workflow_id}, node_id={fixed_node_id}")
                            workflow_id = fixed_workflow_id
                            node_id = fixed_node_id
                    except Exception as parse_fix_error:
                        logger.error(f"Error fixing webhook parsing: {parse_fix_error}")
                
                # Create a mapping for this webhook path
                webhook_mapping[webhook_specific_path] = {
                    "workflow_id": workflow_id,
                    "node_id": node_id
                }
                
                matched_webhook = {
                    "workflow_id": workflow_id,
                    "node_id": node_id,
                    "auto_registered": True
                }
                
                logger.info(f"Auto-registered webhook: {webhook_specific_path} -> workflow:{workflow_id}, node:{node_id}")
                # Log success message for UI clarity
                log_webhook_event(
                    webhook_id=f"/api/webhooks/{webhook_specific_path}",
                    workflow_id=workflow_id,
                    node_id=node_id,
                    message=f"Webhook auto-registered successfully",
                    status="Info"
                )
        except Exception as e:
            logger.error(f"Error auto-registering webhook: {str(e)}")
    
    if matched_webhook:
        workflow_id = matched_webhook.get("workflow_id")
        node_id = matched_webhook.get("node_id")
        
        # Use background task to send the payload to avoid blocking
        background_tasks.add_task(
            workflow_service.send_webhook_data_to_node,
            workflow_id=workflow_id,
            node_id=node_id,
            payload=payload
        )
        # Log success message for UI clarity
        log_webhook_event(
            webhook_id=f"/api/webhooks/{webhook_specific_path}",
            workflow_id=workflow_id,
            node_id=node_id,
            message=f"Webhook data received and passed to workflow",
            status="Success"
        )
        
        return {
            "success": True,
            "message": "✅ Webhook data received successfully",
            "details": {
                "received_at": datetime.now().isoformat(),
                "workflow_id": workflow_id,
                "node_id": node_id,
                "payload_size": len(str(payload)),
                "payload_preview": str(payload)[:100] + ("..." if len(str(payload)) > 100 else "")
            }
        }
    
    # No matched webhook found, but still store the payload for potential later use
    return {
        "success": False,
        "message": "⚠️ Webhook received but no handler found",
        "details": {
            "path": webhook_specific_path,
            "suggestion": "This webhook may exist but isn't connected to any active workflow. Data was captured for debugging.",
            "received_at": datetime.now().isoformat(),
            "payload_preview": str(payload)[:100] + ("..." if len(str(payload)) > 100 else "")
        }
    } 