from fastapi import APIRouter, Request, Response, HTTPException, BackgroundTasks, Depends
from typing import Dict, Any, Optional
import logging
import httpx
import json
from starlette.responses import RedirectResponse

from app.utils.persistence import webhook_mapping, webhook_registry

# Set up logging
logger = logging.getLogger(__name__)

# Create router WITHOUT /api prefix - this is important
router = APIRouter(tags=["webhooks_ui"])

@router.api_route("/webhooks/{webhook_id}", methods=["GET", "POST", "PUT", "DELETE"])
async def handle_ui_webhook(webhook_id: str, request: Request, background_tasks: BackgroundTasks):
    """
    Handle webhooks coming from the UI-friendly URL format (/webhooks/{uuid})
    and forward them to the internal format (/api/webhooks/wh_{workflow_id}_{node_id}).
    
    This bridges the gap between how webhooks are presented in the UI and how they're
    handled internally during workflow testing.
    """
    logger.info(f"Received UI webhook request for webhook_id: {webhook_id}")
    
    # First try to find in the webhook_mapping (UUID based)
    if webhook_id not in webhook_mapping:
        logger.error(f"Webhook ID {webhook_id} not found in webhook_mapping")
        raise HTTPException(status_code=404, detail=f"Webhook ID {webhook_id} not found")
    
    # Get the workflow_id and node_id from the mapping
    mapping = webhook_mapping[webhook_id]
    workflow_id = mapping.get("workflow_id")
    node_id = mapping.get("node_id")
    
    if not workflow_id or not node_id:
        logger.error(f"Invalid webhook mapping for {webhook_id}: {mapping}")
        raise HTTPException(status_code=500, detail="Invalid webhook mapping data")
    
    # Construct the internal webhook path that we need to call
    internal_webhook_path = f"/api/webhooks/wh_{workflow_id}_{node_id}"
    internal_webhook_url = f"http://localhost:8000{internal_webhook_path}"
    
    logger.info(f"Forwarding UI webhook {webhook_id} to internal path: {internal_webhook_path}")
    
    # Get the body from the request
    try:
        body = await request.body()
        content_type = request.headers.get("content-type", "")
        logger.info(f"Webhook {webhook_id} received {request.method} with content-type: {content_type}")
    except Exception as e:
        logger.error(f"Error reading request body for webhook {webhook_id}: {e}")
        body = b""
    
    # Construct headers to forward
    headers = {}
    for key, value in request.headers.items():
        if key.lower() not in ["host", "content-length"]:
            headers[key] = value
    
    # Forward the request to the internal endpoint
    try:
        async with httpx.AsyncClient() as client:
            response = await client.request(
                method=request.method,
                url=internal_webhook_url,
                headers=headers,
                content=body,
                params=dict(request.query_params)
            )
            
            logger.info(f"Forwarded webhook {webhook_id} to {internal_webhook_path}, status: {response.status_code}")
            
            # Return the response from the internal endpoint
            return Response(
                content=response.content,
                status_code=response.status_code,
                headers=dict(response.headers),
                media_type=response.headers.get("content-type")
            )
    except Exception as e:
        logger.error(f"Error forwarding webhook {webhook_id} to {internal_webhook_path}: {e}")
        raise HTTPException(status_code=500, detail=f"Error forwarding webhook: {str(e)}") 