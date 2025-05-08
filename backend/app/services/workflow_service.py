import logging
import asyncio
import json
import uuid
import time
from collections import deque
from typing import Dict, List, Any, Optional

from app.models.workflow import Workflow, Node
from app.services.node_execution import execute_node
from app.utils.persistence import workflows_db, workflow_runs

# Set up logging
logger = logging.getLogger(__name__)

# Dictionary to hold asyncio Queues for active SSE streams, keyed by run_id
# Caution: In-memory storage, will be lost on restart. 
# Needs persistent queue (Redis Pub/Sub, etc.) for production.
stream_queues: Dict[str, asyncio.Queue] = {}

async def log_stream_generator(run_id: str, request):
    """Async generator for streaming log events from an existing queue."""
    logger.info(f"[SSE Connect {run_id}]: Attempting to connect stream.")
    client_ip = request.client.host if request.client else "Unknown"
    queue = stream_queues.get(run_id)

    if not queue:
        logger.warning(f"[SSE Connect {run_id}]: Queue not found for run_id. Maybe run finished or never started?")
        # Send a single message indicating the issue and close
        yield json.dumps({"step": "Error", "run_id": run_id, "status": "Failed", "error": "Log stream unavailable or run already completed.", "timestamp": time.time()})
        return

    logger.info(f"[SSE Connect {run_id}]: Client {client_ip} connected, using existing queue.")
    
    queue_removed_flag = False # Flag to prevent double removal
    try:
        while True:
            if await request.is_disconnected():
                logger.warning(f"[SSE Disconnect {run_id}]: Client {client_ip} disconnected.")
                break
            
            try:
                log_event_json = await asyncio.wait_for(queue.get(), timeout=1.0)
                logger.info(f"[SSE Generator Yield {run_id}]: Yielding: {log_event_json[:100]}...")
                yield log_event_json
                queue.task_done()
                try:
                    log_event = json.loads(log_event_json)
                    if log_event.get("step") == "__END__":
                        logger.info(f"[SSE Generator End {run_id}]: END event received, closing stream and removing queue.")
                        # Remove queue HERE after processing __END__
                        if run_id in stream_queues:
                            del stream_queues[run_id]
                            queue_removed_flag = True
                            logger.info(f"[SSE Cleanup {run_id}]: Removed queue after END event.")
                        break # Exit loop after handling __END__
                except json.JSONDecodeError: # Should not happen if we put valid JSON
                     logger.error(f"[SSE Generator Error {run_id}]: Internal error decoding JSON from queue: {log_event_json}")

            except asyncio.TimeoutError:
                continue
            
    except asyncio.CancelledError:
         logger.info(f"[SSE Cancelled {run_id}]: Stream cancelled.")
    finally:
        # Ensure cleanup if loop exited unexpectedly or client disconnected
        if not queue_removed_flag and run_id in stream_queues:
            logger.warning(f"[SSE Cleanup {run_id}]: Generator exited unexpectedly or client disconnected. Removing queue.")
            del stream_queues[run_id]
        elif queue_removed_flag:
             logger.info(f"[SSE Cleanup {run_id}]: Queue already removed by END event handler.")
        else: # Queue was never found or already removed somehow
             logger.info(f"[SSE Cleanup {run_id}]: Generator exited, queue {run_id} not found in active streams.")

async def run_workflow(workflow_id: str, input_data: Optional[Dict[str, Any]] = None):
    """Start a workflow run and return the run_id"""
    workflow = workflows_db.get(workflow_id)
    if not workflow:
        raise ValueError(f"Workflow {workflow_id} not found")

    run_id = str(uuid.uuid4())
    log_queue = asyncio.Queue() # Create the queue
    stream_queues[run_id] = log_queue # Store it immediately
    
    logger.info(f"Generated run_id: {run_id}, created log queue for workflow: {workflow_id}")

    # Start the workflow execution in the background, PASSING the queue
    asyncio.create_task(execute_workflow_logic(workflow, run_id, log_queue, input_data))

    return run_id

async def execute_workflow_logic(workflow: Workflow, run_id: str, log_queue: asyncio.Queue, input_data: Optional[Dict[str, Any]]):
    """The actual workflow execution logic, run as a background task."""
    workflow_id = workflow.id
    final_run_log = [] 

    async def log_and_store(log_entry: Dict):
        """Helper to store log locally and push JSON to the provided queue."""
        final_run_log.append(log_entry)
        try:
            log_json = json.dumps(log_entry)
            logger.info(f"[Run {run_id} Log Push]: Pushing: {log_json[:100]}...")
            await log_queue.put(log_json)
        except Exception as e:
             logger.error(f"[Run {run_id} Log Push Error]: Failed to push log to queue: {e}", exc_info=True)

    start_log = {"step": "Start", "run_id": run_id, "timestamp": time.time(), "status": "Success", "data": input_data}
    logger.info(f"[Run {run_id}]: Starting background execution.")
    await log_and_store(start_log)

    # --- Execution Logic --- 
    nodes_dict = {node.id: node for node in workflow.nodes}
    adj: Dict[str, List[str]] = {node.id: [] for node in workflow.nodes}
    target_nodes = set(edge.target for edge in workflow.edges)
    start_node_candidates = [
        node.id for node in workflow.nodes 
        if node.id not in target_nodes or node.type in ['input', 'webhook', 'trigger', 'webhook_trigger']
    ]

    if not start_node_candidates:
        error_log = {"step": "Error", "run_id": run_id, "timestamp": time.time(), "status": "Failed", "error": "Workflow has no clear starting node"}
        await log_and_store(error_log)
        # Queue cleanup is handled in finally block
        return

    start_node_id = start_node_candidates[0]
    logger.info(f"[Run {run_id}]: Identified start node: {start_node_id}")
    for edge in workflow.edges:
        if edge.source in adj: adj[edge.source].append(edge.target)
        else: logger.warning(f"[Run {run_id}]: Edge source '{edge.source}' not found. Skipping edge {edge.id}.")

    queue = deque([(start_node_id, input_data)])
    processed_nodes = set()
    max_steps = 100
    steps = 0
    execution_error = None
    aborted = False # Flag if aborted due to disconnect

    try:
        while queue and steps < max_steps:
            # Check if the queue associated with this run still exists
            # If log_stream_generator removed it (client disconnected), abort.
            if run_id not in stream_queues:
                logger.warning(f"[Run {run_id}]: SSE queue disappeared. Aborting execution.")
                aborted = True
                break 

            current_node_id, current_data = queue.popleft()

            # --- Basic cycle detection --- 
            if current_node_id in processed_nodes and current_node_id != start_node_id: 
                 logger.warning(f"[Run {run_id}]: Node {current_node_id} already processed. Skipping.")
                 continue

            if current_node_id not in nodes_dict:
                 err_detail = f"Node {current_node_id} not found."
                 logger.error(f"Run {run_id}: {err_detail}")
                 await log_and_store({"step": f"Error", "run_id": run_id, "timestamp": time.time(), "status": "Failed", "error": err_detail})
                 continue 

            node = nodes_dict[current_node_id]
            log_entry = {
                "step": f"Executing Node: {node.id} ({node.type})",
                "run_id": run_id,
                "node_id": node.id,
                "node_type": node.type,
                "timestamp": time.time(),
                "status": "Pending",
                "input_data": current_data, # Consider truncating large data
                "output_data": None,
            }
            await log_and_store(log_entry)
            logger.info(f"[Run {run_id}]: Executing node: {node.id} ({node.type})")

            try:
                # NOTE: execute_node is still synchronous. For true async, 
                # I/O bound operations within nodes (like LLM calls, webhooks)
                # should be made async.
                result = execute_node(node, current_data, workflow)
                log_entry["output_data"] = result.output # Consider truncating
                log_entry["status"] = "Success"
                log_entry["step"] = f"Finished Node: {node.id} ({node.type})" # Update step name
                processed_nodes.add(current_node_id)
                steps += 1
                await log_and_store(log_entry) # Log success after execution

                next_nodes = adj.get(current_node_id, [])
                if not next_nodes:
                    logger.info(f"[Run {run_id}]: Node {current_node_id} is a terminal node.")
                else:
                    logger.info(f"[Run {run_id}]: Node {current_node_id} leads to: {next_nodes}")
                    for next_node_id in next_nodes:
                         queue.append((next_node_id, result.output))

            except Exception as node_exc:
                logger.error(f"[Run {run_id}]: Error executing node {node.id}: {node_exc}", exc_info=False) 
                log_entry["status"] = "Failed"
                log_entry["error"] = str(node_exc)
                log_entry["step"] = f"Failed Node: {node.id} ({node.type})" # Update step name
                await log_and_store(log_entry) # Log failure
                execution_error = node_exc # Store error to signal overall failure
                break # Stop workflow execution

        # --- End of loop --- 
        if aborted:
            end_status = "Aborted (Client Disconnected)"
            error_detail = None
        elif execution_error:
             end_status = "Finished with Errors"
             error_detail = str(execution_error)
        else:
             end_status = "Success"
             error_detail = None

        end_log = {"step": "End", "run_id": run_id, "timestamp": time.time(), "status": end_status, "error": error_detail}
        await log_and_store(end_log)
        logger.info(f"[Run {run_id}]: Finished background execution. Status: {end_status}")

    except Exception as e:
        logger.error(f"[Run {run_id}]: Unexpected error during workflow execution: {e}", exc_info=True)
        if not final_run_log or final_run_log[-1].get("status") != "Failed":
            error_log = {"step": "Error", "run_id": run_id, "timestamp": time.time(), "status": "Failed", "error": f"Unexpected execution error: {e}"}
            await log_and_store(error_log)
        # Signal end even on unexpected error
        await log_queue.put(json.dumps({"step": "__END__"})) 

    finally:
        # Always store the final log
        if workflow_id not in workflow_runs:
            workflow_runs[workflow_id] = []
        max_runs_to_keep = 10 
        workflow_runs[workflow_id].insert(0, final_run_log)
        if len(workflow_runs[workflow_id]) > max_runs_to_keep:
            workflow_runs[workflow_id] = workflow_runs[workflow_id][:max_runs_to_keep]
            
        # Signal the end of the stream ONLY - DO NOT DELETE QUEUE HERE
        try:
            logger.info(f"[Run {run_id} Finally]: Sending final __END__ event to SSE queue.")
            await log_queue.put(json.dumps({"step": "__END__"}))
        except Exception as e:
             logger.error(f"[Run {run_id} Finally Error]: Failed to push __END__ event to queue: {e}")
        
        logger.info(f"[Run {run_id} Finally]: Background task finished.") # Log end of task 