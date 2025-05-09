import logging
import asyncio
import json
import uuid
import time
import traceback
from collections import deque
from typing import Dict, List, Any, Optional
from datetime import datetime

from app.models.workflow import Workflow, Node
from app.services.node_execution import execute_node
from app.utils.persistence import workflows_db, workflow_runs, save_workflows_to_disk

# Set up logging
logger = logging.getLogger(__name__)

# Dictionary to hold asyncio Queues for active SSE streams, keyed by run_id
# Caution: In-memory storage, will be lost on restart. 
# Needs persistent queue (Redis Pub/Sub, etc.) for production.
stream_queues: Dict[str, asyncio.Queue] = {}

# Helper function to ensure consistent webhook path formatting
def format_webhook_path(workflow_id: str, node_id: str) -> str:
    """Create a consistent webhook path format used by both registering and receiving webhooks."""
    return f"/api/webhooks/wh_{workflow_id}_{node_id}"

# Structures for handling webhook data during tests
# webhook_test_events: {run_id: {node_id: asyncio.Event}}
webhook_test_events: Dict[str, Dict[str, asyncio.Event]] = {}
# webhook_test_data: {run_id: {node_id: received_data}}
webhook_test_data: Dict[str, Dict[str, Any]] = {}
# active_webhooks_expecting_test_data: {unique_webhook_path_or_identifier: run_id}
# This helps the generic webhook callback identify which test run to signal.
# The key could be f"/api/webhooks/wh_{workflow_id}_{node_id}" (the actual path)
active_webhooks_expecting_test_data: Dict[str, str] = {}

async def log_stream_generator(run_id: str, request):
    """Async generator for streaming log events from an existing queue."""
    logger.info(f"[SSE Connect {run_id}]: Attempting to connect stream.")
    client_ip = request.client.host if request.client else "Unknown"
    queue = stream_queues.get(run_id)

    if not queue:
        logger.warning(f"[SSE Connect {run_id}]: Queue not found for run_id. Maybe run finished or never started?")
        yield json.dumps({
            "step": "Error", 
            "run_id": run_id, 
            "status": "Failed", 
            "error": "Log stream unavailable or run already completed.", 
            "timestamp": time.time(),
            "is_test_log": True # Assume it could be a test if queue is missing early
        })
        return

    logger.info(f"[SSE Connect {run_id}]: Client {client_ip} connected, using existing queue.")
    
    queue_removed_flag = False
    try:
        while True:
            if await request.is_disconnected():
                logger.warning(f"[SSE Disconnect {run_id}]: Client {client_ip} disconnected.")
                break
            
            try:
                log_event_json = await asyncio.wait_for(queue.get(), timeout=1.0)
                logger.debug(f"[SSE Generator Yield {run_id}]: Yielding: {log_event_json[:150]}...")
                yield log_event_json
                queue.task_done()
                try:
                    log_event = json.loads(log_event_json)
                    if log_event.get("step") == "__END__":
                        logger.info(f"[SSE Generator End {run_id}]: END event received, closing stream.")
                        if run_id in stream_queues:
                            # Don't delete queue immediately, let it drain any final messages
                            # The execute_workflow_logic's finally block will handle actual queue cleanup if necessary
                            # but it's usually the generator's responsibility when __END__ is received.
                            # For safety, let's ensure it's removed if the task is done with it.
                            # await queue.join() # Ensure all items are processed, might be too blocking
                            del stream_queues[run_id]
                            queue_removed_flag = True
                            logger.info(f"[SSE Cleanup {run_id}]: Removed queue after END event.")
                        break
                except json.JSONDecodeError:
                     logger.error(f"[SSE Generator Error {run_id}]: Internal error decoding JSON from queue: {log_event_json}")

            except asyncio.TimeoutError:
                # This is normal, just means no new logs for 1s, continue to check disconnect or get next item
                continue
            
    except asyncio.CancelledError:
         logger.info(f"[SSE Cancelled {run_id}]: Stream cancelled for client {client_ip}.")
    finally:
        if not queue_removed_flag and run_id in stream_queues:
            logger.warning(f"[SSE Cleanup {run_id}]: Generator for {client_ip} exited (e.g. disconnect/error). Removing its queue reference.")
            del stream_queues[run_id]
        elif queue_removed_flag:
             logger.info(f"[SSE Cleanup {run_id}]: Queue was confirmed removed by END event handler.")
        else:
             logger.info(f"[SSE Cleanup {run_id}]: Generator exited, queue for {run_id} was not found or already removed.")

async def run_workflow(workflow_id: str, input_data: Optional[Dict[str, Any]] = None, is_test_run: bool = False):
    """Start a workflow run (normal or test) and return the run_id"""
    try:
        workflow = workflows_db.get(workflow_id)
        if not workflow:
            raise ValueError(f"Workflow {workflow_id} not found")

        run_id = str(uuid.uuid4())
        log_queue = asyncio.Queue()
        stream_queues[run_id] = log_queue
        
        log_type = "test" if is_test_run else "normal"
        logger.info(f"Generated {log_type} run_id: {run_id}, created log queue for workflow: {workflow_id}")

        # Create the background task to execute the workflow
        try:
            task = asyncio.create_task(execute_workflow_logic(workflow, run_id, log_queue, input_data, is_test_run))
            # Add callback to handle any exceptions
            def handle_task_exception(task):
                try:
                    exc = task.exception()
                    if exc:
                        logger.error(f"Background task for {log_type} run {run_id} failed with error: {exc}")
                        logger.error(traceback.format_exc())
                except asyncio.CancelledError:
                    logger.warning(f"Background task for {log_type} run {run_id} was cancelled")
                except Exception as e:
                    logger.error(f"Error handling task exception for {log_type} run {run_id}: {e}")
            
            task.add_done_callback(handle_task_exception)
            
            if is_test_run:
                return {"run_id": run_id, "workflow_id": workflow_id}
            else:
                return run_id
        except Exception as e:
            logger.error(f"Failed to create background task for {log_type} run {run_id}: {e}")
            logger.error(traceback.format_exc())
            if run_id in stream_queues:
                del stream_queues[run_id]
            raise
    except Exception as e:
        logger.error(f"Error in run_workflow (is_test_run={is_test_run}): {e}")
        logger.error(traceback.format_exc())
        raise

async def test_workflow(workflow_id: str, input_data: Optional[Dict[str, Any]] = None):
    """Dedicated function to initiate a test workflow. Returns run_id for log streaming."""
    try:
        logger.info(f"Starting test workflow for workflow_id: {workflow_id}")
        result = await run_workflow(workflow_id, input_data, is_test_run=True)
        logger.info(f"Test workflow initiated successfully, run_id: {result.get('run_id')}")
        return result
    except Exception as e:
        logger.error(f"Error in test_workflow for workflow_id {workflow_id}: {e}")
        logger.error(traceback.format_exc())
        raise

async def set_workflow_tested_status(workflow_id: str, success: bool):
    """Mark a workflow as tested and update its last_tested timestamp."""
    workflow = workflows_db.get(workflow_id)
    if not workflow:
        logger.error(f"Cannot mark workflow {workflow_id} as tested - not found")
        return
    
    workflow.tested = success
    workflow.last_tested = datetime.now() # Always update last_tested time
    if not success:
        workflow.is_active = False # Ensure workflow is not active if test fails
        
    workflows_db[workflow_id] = workflow
    save_workflows_to_disk()
    logger.info(f"Workflow {workflow_id} test status updated: {'Success' if success else 'Failed'}. Tested: {workflow.tested}, Last Tested: {workflow.last_tested.isoformat() if workflow.last_tested else 'N/A'}")

async def signal_webhook_data_for_test(webhook_path: str, node_id: str, data: Any):
    """Signal that a webhook (identified by its unique path) has received data during a test run."""
    logger.info(f"[TestSignal] Attempting to signal for webhook_path={webhook_path}, node_id={node_id}")
    logger.info(f"[TestSignal] Active webhooks expecting data: {list(active_webhooks_expecting_test_data.keys())}")
    
    run_id = active_webhooks_expecting_test_data.get(webhook_path)
    if not run_id:
        logger.warning(f"[TestSignal {webhook_path}]: No active test run found waiting on this webhook path.")
        return False

    # Try to handle parsing mismatches by attempting multiple node ID formats
    found_node_id = None
    if run_id in webhook_test_events:
        # First try the exact node_id provided
        if node_id in webhook_test_events[run_id]:
            found_node_id = node_id
        else:
            # Try to match ignoring underscores
            node_id_without_underscores = node_id.replace("_", "")
            for test_node_id in webhook_test_events[run_id].keys():
                test_node_id_without_underscores = test_node_id.replace("_", "")
                if node_id_without_underscores == test_node_id_without_underscores:
                    found_node_id = test_node_id
                    logger.info(f"[TestSignal] Found matching node_id={test_node_id} for provided={node_id}")
                    break
                # Handle cases where digits are at the end (e.g., dndnode_4 vs 4)
                elif node_id.isdigit() and test_node_id.endswith(f"_{node_id}"):
                    found_node_id = test_node_id
                    logger.info(f"[TestSignal] Found node_id={test_node_id} matching digit-only suffix={node_id}")
                    break
                    
    if not found_node_id:
        logger.warning(f"[TestSignal {run_id}-{node_id}]: No waiting test event found for this node_id in this run.")
        logger.info(f"[TestSignal] Available node_ids for run {run_id}: {list(webhook_test_events.get(run_id, {}).keys())}")
        return False
    
    webhook_test_data.setdefault(run_id, {})[found_node_id] = data
    event = webhook_test_events[run_id][found_node_id]
    event.set() # Signal the waiting execute_workflow_logic task
    logger.info(f"[TestSignal {run_id}-{found_node_id}]: Signaled webhook data received for path {webhook_path}.")
    
    # Important: Remove from active_webhooks_expecting_test_data once signaled to prevent re-triggering for the same test wait
    if webhook_path in active_webhooks_expecting_test_data:
        del active_webhooks_expecting_test_data[webhook_path]
        logger.info(f"[TestSignal {run_id}-{found_node_id}]: Removed {webhook_path} from active test waiters.")
    return True

async def execute_workflow_logic(workflow: Workflow, run_id: str, log_queue: asyncio.Queue, 
                                input_data: Optional[Dict[str, Any]], is_test: bool):
    """The actual workflow execution logic, run as a background task."""
    workflow_id = workflow.id
    final_run_log = [] 
    overall_success = True # Assume success until a failure occurs
    execution_error_occurred = False # Tracks if any node execution failed critically

    # --- Context for the current run --- 
    node_outputs_for_current_run: Dict[str, Any] = {}

    # --- Make a copy of nodes if it's a test run to avoid modifying the original --- 
    # This also allows for test-specific modifications, like clearing last_payload
    current_workflow_nodes = workflow.nodes
    if is_test:
        # Deep copy nodes for modification during test run
        copied_nodes = []
        for node_def in workflow.nodes:
            copied_node_data = json.loads(json.dumps(node_def.data)) # Simple deepish copy for dict data
            if node_def.type == 'webhook_trigger' and 'last_payload' in copied_node_data:
                logger.info(f"[TestRun {run_id}]: Clearing last_payload for webhook node {node_def.id}")
                copied_node_data['last_payload'] = None # Or an empty dict {}
            
            copied_node = Node(
                id=node_def.id,
                type=node_def.type,
                position=node_def.position,
                data=copied_node_data
            )
            copied_nodes.append(copied_node)
        current_workflow_nodes = copied_nodes
        # Update workflow object for this run to use the copied nodes
        # This is a bit hacky; ideally, the workflow object passed around would be a run-specific instance
        # For now, we modify it in-place for the scope of this run, assuming it's not persisted back directly.
        # A better approach might be to pass current_workflow_nodes explicitly to execute_node if it needs to look up other nodes.
        # However, execute_node already receives the whole workflow object.
        # The most important part is that node.data within the loop references the copied data.

    # Initialize test-specific structures if it's a test run
    if is_test:
        webhook_test_events[run_id] = {}
        webhook_test_data[run_id] = {}

    async def log_and_store(log_entry_data: Dict):
        """Helper to store log locally, add test flag, and push JSON to the queue."""
        # Ensure all log entries from this function know if they are part of a test
        log_entry_data['is_test_log'] = is_test 
        log_entry_data['timestamp'] = time.time() # Ensure consistent timestamping
        log_entry_data['run_id'] = run_id # Ensure run_id is always present

        final_run_log.append(log_entry_data)
        try:
            log_json = json.dumps(log_entry_data)
            logger.debug(f"[Run {run_id} Log Push {'[TEST]' if is_test else ''}]: Pushing: {log_json[:150]}...")
            await log_queue.put(log_json)
        except Exception as e:
             logger.error(f"[Run {run_id} Log Push Error]: Failed to push log to queue: {e}", exc_info=True)

    start_log_message = "Starting Test Workflow Execution" if is_test else "Starting Workflow Execution"
    await log_and_store({"step": start_log_message, "status": "Pending", "data_summary": str(input_data)[:100]})
    logger.info(f"[Run {run_id} {'[TEST]' if is_test else ''}]: {start_log_message}")

    nodes_dict = {node.id: node for node in current_workflow_nodes} # Use current_workflow_nodes
    adj: Dict[str, List[str]] = {node.id: [] for node in current_workflow_nodes if node.type != 'model_config'}
    
    # Build adjacency list, excluding edges from/to model_config for main flow
    for edge in workflow.edges:
        source_node = nodes_dict.get(edge.source) # Use nodes_dict which is from current_workflow_nodes
        target_node = nodes_dict.get(edge.target)
        
        # Regular operational edge
        if source_node and target_node and source_node.type != 'model_config' and target_node.type != 'model_config':
            if edge.source in adj: adj[edge.source].append(edge.target)
            # else: logger.warning(f"[Run {run_id}]: Source node {edge.source} not in adj list (might be model_config or error)")
        # elif source_node and source_node.type == 'model_config':
            # logger.debug(f"[Run {run_id}]: Skipping edge from model_config {edge.source} for main flow graph.")
        # elif target_node and target_node.type == 'model_config':
            # logger.debug(f"[Run {run_id}]: Skipping edge to model_config {edge.target} for main flow graph.")

    # Identify start nodes (not model_config, and either no incoming edges or specific trigger types)
    all_target_ids_in_operational_graph = set()
    for source_id in adj: 
        for target_id in adj[source_id]:
            all_target_ids_in_operational_graph.add(target_id)

    start_node_candidates = [
        node.id for node in current_workflow_nodes 
        if node.type != 'model_config' and 
           (node.id not in all_target_ids_in_operational_graph or 
            node.type in ['input', 'webhook_trigger', 'trigger']) # Ensure trigger types can be start nodes even if targeted by other triggers (less common)
    ]

    if not start_node_candidates:
        err_msg = "Workflow has no clear starting node (excluding Model Configuration nodes)."
        await log_and_store({"step": "Initialization Error", "status": "Failed", "error": err_msg})
        overall_success = False
    else:
        start_node_id = start_node_candidates[0] # Taking the first candidate for now
        logger.info(f"[Run {run_id} {'[TEST]' if is_test else ''}]: Identified start node: {start_node_id}")
        
        exec_queue = deque([(start_node_id, input_data)])
        processed_nodes = set() # For cycle detection in main flow
        max_steps = 100 # Safety break
        steps = 0
        aborted_by_client = False

        try:
            while exec_queue and steps < max_steps and not execution_error_occurred:
                if run_id not in stream_queues:
                    logger.warning(f"[Run {run_id}]: SSE queue disappeared. Aborting execution.")
                    aborted_by_client = True; overall_success = False; break

                current_node_id, current_data = exec_queue.popleft()

                if current_node_id in processed_nodes and current_node_id != start_node_id:
                    logger.warning(f"[Run {run_id}]: Node {current_node_id} (operational) already processed. Cycle detected or duplicate path. Skipping.")
                    continue
                
                node = nodes_dict.get(current_node_id)
                if not node or node.type == 'model_config': # Should not happen if graph building is correct
                    logger.error(f"[Run {run_id}]: Invalid node {current_node_id} in execution queue or is model_config.")
                    await log_and_store({"step": f"Execution Error", "node_id": current_node_id, "status": "Failed", "error": "Invalid node in queue"})
                    overall_success = False; execution_error_occurred = True; break

                node_label = node.data.get('webhook_name', node.data.get('node_name', node.data.get('label', node.id)))
                # Ensure we are using the potentially modified node from current_workflow_nodes for its data
                current_node_definition = nodes_dict[current_node_id]

                await log_and_store({
                    "step": f"Executing Node: {node_label} ({current_node_definition.type})",
                    "node_id": current_node_definition.id, "node_type": current_node_definition.type, "status": "Pending", 
                    "input_data_summary": str(current_data)[:100] + ('...' if len(str(current_data)) > 100 else '')
                })
                logger.info(f"[Run {run_id} {'[TEST]' if is_test else ''}]: Executing node: {current_node_definition.id} ({node_label} - {current_node_definition.type})")

                node_status = "Pending"
                node_output = None
                node_error_detail = None

                try:
                    if is_test and current_node_definition.type in ['webhook_trigger', 'webhook']:
                        # Use helper to ensure consistent path format
                        webhook_node_path_key = format_webhook_path(workflow_id, current_node_definition.id)
                        logger.info(f"[TestRun {run_id}] Registering webhook wait path: {webhook_node_path_key}")
                        webhook_event = asyncio.Event()
                        webhook_test_events.setdefault(run_id, {})[current_node_definition.id] = webhook_event
                        active_webhooks_expecting_test_data[webhook_node_path_key] = run_id
                        
                        await log_and_store({
                            "step": f"Test: Waiting for Webhook: {node_label} ({current_node_definition.type})",
                            "node_id": current_node_definition.id, "status": "Waiting",
                            "message": f"Send data to webhook path {webhook_node_path_key} for node {current_node_definition.id} to continue."
                        })
                        logger.info(f"[TestRun {run_id}]: Node {current_node_definition.id} ({node_label}) waiting for data at {webhook_node_path_key}.")
                        
                        webhook_timeout = 300 # 5 minutes for manual testing
                        try:
                            await asyncio.wait_for(webhook_event.wait(), timeout=webhook_timeout)
                            current_data = webhook_test_data.get(run_id, {}).get(current_node_definition.id, current_data) # Use received data
                            await log_and_store({"step": f"Test: Webhook Triggered: {node_label}", "node_id": current_node_definition.id, "status": "Triggered"})
                            logger.info(f"[TestRun {run_id}]: Webhook {current_node_definition.id} ({node_label}) received data.")
                            node_status = "Success" # Mark webhook trigger as successful for this step in test
                            
                            # Update the node's data with the test payload to reflect successful test
                            current_node_definition.data['last_payload'] = current_data
                            current_node_definition.data['dataLoaded'] = True
                            logger.info(f"[TestRun {run_id}]: Updated webhook node {current_node_definition.id} with test data and set dataLoaded flag")
                        except asyncio.TimeoutError:
                            logger.warning(f"[TestRun {run_id}]: Timeout waiting for webhook {current_node_definition.id}")
                            node_status = "Failed"; node_error_detail = f"Test timed out after {webhook_timeout}s waiting for webhook data."
                            overall_success = False; execution_error_occurred = True # This is a test failure
                            # No more processing for this node if webhook times out in test
                            await log_and_store({"step": f"Test: Webhook Timeout for {node_label}", "node_id": current_node_definition.id, "status": "Failed", "error": node_error_detail})
                            break # Stop the entire workflow test on webhook timeout
                        finally:
                            if webhook_node_path_key in active_webhooks_expecting_test_data: del active_webhooks_expecting_test_data[webhook_node_path_key]
                            if run_id in webhook_test_events and current_node_definition.id in webhook_test_events[run_id]: del webhook_test_events[run_id][current_node_definition.id]
                            if run_id in webhook_test_data and current_node_definition.id in webhook_test_data[run_id]: del webhook_test_data[run_id][current_node_definition.id]
                    
                    # If not a webhook timeout in test, proceed to execute
                    if not execution_error_occurred:
                        # Pass the full workflow object, as execute_node might need to access model_config nodes
                        # And pass the accumulated run_outputs for templating context
                        result = execute_node(current_node_definition, current_data, workflow, node_outputs_for_current_run) 
                        node_output = result.output
                        node_outputs_for_current_run[current_node_definition.id] = node_output # Store output for templating
                        node_status = "Success"
                        processed_nodes.add(current_node_id)
                        steps += 1

                        next_operational_nodes = adj.get(current_node_id, [])
                        if not next_operational_nodes:
                            logger.info(f"[Run {run_id}]: Node {current_node_id} is a terminal operational node.")
                        else:
                            for next_node_id_in_flow in next_operational_nodes:
                                if nodes_dict[next_node_id_in_flow].type != 'model_config': # Should be guaranteed by adj list build
                                    exec_queue.append((next_node_id_in_flow, node_output))
                
                except Exception as node_exc:
                    logger.error(f"[Run {run_id}]: Error executing node {current_node_definition.id}: {node_exc}", exc_info=True)
                    node_status = "Failed"; node_error_detail = str(node_exc)
                    overall_success = False; execution_error_occurred = True
                
                await log_and_store({
                    "step": f"Finished Node: {node_label} ({current_node_definition.type})",
                    "node_id": current_node_definition.id, "node_type": current_node_definition.type, "status": node_status, 
                    "output_data_summary": str(node_output)[:100] + ('...' if len(str(node_output)) > 100 else ''),
                    "error": node_error_detail
                })

        except Exception as e_outer:
            logger.error(f"[Run {run_id}]: Unexpected error during main workflow execution loop: {e_outer}", exc_info=True)
            await log_and_store({"step": "Critical Execution Error", "status": "Failed", "error": str(e_outer)})
            overall_success = False; execution_error_occurred = True
        
        # --- End of loop --- 
        final_status_message = "Workflow Execution Ended"
        final_log_status = "Unknown"
        final_error_detail = None

        if aborted_by_client:
            final_log_status = "Aborted (Client Disconnected)"
        elif execution_error_occurred:
            final_log_status = "Finished with Errors"
            # Error already logged by the node that failed, or critical error logged above
        elif not overall_success: # Should be covered by execution_error_occurred
            final_log_status = "Failed (Generic)"
            final_error_detail = "Workflow did not complete successfully."
        else:
            final_log_status = "Success"
            final_status_message = "Workflow Execution Successful" if not is_test else "Workflow Test Successful"
        
        logger.info(f"[Run {run_id} {'[TEST]' if is_test else ''}]: {final_status_message}. Overall Success: {overall_success}, Status: {final_log_status}")
        await log_and_store({"step": final_status_message, "status": final_log_status, "error": final_error_detail})

    # If this was a test run, update the workflow's tested status based on overall_success
    if is_test:
        await set_workflow_tested_status(workflow_id, overall_success)
        
        # If test was successful, update the original workflow's webhook nodes with test data
        if overall_success:
            # Get the original workflow again to update it
            original_workflow = workflows_db.get(workflow_id)
            if original_workflow:
                # Find webhook nodes that were updated during test
                for node in current_workflow_nodes:
                    if node.type == 'webhook_trigger' and node.data.get('dataLoaded') and node.data.get('last_payload'):
                        # Find corresponding node in original workflow
                        for orig_node in original_workflow.nodes:
                            if orig_node.id == node.id:
                                logger.info(f"[TestRun {run_id}]: Persisting webhook data from test to original workflow for node {node.id}")
                                orig_node.data['last_payload'] = node.data['last_payload']
                                orig_node.data['dataLoaded'] = True
                                break
                # Save the updated workflow
                workflows_db[workflow_id] = original_workflow
                save_workflows_to_disk()
                logger.info(f"[TestRun {run_id}]: Updated original workflow with test webhook data")
        
        # Clean up test-specific dictionaries for this run_id
        if run_id in webhook_test_events: del webhook_test_events[run_id]
        if run_id in webhook_test_data: del webhook_test_data[run_id]
        # Clear any remaining paths for this run_id from active_webhooks_expecting_test_data
        paths_to_clear = [path for path, r_id in active_webhooks_expecting_test_data.items() if r_id == run_id]
        for path in paths_to_clear: del active_webhooks_expecting_test_data[path]

    # Store the full run log and signal end of stream
    try:
        if workflow_id not in workflow_runs: workflow_runs[workflow_id] = []
        workflow_runs[workflow_id].insert(0, final_run_log)
        max_runs_to_keep = 10 
        if len(workflow_runs[workflow_id]) > max_runs_to_keep: workflow_runs[workflow_id] = workflow_runs[workflow_id][:max_runs_to_keep]
        save_workflows_to_disk() # Also saves runs
        
        logger.info(f"[Run {run_id} Finally]: Sending __END__ event to SSE queue.")
        await log_queue.put(json.dumps({"step": "__END__", "run_id": run_id, "is_test_log": is_test, "timestamp": time.time()}))
    except Exception as e_final:
         logger.error(f"[Run {run_id} Finally Error]: {e_final}", exc_info=True)
    finally:
        # Final check to ensure queue is removed if generator didn't catch __END__ (e.g., if queue was never consumed)
        if run_id in stream_queues:
            logger.warning(f"[Run {run_id} Final Cleanup]: Stream queue still exists. Removing it now.")
            # await stream_queues[run_id].join() # Attempt to let logs drain
            del stream_queues[run_id]
            
        logger.info(f"[Run {run_id} {'[TEST]' if is_test else ''}]: Background task finished.") 

# --- Helper: Send Webhook Data to a Specific Node ---
# This is a simplified implementation to bridge webhook callbacks to workflows.
# In test runs, it will signal the waiting event. In normal operation, it will
# start a new run of the workflow using the payload as initial input.

async def send_webhook_data_to_node(workflow_id: str, node_id: str, payload: Any):
    """Send data from an external webhook callback to a specific node.

    If the workflow is currently running in *test* mode and waiting for this
    webhook, the function will signal the waiting coroutine so that execution
    can continue. Otherwise, it will trigger a brand-new workflow run using the
    provided payload as `input_data`. This is a pragmatic approach that ensures
    production webhooks can still launch workflows even if no run is actively
    waiting for them.
    """

    try:
        # First: attempt to signal an active *test* workflow, if any.
        # Use helper to ensure consistent path format
        webhook_path_key = format_webhook_path(workflow_id, node_id)
        logger.info(f"[WebhookBridge] Checking for test run with path: {webhook_path_key}")
        signalled = await signal_webhook_data_for_test(webhook_path_key, node_id, payload)
        if signalled:
            logger.info(f"[WebhookBridge] Signalled waiting test run for {workflow_id}:{node_id}.")
            return True

        # No test run waiting – start a new *normal* workflow run so that the
        # payload is processed. In future, this could resume an existing run
        # instead of always starting a new one, but that orchestration logic is
        # beyond the current scope.
        await run_workflow(workflow_id, input_data=payload, is_test_run=False)
        logger.info(f"[WebhookBridge] Started new workflow run for {workflow_id} with incoming webhook data.")
        return True
    except Exception as exc:
        logger.error(f"[WebhookBridge] Failed to route webhook data to workflow {workflow_id}/{node_id}: {exc}", exc_info=True)
        return False 