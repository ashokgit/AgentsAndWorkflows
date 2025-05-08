from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel
from typing import List, Dict, Any, Optional
import uvicorn
import logging
import time # For simulating work
from collections import deque
import requests # Import requests
import asyncio
import json
import uuid
from sse_starlette.sse import EventSourceResponse
import os
from litellm import completion as litellm_completion # Use alias to avoid name clash

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Mini Workflow Engine Backend")

# --- SSE Stream Management ---
# Dictionary to hold asyncio Queues for active SSE streams, keyed by run_id
# Caution: In-memory storage, will be lost on restart. Needs persistent queue (Redis Pub/Sub, etc.) for production.
stream_queues: Dict[str, asyncio.Queue] = {}

async def log_stream_generator(run_id: str, request: Request):
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

# --- Data Models ---

class Node(BaseModel):
    id: str
    type: str
    position: Dict[str, float]
    data: Dict[str, Any]

class Edge(BaseModel):
    id: str
    source: str
    target: str
    sourceHandle: Optional[str] = None
    targetHandle: Optional[str] = None

class Workflow(BaseModel):
    id: str
    name: str
    nodes: List[Node]
    edges: List[Edge]
    # We might store viewport info etc. from the frontend too
    metadata: Optional[Dict[str, Any]] = None

class NodeExecutionResult(BaseModel):
    output: Any
    next_node_id: Optional[str] = None # For simple linear flow for now
    # Later: Add support for multiple outputs/branching (e.g., based on sourceHandle)

# In-memory storage for workflows (replace with DB later)
workflows_db: Dict[str, Workflow] = {}
workflow_runs: Dict[str, List[Dict]] = {} # workflow_id -> list of run logs


# --- Node Execution Logic (Placeholders/Registry) ---
# We'll move this to separate files and make it dynamic

def execute_node(node: Node, input_data: Any, workflow: Workflow) -> NodeExecutionResult:
    """Executes a single node based on its type."""
    logger.info(f"Executing node {node.id} ({node.type}) with input: {input_data}")
    
    output_data = None
    node_type = node.type
    node_data = node.data

    try:
        if node_type == 'input' or node_type == 'webhook':
            output_data = input_data 
            logger.info(f"Node {node.id} ({node_type}) passing data: {output_data}")
        
        elif node_type == 'llm':
            # Check if this node references a model configuration
            model_config_id = node_data.get('model_config_id')
            model_config = None
            
            if model_config_id:
                # Find the referenced model config node
                model_config_nodes = [n for n in workflow.nodes if n.id == model_config_id and n.type == 'model_config']
                if model_config_nodes:
                    model_config = model_config_nodes[0].data
                    logger.info(f"LLM Node {node.id}: Using model config '{model_config.get('config_name', 'Unnamed')}'")
                else:
                    logger.warning(f"LLM Node {node.id}: Referenced model config {model_config_id} not found")
            
            prompt = node_data.get('prompt', 'What is the weather in London?')
            
            # Use model config if available, otherwise use node's own configuration
            if model_config:
                model = model_config.get('model')
                api_key = model_config.get('api_key')
                custom_api_base = model_config.get('api_base')
            else:
                model = node_data.get('model')
                api_key = node_data.get('api_key')
                custom_api_base = node_data.get('api_base')

            if not model:
                raise ValueError("Model name is required for LLM node.")
            if not api_key:
                 # Allow falling back to environment variables if not provided in UI
                 # Note: LiteLLM usually handles env vars automatically, but explicit check is safer
                 # Depending on the model provider (e.g., OpenAI, Anthropic), get the relevant env var
                 # This part could be more sophisticated, mapping model prefixes to env vars
                 # For simplicity, let's try OPENAI_API_KEY as a common default if not provided
                 api_key = os.environ.get('OPENAI_API_KEY')
                 if not api_key:
                      raise ValueError(f"API Key not found in node data or environment variables for model {model}.")
                 else:
                     logger.warning(f"Node {node.id}: Using API key from environment variable.")

            # Format input data for the prompt (simple string conversion)
            input_str = json.dumps(input_data) if isinstance(input_data, (dict, list)) else str(input_data)
            
            # Basic message structure
            messages = [
                {"role": "system", "content": prompt}, 
                {"role": "user", "content": f"Input Data:\n```json\n{input_str}\n```"}
            ]
            
            logger.info(f"LLM Node {node.id}: Calling model '{model}'...")
            try:
                # Note: litellm.completion is synchronous by default.
                # For production, consider using litellm.acompletion for async or running in a thread pool.
                response = litellm_completion(
                    model=model,
                    messages=messages,
                    api_key=api_key,
                    api_base=custom_api_base if custom_api_base else None # Pass api_base if provided
                )
                
                # Extract the response content
                # Structure might vary slightly, check litellm docs for details
                llm_output_content = response.choices[0].message.content
                
                output_data = {
                    "response": llm_output_content,
                    "model_used": model,
                    "usage": response.usage.dict() if hasattr(response, 'usage') and hasattr(response.usage, 'dict') else None, 
                    "original_input": input_data
                }
                logger.info(f"LLM Node {node.id}: Call successful.")

            except Exception as llm_exc:
                 logger.error(f"LLM Node {node.id}: API call failed: {llm_exc}", exc_info=True)
                 # Improve error message for common issues
                 if "auth" in str(llm_exc).lower():
                      raise ConnectionError(f"Authentication failed for model {model}. Check API key.")
                 raise ConnectionError(f"Failed to call model {model}: {llm_exc}")
        
        elif node_type == 'model_config':
            # Model config nodes just pass through data without executing anything
            config_name = node_data.get('config_name', 'Unnamed Configuration')
            model = node_data.get('model', 'unknown')
            output_data = {
                "status": "success",
                "message": f"Model configuration '{config_name}' for model '{model}' is available",
                "config": {
                    "name": config_name,
                    "model": model
                }
            }
            logger.info(f"Model Config Node {node.id}: Passed through")
        
        elif node_type == 'code':
            # Placeholder - needs sandboxing and actual execution
            code = node_data.get('code', 'pass')
            output_data = {"result": f"Simulated execution of code: {code[:50]}...", "original_input": input_data}
            logger.info(f"Simulating Code node {node.id}: {output_data}")
            time.sleep(0.1)

        elif node_type == 'webhook_action':
            url = node_data.get('url')
            method = node_data.get('method', 'POST').upper()
            headers = node_data.get('headers', {})
            # Default to sending the input data as JSON
            json_payload = node_data.get('body', input_data) 
            
            if not url:
                logger.error(f"Webhook Action node {node.id}: URL is missing.")
                raise ValueError("URL is required for webhook_action")
            
            logger.info(f"Webhook Action {node.id}: Sending {method} request to {url}")
            try:
                response = requests.request(
                    method=method,
                    url=url,
                    json=json_payload, # Send input data as JSON body by default
                    headers=headers, 
                    timeout=10 # Add a timeout
                )
                response.raise_for_status() # Raise HTTPError for bad responses (4xx or 5xx)
                
                # Try to parse JSON response, fall back to text
                try:
                    response_data = response.json()
                except requests.exceptions.JSONDecodeError:
                    response_data = response.text

                output_data = {
                    "status": "success",
                    "status_code": response.status_code,
                    "response_body": response_data,
                    "url": url,
                    "method": method
                }
                logger.info(f"Webhook Action {node.id}: Request successful (Status: {response.status_code})")

            except requests.exceptions.RequestException as e:
                logger.error(f"Webhook Action {node.id}: Request failed: {e}")
                # Propagate the error to stop workflow execution on this path
                raise ConnectionError(f"Failed to send webhook to {url}: {e}") 
        
        elif node_type == 'default':
            # Default node could just log the input
            logger.info(f"Default node {node.id} received: {input_data}")
            output_data = {"logged_data": input_data}
        
        else:
            logger.warning(f"Node {node.id}: Unknown node type '{node_type}'. Passing input through.")
            output_data = input_data # Pass data through for unknown types

        # Ensure output_data is set, even if node logic had issues but didn't raise
        if output_data is None:
             output_data = {"warning": f"Node type {node_type} did not produce output.", "original_input": input_data}

        return NodeExecutionResult(output=output_data)

    except Exception as e:
        logger.error(f"Error executing node {node.id} ({node_type}): {e}", exc_info=True)
        # Re-raise the exception to be caught by the main run_workflow loop
        # This ensures the step is marked as failed in the log
        raise

# --- API Endpoints ---

@app.get("/")
def read_root():
    return {"message": "Welcome to the Mini Workflow Engine Backend!"}

@app.post("/api/workflows", status_code=201)
def save_workflow(workflow: Workflow):
    logger.info(f"Saving workflow: {workflow.id} - {workflow.name}")
    workflows_db[workflow.id] = workflow
    return {"message": "Workflow saved successfully", "workflow_id": workflow.id}

@app.get("/api/workflows/{workflow_id}")
def get_workflow(workflow_id: str):
    logger.info(f"Fetching workflow: {workflow_id}")
    workflow = workflows_db.get(workflow_id)
    if not workflow:
        # In a real app, you'd use HTTPException
        return {"error": "Workflow not found"}, 404
    return workflow

@app.get("/api/workflows")
def list_workflows():
    logger.info("Listing all workflows")
    return list(workflows_db.values())

@app.post("/api/workflows/{workflow_id}/run")
async def run_workflow_and_get_run_id(workflow_id: str, input_data: Optional[Dict[str, Any]] = None):
    logger.info(f"Received run request trigger for workflow: {workflow_id} with input: {input_data}")
    workflow = workflows_db.get(workflow_id)
    if not workflow:
        raise HTTPException(status_code=404, detail="Workflow not found")

    run_id = str(uuid.uuid4())
    log_queue = asyncio.Queue() # Create the queue HERE
    stream_queues[run_id] = log_queue # Store it immediately
    
    logger.info(f"Generated run_id: {run_id}, created log queue for workflow: {workflow_id}")

    # Start the workflow execution in the background, PASSING the queue
    asyncio.create_task(execute_workflow_logic(workflow, run_id, log_queue, input_data))

    return {"message": "Workflow execution started", "run_id": run_id, "workflow_id": workflow_id}

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
        if node.id not in target_nodes or node.type in ['input', 'webhook']
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


# --- SSE Streaming Endpoint ---
@app.get("/api/workflows/{workflow_id}/runs/{run_id}/stream")
async def stream_logs(request: Request, workflow_id: str, run_id: str):
    if workflow_id not in workflows_db:
         raise HTTPException(status_code=404, detail="Workflow not found")
    client_ip = request.client.host if request.client else "Unknown"
    logger.info(f"[SSE Endpoint Hit {run_id}]: SSE connection request from {client_ip} for workflow {workflow_id}")
    return EventSourceResponse(log_stream_generator(run_id, request))

@app.get("/api/workflows/{workflow_id}/runs")
async def get_workflow_runs(workflow_id: str):
    # This now returns the stored historical runs, not live data
    logger.info(f"Fetching stored runs for workflow: {workflow_id}")
    if workflow_id not in workflows_db:
         raise HTTPException(status_code=404, detail="Workflow not found")
    runs = workflow_runs.get(workflow_id, [])
    return runs # Returns list of *completed* run logs, newest first

# Placeholder for webhook trigger node
# In a real app, this would need a persistent way to map URLs to workflows
@app.post("/webhooks/{webhook_id}")
def handle_webhook(webhook_id: str, data: Dict[str, Any]):
    logger.info(f"Webhook received for ID: {webhook_id} with data: {data}")
    # TODO: Find workflow associated with webhook_id and trigger run_workflow
    # This requires a mapping mechanism (e.g., in DB)
    return {"message": "Webhook received (processing not implemented yet)"}

@app.post("/api/model_config/test")
async def test_model_config(model_config: Dict[str, Any]):
    """Test a model configuration by sending a simple message."""
    logger.info(f"Testing model configuration: {model_config.get('config_name')}")
    
    model = model_config.get('model')
    api_key = model_config.get('api_key')
    custom_api_base = model_config.get('api_base')
    test_message = model_config.get('test_message', 'Hi')
    
    if not model:
        raise HTTPException(status_code=400, detail="Model name is required")
    
    try:
        # Use same logic as in execute_node for LLM, but simplified
        if not api_key:
            api_key = os.environ.get('OPENAI_API_KEY')
            if not api_key:
                raise ValueError(f"API Key not found in config or environment variables for model {model}")
        
        # Basic message structure
        messages = [
            {"role": "user", "content": test_message}
        ]
        
        logger.info(f"Test: Calling model '{model}'...")
        response = litellm_completion(
            model=model,
            messages=messages,
            api_key=api_key,
            api_base=custom_api_base if custom_api_base else None
        )
        
        # Extract the response content
        output_content = response.choices[0].message.content
        
        return {
            "status": "success",
            "response": output_content,
            "model_used": model,
            "usage": response.usage.dict() if hasattr(response, 'usage') and hasattr(response.usage, 'dict') else None
        }
        
    except Exception as e:
        logger.error(f"Error testing model configuration: {e}", exc_info=True)
        error_msg = str(e)
        if "auth" in error_msg.lower():
            error_msg = f"Authentication failed for model {model}. Check API key."
        
        return {
            "status": "error",
            "error": error_msg,
            "model": model
        }

# --- Main Execution ---

if __name__ == "__main__":
    print("Starting Mini Workflow Engine Backend...")
    # Allow CORS for frontend development (adjust in production)
    from fastapi.middleware.cors import CORSMiddleware

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"], # Or specify your frontend URL e.g., "http://localhost:3000"
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    uvicorn.run(app, host="0.0.0.0", port=8000, reload=True) 