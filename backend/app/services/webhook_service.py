import logging
import uuid
import time
from typing import Dict, Any, Optional

from app.utils.persistence import webhook_payloads, webhook_mapping, save_webhooks_to_disk, save_webhook_payloads_to_disk
from app.services.workflow_service import run_workflow

logger = logging.getLogger(__name__)

async def register_webhook(workflow_id: str, node_id: str) -> str:
    """Register a webhook for a workflow node"""
    webhook_id = str(uuid.uuid4())
    
    # Store the mapping
    webhook_mapping[webhook_id] = {
        "workflow_id": workflow_id,
        "node_id": node_id,
        "created_at": time.time()
    }
    
    # Initialize the payload store for this webhook ID
    webhook_payloads[webhook_id] = []
    
    # Save to disk
    save_webhooks_to_disk()
    
    logger.info(f"Registered webhook {webhook_id} for workflow {workflow_id}, node {node_id}")
    return webhook_id

async def handle_webhook(webhook_id: str, payload: Any) -> Dict[str, Any]:
    """Process incoming webhook data"""
    if webhook_id not in webhook_mapping:
        raise ValueError(f"Webhook ID {webhook_id} not found")
    
    # Get the mapping information
    mapping = webhook_mapping[webhook_id]
    workflow_id = mapping["workflow_id"]
    node_id = mapping["node_id"]
    
    # Store the payload
    if webhook_id not in webhook_payloads:
        webhook_payloads[webhook_id] = []
    
    # Add metadata to payload
    payload_with_meta = {
        "received_at": time.time(),
        "payload": payload
    }
    
    # Add to payloads (cap to the last 10 payloads)
    max_stored_payloads = 10
    if len(webhook_payloads[webhook_id]) >= max_stored_payloads:
        webhook_payloads[webhook_id].pop(0)  # Remove the oldest
    
    webhook_payloads[webhook_id].append(payload_with_meta)
    
    # Save to disk
    save_webhook_payloads_to_disk()
    
    # Optionally, trigger the workflow
    # This can be enhanced to check if the workflow should be triggered automatically
    # For now, we'll just store the payload
    logger.info(f"Received webhook {webhook_id} for workflow {workflow_id}, node {node_id}")
    
    return {
        "webhook_id": webhook_id,
        "workflow_id": workflow_id,
        "node_id": node_id,
        "payload": payload_with_meta
    } 