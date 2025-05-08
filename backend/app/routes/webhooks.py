from fastapi import APIRouter, HTTPException, Request
from typing import Dict, Any

from app.models.workflow import WebhookRegistration
from app.services.webhook_service import register_webhook, handle_webhook
from app.utils.persistence import webhook_payloads, webhook_mapping, workflows_db

router_api = APIRouter(prefix="/api/webhooks", tags=["webhooks"])
router_webhooks = APIRouter(prefix="/webhooks", tags=["webhooks"])

@router_api.post("/register")
async def register_webhook_endpoint(registration: WebhookRegistration):
    """Register a webhook and generate a unique ID for it"""
    try:
        webhook_id = await register_webhook(registration.workflow_id, registration.node_id)
        return {"webhook_id": webhook_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error registering webhook: {str(e)}")

@router_api.get("/{webhook_id}/payload")
async def get_webhook_payload(webhook_id: str):
    """Get the current payload for a webhook by ID"""
    try:
        if webhook_id not in webhook_payloads:
            return {"status": "no_data", "message": "No payload received for this webhook yet"}
        
        return {
            "status": "success",
            "webhook_id": webhook_id,
            "payload": webhook_payloads[webhook_id]
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error retrieving webhook payload: {str(e)}")

@router_api.get("/debug")
async def debug_webhooks():
    """Debug endpoint to show all webhook mappings and payloads"""
    return {
        "webhook_mappings": webhook_mapping,
        "webhook_payloads": webhook_payloads
    }

@router_webhooks.get("/{webhook_id}")
async def get_webhook_endpoint(webhook_id: str):
    """GET endpoint to check webhook status and last payload"""
    try:
        if webhook_id not in webhook_mapping:
            raise HTTPException(status_code=404, detail=f"Webhook ID {webhook_id} not found")
        
        mapping = webhook_mapping[webhook_id]
        workflow_id = mapping["workflow_id"]
        node_id = mapping["node_id"]
        
        # Get last payload if any
        last_payload = webhook_payloads.get(webhook_id, None)
        
        # Try to get the node's data directly from the workflow
        node_data = None
        if workflow_id in workflows_db:
            workflow = workflows_db[workflow_id]
            for node in workflow.nodes:
                if node.id == node_id:
                    node_data = node.data
                    break
        
        return {
            "webhook_id": webhook_id,
            "workflow_id": workflow_id,
            "node_id": node_id,
            "last_payload": last_payload,
            "node_data": node_data
        }
    except HTTPException as e:
        raise e
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error retrieving webhook info: {str(e)}")

@router_webhooks.post("/{webhook_id}")
async def handle_webhook_endpoint(webhook_id: str, request: Request):
    """Handle an incoming webhook"""
    try:
        # Parse the incoming JSON payload
        try:
            payload = await request.json()
        except Exception as e:
            payload = {"error": f"Failed to parse JSON payload: {str(e)}"}
        
        result = await handle_webhook(webhook_id, payload)
        return {"message": "Webhook received successfully", "payload": result["payload"]}
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error handling webhook: {str(e)}") 