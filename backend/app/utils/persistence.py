import json
import pathlib
import logging
from typing import Dict, Any, List
from datetime import datetime

from app.models.workflow import Workflow

# Set up logging
logger = logging.getLogger(__name__)

# Create data directory if it doesn't exist
DATA_DIR = pathlib.Path("data")
DATA_DIR.mkdir(exist_ok=True)

WORKFLOWS_FILE = DATA_DIR / "workflows.json"
WEBHOOKS_FILE = DATA_DIR / "webhooks.json"
WEBHOOK_PAYLOADS_FILE = DATA_DIR / "webhook_payloads.json"

# Global storage
workflows_db: Dict[str, Workflow] = {}
workflow_runs: Dict[str, List[Dict]] = {}  # workflow_id -> list of run logs
webhook_mapping: Dict[str, Dict[str, str]] = {}
webhook_payloads: Dict[str, Any] = {}

def load_data_from_disk():
    """Load data from disk on startup"""
    global workflows_db, webhook_mapping, webhook_payloads
    
    # Load workflows
    if WORKFLOWS_FILE.exists():
        try:
            workflows_json = json.loads(WORKFLOWS_FILE.read_text())
            for workflow_dict in workflows_json:
                workflow = Workflow.parse_obj(workflow_dict)
                workflows_db[workflow.id] = workflow
            logger.info(f"Loaded {len(workflows_db)} workflows from disk")
        except Exception as e:
            logger.error(f"Error loading workflows from disk: {e}")
    
    # Load webhook mappings
    if WEBHOOKS_FILE.exists():
        try:
            webhook_mapping.update(json.loads(WEBHOOKS_FILE.read_text()))
            logger.info(f"Loaded {len(webhook_mapping)} webhook mappings from disk")
        except Exception as e:
            logger.error(f"Error loading webhook mappings from disk: {e}")
    
    # Load webhook payloads
    if WEBHOOK_PAYLOADS_FILE.exists():
        try:
            webhook_payloads.update(json.loads(WEBHOOK_PAYLOADS_FILE.read_text()))
            logger.info(f"Loaded {len(webhook_payloads)} webhook payloads from disk")
        except Exception as e:
            logger.error(f"Error loading webhook payloads from disk: {e}")

def save_workflows_to_disk():
    """Save workflows to disk"""
    try:
        workflows_json = {}
        for wf_id, workflow in workflows_db.items():
            workflows_json[wf_id] = workflow.model_dump()
        
        WORKFLOWS_FILE.write_text(json.dumps(workflows_json, indent=2, default=str))
        logger.info(f"Saved {len(workflows_db)} workflows to disk")
    except Exception as e:
        logger.error(f"Error saving workflows to disk: {e}")

def save_webhooks_to_disk():
    """Save webhook mappings to disk"""
    try:
        WEBHOOKS_FILE.write_text(json.dumps(webhook_mapping, indent=2, default=str))
        logger.info(f"Saved {len(webhook_mapping)} webhook mappings to disk")
    except Exception as e:
        logger.error(f"Error saving webhook mappings to disk: {e}")

def save_webhook_payloads_to_disk():
    """Save webhook payloads to disk"""
    try:
        WEBHOOK_PAYLOADS_FILE.write_text(json.dumps(webhook_payloads, indent=2, default=str))
        logger.info(f"Saved {len(webhook_payloads)} webhook payloads to disk")
    except Exception as e:
        logger.error(f"Error saving webhook payloads to disk: {e}")

# Function to get a pretty print for logging
def get_storage_summary():
    return f"{len(workflows_db)} workflows, {len(webhook_mapping)} webhooks, and {len(webhook_payloads)} webhook payloads" 