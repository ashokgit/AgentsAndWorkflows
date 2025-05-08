import logging
import time
import requests
import os
import json
from typing import Any, Dict, Optional
import base64
from urllib.parse import urlencode

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
        
        elif node_type == 'api_consumer':
            output_data = execute_api_consumer_node(node, input_data)
        
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

def execute_api_consumer_node(node: Node, input_data: Any) -> Any:
    """Execute an API consumer node with support for various authentication methods"""
    node_data = node.data
    url = node_data.get('url')
    method = node_data.get('method', 'GET').upper()
    headers = node_data.get('headers', {})
    body = node_data.get('body', None)
    auth_type = node_data.get('auth_type', 'none')
    timeout = int(node_data.get('timeout', 30000)) / 1000  # Convert from ms to seconds
    retry_policy = node_data.get('retry_policy', 'none')
    response_handling = node_data.get('response_handling', 'json')
    
    # Parse the headers if it's a string
    if isinstance(headers, str):
        try:
            headers = json.loads(headers)
        except json.JSONDecodeError:
            headers = {}
            logger.warning(f"API Consumer node {node.id}: Invalid headers JSON, using empty headers")
    
    # Process query parameters
    query_params = node_data.get('query_params', '{}')
    if isinstance(query_params, str):
        try:
            query_params = json.loads(query_params)
        except json.JSONDecodeError:
            query_params = {}
            logger.warning(f"API Consumer node {node.id}: Invalid query params JSON, using empty params")
    
    # Build the full URL with query parameters
    if query_params:
        url_params = urlencode(query_params)
        if '?' in url:
            url = f"{url}&{url_params}"
        else:
            url = f"{url}?{url_params}"
    
    # Process the body if it's a string and meant to be JSON
    if isinstance(body, str) and body.strip():
        try:
            body = json.loads(body)
        except json.JSONDecodeError:
            logger.warning(f"API Consumer node {node.id}: Invalid body JSON, sending as raw string")
            # Keep as string if not valid JSON
    
    # Default to input data if body is empty
    if not body:
        body = input_data
    
    # Apply authentication based on the type
    auth = None
    if auth_type == 'api_key':
        api_key_name = node_data.get('api_key_name', 'X-API-Key')
        api_key_value = node_data.get('api_key_value', '')
        api_key_location = node_data.get('api_key_location', 'header')
        
        if api_key_location == 'header':
            headers[api_key_name] = api_key_value
        elif api_key_location == 'query':
            # Add to URL if not already added with other query params
            param = urlencode({api_key_name: api_key_value})
            if '?' in url:
                url = f"{url}&{param}"
            else:
                url = f"{url}?{param}"
    
    elif auth_type == 'bearer':
        bearer_token = node_data.get('bearer_token', '')
        headers['Authorization'] = f"Bearer {bearer_token}"
    
    elif auth_type == 'basic':
        username = node_data.get('basic_username', '')
        password = node_data.get('basic_password', '')
        auth = requests.auth.HTTPBasicAuth(username, password)
    
    elif auth_type == 'oauth2':
        # For OAuth2, we would need to get a token first, but this is a simplified version
        # In a real implementation, you would handle token acquisition, refresh, etc.
        client_id = node_data.get('oauth_client_id', '')
        client_secret = node_data.get('oauth_client_secret', '')
        token_url = node_data.get('oauth_token_url', '')
        scope = node_data.get('oauth_scope', '')
        
        # Simple implementation - get token and use it
        if token_url:
            try:
                token_response = requests.post(
                    token_url,
                    data={
                        'grant_type': 'client_credentials',
                        'client_id': client_id,
                        'client_secret': client_secret,
                        'scope': scope
                    },
                    timeout=timeout
                )
                token_data = token_response.json()
                access_token = token_data.get('access_token')
                if access_token:
                    headers['Authorization'] = f"Bearer {access_token}"
                else:
                    logger.error(f"API Consumer node {node.id}: Failed to get OAuth2 token")
            except Exception as e:
                logger.error(f"API Consumer node {node.id}: OAuth2 token acquisition failed: {e}")
    
    # Set up retry mechanism
    max_retries = 0
    if retry_policy == 'simple':
        max_retries = 3
    elif retry_policy == 'exponential':
        max_retries = 5  # With exponential backoff
    
    # Execute the request with retries
    attempt = 0
    response = None
    last_error = None
    
    while attempt <= max_retries:
        try:
            logger.info(f"API Consumer {node.id}: Sending {method} request to {url} (attempt {attempt+1})")
            
            # Set appropriate request arguments based on method
            request_kwargs = {
                'method': method,
                'url': url,
                'headers': headers,
                'timeout': timeout,
                'auth': auth
            }
            
            # Add body for methods that support it
            if method in ['POST', 'PUT', 'PATCH']:
                if isinstance(body, (dict, list)):
                    request_kwargs['json'] = body
                else:
                    request_kwargs['data'] = body
            
            response = requests.request(**request_kwargs)
            response.raise_for_status()
            break  # Success, exit retry loop
            
        except requests.exceptions.RequestException as e:
            last_error = e
            logger.warning(f"API Consumer {node.id}: Request failed (attempt {attempt+1}): {e}")
            
            if attempt >= max_retries:
                break
            
            # Calculate delay for exponential backoff
            if retry_policy == 'exponential':
                delay = (2 ** attempt) * 0.5  # 0.5, 1, 2, 4, 8 seconds
                time.sleep(delay)
            else:
                time.sleep(1)  # Simple fixed delay
            
            attempt += 1
    
    # If all retries failed, raise the last error
    if response is None:
        logger.error(f"API Consumer {node.id}: All requests failed after {max_retries+1} attempts")
        raise ConnectionError(f"Failed to connect to API: {last_error}")
    
    # Process the response based on the specified handling method
    try:
        if response_handling == 'json':
            try:
                response_data = response.json()
            except json.JSONDecodeError:
                logger.warning(f"API Consumer {node.id}: Could not parse response as JSON, falling back to text")
                response_data = response.text
        elif response_handling == 'text':
            response_data = response.text
        elif response_handling == 'binary':
            # Encode binary data as base64 string
            response_data = {'data': base64.b64encode(response.content).decode('utf-8'), 'encoding': 'base64'}
        else:
            # Default to treating as text
            response_data = response.text
        
        output_data = {
            "status_code": response.status_code,
            "response": response_data,
            "headers": dict(response.headers),
            "url": response.url,
            "request": {
                "method": method,
                "url": url,
                "headers": headers,
                # Don't include auth credentials in the output
            },
            "original_input": input_data
        }
        
        logger.info(f"API Consumer {node.id}: Request successful with status {response.status_code}")
        return output_data
        
    except Exception as e:
        logger.error(f"API Consumer {node.id}: Error processing response: {e}")
        raise 