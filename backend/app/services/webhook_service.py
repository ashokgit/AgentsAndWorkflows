import logging
import uuid
from datetime import datetime
from typing import Dict, Any

from app.utils.persistence import (
    webhook_mapping,
    webhook_payloads,
    workflows_db,
    save_webhooks_to_disk,
    save_webhook_payloads_to_disk
)

# Set up logging
logger = logging.getLogger(__name__)

async def register_webhook(workflow_id: str, node_id: str) -> str:
    """Register a webhook and generate a unique ID for it"""
    webhook_id = str(uuid.uuid4())
    webhook_mapping[webhook_id] = {
        "workflow_id": workflow_id,
        "node_id": node_id,
        "created_at": datetime.now().isoformat()
    }
    logger.info(f"Registered webhook {webhook_id} for workflow {workflow_id}, node {node_id}")
    save_webhooks_to_disk()
    return webhook_id

async def handle_webhook(webhook_id: str, payload: Any) -> Dict[str, Any]:
    """Handle an incoming webhook"""
    logger.info(f"Webhook received for ID: {webhook_id}")
    
    if webhook_id not in webhook_mapping:
        raise ValueError(f"Webhook ID {webhook_id} not found")
    
    # Store the payload
    webhook_payloads[webhook_id] = payload
    
    # Get the mapping info
    mapping = webhook_mapping[webhook_id]
    workflow_id = mapping["workflow_id"]
    node_id = mapping["node_id"]
    
    # Update the node's data in the workflow with the new payload
    if workflow_id in workflows_db:
        workflow = workflows_db[workflow_id]
        for node in workflow.nodes:
            if node.id == node_id:
                if "last_payload" not in node.data:
                    node.data["last_payload"] = {}
                node.data["last_payload"] = payload
                logger.info(f"Updated node {node_id} with webhook payload")
                break
    
    save_webhook_payloads_to_disk()
    return {"webhook_id": webhook_id, "payload": payload} 