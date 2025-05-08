from fastapi import APIRouter, HTTPException, Request
from typing import Dict, Any

from app.models.workflow import WebhookRegistration
from app.services.webhook_service import register_webhook, handle_webhook

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