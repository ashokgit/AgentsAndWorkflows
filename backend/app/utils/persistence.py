import os
import json
import logging
from typing import Dict, Any, List, Optional
from datetime import datetime

from app.models.workflow import Workflow

# Set up logging
logger = logging.getLogger(__name__)

# Custom JSON encoder to handle datetime objects
class DateTimeEncoder(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, datetime):
            return obj.isoformat()
        return super().default(obj)

# In-memory databases
workflows_db: Dict[str, Workflow] = {}  # Workflow ID -> Workflow
workflow_runs: Dict[str, List[List[Dict[str, Any]]]] = {}  # Workflow ID -> List of runs (each run is a list of log entries)

# For webhooks
webhook_registry: Dict[str, Dict[str, str]] = {}  # Path -> {workflow_id, node_id}
webhook_payloads: Dict[str, List[Dict[str, Any]]] = {}  # Path -> List of payloads

# For backwards compatibility with older code
webhook_mapping: Dict[str, Dict[str, str]] = {}  # Legacy webhook mapping

# File paths
data_dir = os.environ.get("DATA_DIR", "./data")
workflows_file = os.path.join(data_dir, "workflows.json")
runs_file = os.path.join(data_dir, "runs.json")
webhook_registry_file = os.path.join(data_dir, "webhook_registry.json")
webhook_payloads_file = os.path.join(data_dir, "webhook_payloads.json")

# Create runs directory for individual run logs
runs_dir = os.path.join(data_dir, "runs")

# Ensure directories exist
os.makedirs(data_dir, exist_ok=True)
os.makedirs(runs_dir, exist_ok=True)

def load_workflows_from_disk():
    """Load all workflows from disk"""
    global workflows_db, workflow_runs, webhook_registry, webhook_payloads, webhook_mapping
    
    try:
        # Load workflows
        if os.path.exists(workflows_file):
            with open(workflows_file, 'r') as f:
                serialized_workflows = json.load(f)
                # Convert dicts back to Workflow objects
                for k, v in serialized_workflows.items():
                    workflows_db[k] = Workflow.parse_obj(v)
            logger.info(f"Loaded {len(workflows_db)} workflows from {workflows_file}")
        
        # Load runs data
        if os.path.exists(runs_file):
            with open(runs_file, 'r') as f:
                workflow_runs = json.load(f)
            logger.info(f"Loaded run logs from {runs_file}")
            
            # Also load any archived individual run logs
            for workflow_id in workflow_runs:
                workflow_run_dir = os.path.join(runs_dir, workflow_id)
                if os.path.exists(workflow_run_dir):
                    run_files = os.listdir(workflow_run_dir)
                    logger.info(f"Found {len(run_files)} archived run logs for workflow {workflow_id}")
        
        # Load webhook registry
        if os.path.exists(webhook_registry_file):
            with open(webhook_registry_file, 'r') as f:
                webhook_registry = json.load(f)
            logger.info(f"Loaded webhook registry from {webhook_registry_file}")
            
            # For backwards compatibility
            webhook_mapping = webhook_registry.copy()
        
        # Load webhook payloads
        if os.path.exists(webhook_payloads_file):
            with open(webhook_payloads_file, 'r') as f:
                webhook_payloads = json.load(f)
            logger.info(f"Loaded webhook payloads from {webhook_payloads_file}")
        
    except Exception as e:
        logger.error(f"Error loading data from disk: {e}", exc_info=True)

def save_workflows_to_disk():
    """Save all workflows to disk using a safer temp file approach"""
    files_to_save = [
        (workflows_file, {k: v.dict() for k, v in workflows_db.items()}),
        (runs_file, workflow_runs),
        (webhook_registry_file, webhook_registry),
        (webhook_payloads_file, webhook_payloads)
    ]

    for file_path, data_content in files_to_save:
        temp_file_path = file_path + ".tmp"
        try:
            with open(temp_file_path, 'w') as f:
                json.dump(data_content, f, indent=2, cls=DateTimeEncoder)
            
            # If dump was successful, replace the old file
            os.replace(temp_file_path, file_path) # os.replace is atomic on most OS
            
            # Inferring a logger message based on typical usage
            if file_path == workflows_file:
                 logger.info(f"Saved {len(data_content)} workflows to {file_path}")
            elif file_path == runs_file:
                 logger.info(f"Saved run logs to {file_path}")
            elif file_path == webhook_registry_file:
                 logger.info(f"Saved webhook registry to {file_path}")
            elif file_path == webhook_payloads_file:
                 logger.info(f"Saved webhook payloads to {file_path}")

        except Exception as e:
            logger.error(f"Error saving data to {file_path}: {e}", exc_info=True)
            if os.path.exists(temp_file_path):
                try:
                    os.remove(temp_file_path)
                    logger.info(f"Removed temporary file {temp_file_path} after error.")
                except Exception as e_remove:
                    logger.error(f"Error removing temporary save file {temp_file_path}: {e_remove}")
            # Decide if you want to re-raise or just log the error for this specific file
            # For now, it logs and continues to try saving other files.

def save_webhooks_to_disk():
    """Save webhook registry to disk using a safer temp file approach."""
    # This is a subset of what save_workflows_to_disk now handles,
    # but if it's called directly, it should also be safe.
    temp_file_path = webhook_registry_file + ".tmp"
    try:
        with open(temp_file_path, 'w') as f:
            json.dump(webhook_registry, f, indent=2, cls=DateTimeEncoder)
        os.replace(temp_file_path, webhook_registry_file)
        logger.info(f"Saved webhook registry to {webhook_registry_file}")
    except Exception as e:
        logger.error(f"Error saving webhook registry to {webhook_registry_file}: {e}", exc_info=True)
        if os.path.exists(temp_file_path):
            try:
                os.remove(temp_file_path)
            except Exception as e_remove:
                logger.error(f"Error removing temporary webhook registry file {temp_file_path}: {e_remove}")

def save_webhook_payloads_to_disk():
    """Save webhook payloads to disk using a safer temp file approach"""
    temp_file_path = webhook_payloads_file + ".tmp"
    try:
        with open(temp_file_path, 'w') as f:
            json.dump(webhook_payloads, f, indent=2, cls=DateTimeEncoder)
        os.replace(temp_file_path, webhook_payloads_file)
        logger.info(f"Saved {len(webhook_payloads)} webhook payloads to disk")
    except Exception as e:
        logger.error(f"Error saving webhook payloads to disk: {e}")
        if os.path.exists(temp_file_path):
            try:
                os.remove(temp_file_path)
            except Exception as e_remove:
                logger.error(f"Error removing temporary webhook payloads file {temp_file_path}: {e_remove}")

def save_individual_run_log(workflow_id: str, run_id: str, run_log: List[Dict[str, Any]]):
    """Save an individual run log to its own file for better archiving"""
    if not run_log:
        logger.warning(f"Empty run log for {workflow_id}/{run_id}, not saving individually")
        return
        
    # Ensure the workflow's run directory exists
    workflow_run_dir = os.path.join(runs_dir, workflow_id)
    os.makedirs(workflow_run_dir, exist_ok=True)
    
    # Prepare run metadata
    start_time = run_log[0].get('timestamp', datetime.now().timestamp()) if run_log else datetime.now().timestamp()
    end_time = run_log[-1].get('timestamp', datetime.now().timestamp()) if run_log else datetime.now().timestamp()
    
    # Extract status from last log entry
    final_status = run_log[-1].get('status', 'Unknown') if run_log else 'Unknown'
    is_test = run_log[0].get('is_test_log', False) if run_log else False
    
    # Create a run metadata object
    run_metadata = {
        'run_id': run_id,
        'workflow_id': workflow_id,
        'start_time': start_time,
        'end_time': end_time,
        'duration': end_time - start_time,
        'status': final_status,
        'is_test': is_test,
        'log_count': len(run_log),
        'archived_at': datetime.now().timestamp()
    }
    
    # Combine metadata with log for the individual file
    full_run_data = {
        'metadata': run_metadata,
        'logs': run_log
    }
    
    # Use ISO timestamp in filename for better sorting
    start_date = datetime.fromtimestamp(start_time).strftime('%Y%m%d_%H%M%S')
    run_file = os.path.join(workflow_run_dir, f"{start_date}_{run_id}.json")
    
    temp_file_path = run_file + ".tmp"
    try:
        with open(temp_file_path, 'w') as f:
            json.dump(full_run_data, f, indent=2, cls=DateTimeEncoder)
        os.replace(temp_file_path, run_file)
        logger.info(f"Saved individual run log for {workflow_id}/{run_id} to {run_file}")
        return True
    except Exception as e:
        logger.error(f"Error saving individual run log for {workflow_id}/{run_id}: {e}", exc_info=True)
        if os.path.exists(temp_file_path):
            try:
                os.remove(temp_file_path)
            except Exception as e_remove:
                logger.error(f"Error removing temporary run log file {temp_file_path}: {e_remove}")
        return False

def get_run_logs(workflow_id: str, limit: int = 50, include_archived: bool = True):
    """Get run logs for a workflow with pagination
    
    Args:
        workflow_id: The workflow ID
        limit: Maximum number of logs to return
        include_archived: Whether to include archived logs from disk
    
    Returns:
        List of run logs with metadata
    """
    # Get in-memory logs
    active_logs = workflow_runs.get(workflow_id, [])
    
    if not include_archived:
        return active_logs[:limit]
    
    # Check for archived logs
    workflow_run_dir = os.path.join(runs_dir, workflow_id)
    archived_logs = []
    
    if os.path.exists(workflow_run_dir):
        run_files = sorted(os.listdir(workflow_run_dir), reverse=True)  # Most recent first
        
        # Load archived logs up to the limit
        remaining_limit = limit - len(active_logs)
        if remaining_limit > 0:
            for run_file in run_files[:remaining_limit]:
                try:
                    with open(os.path.join(workflow_run_dir, run_file), 'r') as f:
                        run_data = json.load(f)
                        if 'logs' in run_data:
                            archived_logs.append(run_data['logs'])
                except Exception as e:
                    logger.error(f"Error loading archived run log {run_file}: {e}")
    
    # Combine active and archived logs
    return active_logs + archived_logs[:limit - len(active_logs)]

# Function to get a pretty print for logging
def get_storage_summary():
    return f"{len(workflows_db)} workflows, {len(webhook_registry)} webhooks, and {len(webhook_payloads)} webhook payloads"

# Load data on module import
load_workflows_from_disk() 