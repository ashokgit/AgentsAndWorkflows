import logging
import uuid
import json
from datetime import datetime
from typing import Dict, Any

from app.utils.persistence import (
    webhook_mapping,
    webhook_payloads,
    workflows_db,
    save_webhooks_to_disk,
    save_webhook_payloads_to_disk,
    save_workflows_to_disk
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
    logger.info(f"Payload: {json.dumps(payload)}")
    
    if webhook_id not in webhook_mapping:
        logger.error(f"Webhook ID {webhook_id} not found in mapping")
        raise ValueError(f"Webhook ID {webhook_id} not found")
    
    # Store the payload
    webhook_payloads[webhook_id] = payload
    logger.info(f"Stored payload in webhook_payloads for ID: {webhook_id}")
    
    # Get the mapping info
    mapping = webhook_mapping[webhook_id]
    workflow_id = mapping["workflow_id"]
    node_id = mapping["node_id"]
    
    logger.info(f"Found webhook mapping - workflow_id: {workflow_id}, node_id: {node_id}")
    
    # Update the node's data in the workflow with the new payload
    node_updated = False
    if workflow_id in workflows_db:
        workflow = workflows_db[workflow_id]
        for node in workflow.nodes:
            if node.id == node_id:
                logger.info(f"Found node {node_id} in workflow {workflow_id}")
                # Log the current node data for debugging
                logger.info(f"Node data before update: {node.data}")
                
                if "last_payload" not in node.data:
                    node.data["last_payload"] = {}
                node.data["last_payload"] = payload
                node_updated = True
                
                # Log the updated node data for debugging
                logger.info(f"Node data after update: {node.data}")
                logger.info(f"Updated node {node_id} with webhook payload")
                break
        
        if not node_updated:
            logger.error(f"Node {node_id} not found in workflow {workflow_id}")
    else:
        logger.error(f"Workflow {workflow_id} not found in workflows_db")
    
    # Save both the webhook payloads and the workflow to ensure changes are persisted
    save_webhook_payloads_to_disk()
    save_workflows_to_disk()  # Also save the workflows to persist the node data update
    
    return {"webhook_id": webhook_id, "payload": payload} 