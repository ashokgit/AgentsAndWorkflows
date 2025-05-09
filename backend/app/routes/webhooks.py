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

    # Check if this webhook is an active trigger that's expecting test data
    is_test_data = False
    matching_test_nodes = []
    
    for node_id, info in active_webhooks_expecting_test_data.items():
        # Format is: /api/webhooks/wh_{workflow_id}_{node_id}
        expected_path = f"wh_{info['workflow_id']}_{node_id}"
        if webhook_specific_path == expected_path:
            matching_test_nodes.append((node_id, info))
            is_test_data = True
            
    if is_test_data and matching_test_nodes:
        logger.info(f"This is test data for active webhook(s): {matching_test_nodes}")
        # For each matching node in test mode, use background task to send the payload
        for node_id, info in matching_test_nodes:
            workflow_id = info["workflow_id"]
            logger.info(f"Sending test data to workflow {workflow_id}, node {node_id}")
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
                message=f"Test data received for webhook node. Continuing workflow execution.",
                status="Success"
            )
            
            # Remove from active waiting list
            if node_id in active_webhooks_expecting_test_data:
                del active_webhooks_expecting_test_data[node_id]
                
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
            parts = webhook_specific_path.split("_", 2)
            if len(parts) == 3:
                workflow_id = parts[1]
                node_id = parts[2]
                
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