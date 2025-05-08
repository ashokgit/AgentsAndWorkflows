import logging
import time
import requests
import os
import json
from typing import Any, Dict

from app.models.workflow import Node, Workflow, NodeExecutionResult
from app.utils.persistence import webhook_payloads
from litellm import completion as litellm_completion

# Set up logging
logger = logging.getLogger(__name__)

def execute_node(node: Node, input_data: Any, workflow: Workflow) -> NodeExecutionResult:
    """Executes a single node based on its type."""
    logger.info(f"Executing node {node.id} ({node.type}) with input: {input_data}")
    
    output_data = None
    node_type = node.type
    node_data = node.data

    try:
        if node_type == 'input' or node_type == 'trigger':
            output_data = input_data 
            logger.info(f"Node {node.id} ({node_type}) passing data: {output_data}")
        
        elif node_type == 'webhook_trigger':
            # If it's a webhook trigger node, use the last received payload
            webhook_id = node_data.get('webhook_id')
            if webhook_id and webhook_id in webhook_payloads:
                output_data = webhook_payloads[webhook_id]
                logger.info(f"Webhook Trigger Node {node.id}: Using stored payload from webhook {webhook_id}")
            else:
                # If no webhook data yet, use input data or provide a placeholder
                output_data = node_data.get('last_payload', input_data)
                if not output_data:
                    output_data = {"message": "No webhook data received yet"}
                    logger.warning(f"Webhook Trigger Node {node.id}: No data available")
                else:
                    logger.info(f"Webhook Trigger Node {node.id}: Using last payload from node data")

        elif node_type == 'llm':
            output_data = execute_llm_node(node, input_data, workflow)
        
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
            output_data = execute_webhook_action_node(node, input_data)
        
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

def execute_llm_node(node: Node, input_data: Any, workflow: Workflow) -> Any:
    """Execute an LLM node"""
    node_data = node.data
    
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
        return output_data

    except Exception as llm_exc:
        logger.error(f"LLM Node {node.id}: API call failed: {llm_exc}", exc_info=True)
        # Improve error message for common issues
        if "auth" in str(llm_exc).lower():
            raise ConnectionError(f"Authentication failed for model {model}. Check API key.")
        raise ConnectionError(f"Failed to call model {model}: {llm_exc}")

def execute_webhook_action_node(node: Node, input_data: Any) -> Any:
    """Execute a webhook action node"""
    node_data = node.data
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
        return output_data

    except requests.exceptions.RequestException as e:
        logger.error(f"Webhook Action {node.id}: Request failed: {e}")
        # Propagate the error to stop workflow execution on this path
        raise ConnectionError(f"Failed to send webhook to {url}: {e}") 