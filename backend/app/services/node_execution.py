import logging
import time
import requests
import os
import json
from typing import Any, Dict, Optional, List
import base64
from urllib.parse import urlencode
import re # Added for templating
import shutil # For directory operations
import tempfile # For temporary directories
import subprocess # For running Docker commands
import uuid # For unique naming

from app.models.workflow import Node, Workflow, NodeExecutionResult
from app.utils.persistence import webhook_payloads
from litellm import completion as litellm_completion
from litellm import acompletion as litellm_acompletion

# Define the name of the code executor Docker container
CODE_EXECUTOR_CONTAINER_NAME = "workflow-code-executor"

# Set up logging
logger = logging.getLogger(__name__)

def _render_prompt_template(template_string: str, context: Dict[str, Any]) -> str:
    """
    Renders a template string using a given context.
    Variables are in the format {{variable_name}}.
    If a variable is found in the context, it's replaced by its JSON stringified value.
    If not found, it's replaced by an empty string.
    """
    
    def replace_match(match):
        var_name = match.group(1)
        if var_name in context:
            value = context[var_name]
            if isinstance(value, (dict, list)):
                return json.dumps(value, indent=2)
            return str(value)
        else:
            logger.warning(f"Template variable '{{{{{var_name}}}}}' not found in context. Replacing with empty string.")
            return ""

    return re.sub(r"{{([\w\d_-]+)}}", replace_match, template_string)

def execute_node(node: Node, input_data: Any, workflow: Workflow, run_outputs: Dict[str, Any]) -> NodeExecutionResult:
    """Executes a single node based on its type."""
    node_label = node.data.get('webhook_name', node.data.get('node_name', node.data.get('label', node.id)))
    logger.info(f"Executing node {node.id} ({node_label} - {node.type}) with input: {str(input_data)[:100]}...")
    
    output_data = None
    node_type = node.type
    node_data = node.data

    try:
        # Execute the node based on its type
        if node_type == 'llm':
            output_data = execute_llm_node(node, input_data, workflow, run_outputs)
        elif node_type == 'code':
            output_data = execute_code_node(node_data, input_data)
        elif node_type == 'api_consumer':
            output_data = execute_api_consumer_node(node, input_data, run_outputs)
        elif node_type == 'model_config':
            output_data = input_data #As this node is not executed, it should pass the input through
        else:
            logger.warning(f"Node {node.id} ({node_label}): Unknown node type '{node_type}'. Passing input through.")
            output_data = input_data # Pass data through for unknown types

        # Ensure output_data is not None before returning
        if output_data is None and node_type != 'model_config': # model_config intentionally skipped in loop
             logger.warning(f"Node {node.id} ({node_type}) logic resulted in None output. Passing original input.")
             output_data = input_data
        elif output_data is None and node_type == 'model_config':
             # This case should ideally not happen based on above logic, but as fallback:
             output_data = {"status": "Configured", "message": "Model configuration node processed."} 

        # Update node status
        node_data['status'] = 'completed'
        node_data['output'] = output_data

        return NodeExecutionResult(output=output_data)

    except Exception as e:
        logger.error(f"Error during execution of node {node.id} ({node_label} - {node_type}): {e}", exc_info=True)
        raise # Re-raise to be caught by the main execute_workflow_logic loop

def execute_llm_node(node: Node, input_data: Any, workflow: Workflow, run_outputs: Dict[str, Any]) -> Any:
    """Execute an LLM node"""
    node_data = node.data
    
    # Check if this node references a model configuration
    model_config_id = node_data.get('model_config_id')
    model_config_data = None
    
    if model_config_id:
        # Find the referenced model config node
        model_config_nodes = [n for n in workflow.nodes if n.id == model_config_id and n.type == 'model_config']
        if model_config_nodes:
            model_config_data = model_config_nodes[0].data
            logger.info(f"LLM Node {node.id}: Using model config '{model_config_data.get('config_name', model_config_id)}'")
        else:
            logger.warning(f"LLM Node {node.id}: Referenced model config {model_config_id} not found in workflow nodes.")
    
    prompt_template = node_data.get('prompt', 'Respond to the input.')
    temperature = float(node_data.get('temperature', 0.7))
    max_tokens = int(node_data.get('max_tokens', 150))
    
    # Use model config if available, otherwise use node's own configuration
    if model_config_data:
        model = model_config_data.get('model')
        api_key = model_config_data.get('api_key')
        custom_api_base = model_config_data.get('api_base')
    else:
        model = node_data.get('model')
        api_key = node_data.get('api_key')
        custom_api_base = node_data.get('api_base')

    if not model:
        raise ValueError(f"LLM Node {node.id}: Model name is required (either directly or via config)." )
    
    if not api_key:
        # Allow falling back to environment variables if not provided in UI
        api_key = os.environ.get('OPENAI_API_KEY')
        if not api_key:
            raise ValueError(f"API Key not found in node data or environment variables for model {model}.")
        else:
            logger.warning(f"Node {node.id}: Using API key from environment variable.")

    templating_context = {"current_input": input_data}
    templating_context.update(run_outputs)

    final_prompt = _render_prompt_template(prompt_template, templating_context)
    
    input_str = json.dumps(input_data, indent=2) if isinstance(input_data, (dict, list)) else str(input_data)
    
    messages = [
        {"role": "system", "content": final_prompt},
        {"role": "user", "content": f"Contextual Input (available as 'current_input' in prompt templates):\n```json\n{input_str}\n```"}
    ]
    
    logger.info(f"LLM Node {node.id}: Calling model '{model}' (Base: {custom_api_base or 'default'}). Temp: {temperature}, MaxTokens: {max_tokens}")
    try:
        # Note: litellm.completion is synchronous by default.
        # For production, consider using litellm.acompletion for async or running in a thread pool.
        response = litellm_completion(
            model=model,
            messages=messages,
            api_key=api_key,
            api_base=custom_api_base if custom_api_base else None, # Pass api_base if provided
            temperature=temperature,
            max_tokens=max_tokens
        )
        
        # Extract the response content
        # Structure might vary slightly, check litellm docs for details
        llm_output_content = response.choices[0].message.content
        
        output_data = {
            "status": "success",
            "response_summary": llm_output_content[:100] + ('...' if len(llm_output_content) > 100 else ''),
            "full_response": llm_output_content,
            "details": {
                "model_used": model,
                "config_source": f"from node data" if not model_config_data else f"from config node '{model_config_data.get('config_name', model_config_id)}'",
                "api_base": custom_api_base or 'default',
                "temperature": temperature,
                "max_tokens": max_tokens,
                "usage": response.usage.dict() if hasattr(response, 'usage') and hasattr(response.usage, 'dict') else None
            }
        }
        logger.info(f"LLM Node {node.id}: Call successful. Output length: {len(llm_output_content)}, Usage: {response.usage.dict() if hasattr(response, 'usage') and hasattr(response.usage, 'dict') else None}")
        return output_data

    except Exception as llm_exc:
        logger.error(f"LLM Node {node.id}: API call failed for model {model}: {llm_exc}", exc_info=True)
        # Improve error message for common issues
        if "auth" in str(llm_exc).lower():
            raise ConnectionError(f"Authentication failed for model {model}. Check API key/Base URL.")
        raise ConnectionError(f"Failed to call model {model}: {llm_exc}")

def execute_webhook_action_node(node: Node, input_data: Any, run_outputs: Dict[str, Any]) -> Any:
    """Execute a webhook action node"""
    node_data = node.data
    url = node_data.get('url')
    method = node_data.get('method', 'POST').upper()
    headers_str = node_data.get('headers', '{}')
    body_template = node_data.get('body', None)

    if not url:
        logger.error(f"Webhook Action node {node.id}: URL is missing.")
        raise ValueError("URL is required for webhook")
    
    logger.info(f"Webhook Action {node.id}: Sending {method} request to {url}")
    try:
        # Parse headers from JSON string
        try:
            headers = json.loads(headers_str) if isinstance(headers_str, str) else headers_str
            if not isinstance(headers, dict):
                headers = {}
                logger.warning(f"Webhook Action {node.id}: Invalid headers format, using empty.")
        except json.JSONDecodeError:
            headers = {}
            logger.warning(f"Webhook Action {node.id}: Headers JSON decode error, using empty.")

        # Prepare payload: use body template if provided, otherwise send raw input
        payload = None
        if body_template and isinstance(body_template, str):
            try:
                templating_context = {"input_data": input_data} 
                templating_context.update(run_outputs)
                
                body_template_intermediate = body_template
                if "{{input_data}}" in body_template:
                    # Ensure {{input_data}} specifically uses the direct input_data, JSON stringified
                    # The general _render_prompt_template might stringify it differently or another value if 'input_data' key exists in run_outputs
                    body_template_intermediate = body_template.replace("{{input_data}}", json.dumps(input_data))
                
                payload_str = _render_prompt_template(body_template_intermediate, templating_context)
                
                payload = json.loads(payload_str)
            except json.JSONDecodeError:
                logger.warning(f"Webhook Action {node.id}: Failed to parse body template as JSON after substitution. Sending raw template string: {payload_str}")
                payload = payload_str 
            except Exception as e:
                logger.error(f"Webhook Action {node.id}: Error processing body template: {e}")
                payload = {"error": "Failed to process body template", "template": body_template}
        else:
            payload = input_data # Default to sending the input data directly
        
        response = requests.request(
            method=method,
            url=url,
            json=payload if method in ['POST', 'PUT', 'PATCH'] else None, # Send as JSON body for these methods
            params=payload if method == 'GET' else None, # Send as query params for GET
            headers=headers, 
            timeout=15 # Timeout of 15 seconds
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
            "response_body_summary": str(response_data)[:100] + ('...' if len(str(response_data)) > 100 else ''),
            "full_response_body": response_data,
            "request_details": {
                "url": url,
                "method": method,
                "payload_type": "Raw Input Data" if not body_template else "Processed Body Template (JSON)"
            }
        }
        logger.info(f"Webhook Action {node.id}: Request successful (Status: {response.status_code})")
        return output_data

    except requests.exceptions.RequestException as e:
        logger.error(f"Webhook Action {node.id}: Request failed: {e}")
        # Propagate the error to stop workflow execution on this path
        raise ConnectionError(f"Failed to send webhook to {url}: {e}") 

def execute_api_consumer_node(node: Node, input_data: Any, run_outputs: Dict[str, Any]) -> Any:
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
            "response_summary": str(response_data)[:100] + ('...' if len(str(response_data)) > 100 else ''),
            "full_response": response_data,
            "details": {
                "url_called": response.url,
                "method": method,
                "auth_used": auth_type,
                "retry_policy": f"{retry_policy} ({max_retries} attempts)",
                "attempts_made": attempt + 1,
                "response_handling": response_handling,
                "headers_received": dict(response.headers)
            }
        }
        
        logger.info(f"API Consumer {node.id}: Request successful with status {response.status_code}")
        return output_data
        
    except Exception as e:
        logger.error(f"API Consumer {node.id}: Error processing response: {e}")
        raise 

async def test_llm_node(node_data: Dict[str, Any], workflow_nodes: List[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Test an LLM node configuration by sending a simple message."""
    logger.info(f"Testing LLM node configuration: {node_data.get('node_name', 'Unnamed LLM Node')}")
    
    # Check if this node references a model configuration
    model_config_id = node_data.get('model_config_id')
    model_config = None
    
    if model_config_id and workflow_nodes:
        # Find the referenced model config node
        model_config_nodes = [n for n in workflow_nodes if n['id'] == model_config_id and n['type'] == 'model_config']
        if model_config_nodes:
            model_config = model_config_nodes[0].get('data', {})
            logger.info(f"LLM Node Test: Using model config '{model_config.get('config_name', 'Unnamed')}'")
    
    # Use the actual user-defined prompt
    test_prompt = node_data.get('prompt', 'Say hello')
    
    # Create a node_data_map for template replacements
    node_data_map = {}
    if workflow_nodes:
        for node in workflow_nodes:
            node_id = node.get('id')
            node_data_map[node_id] = node.get('data', {})
            # For webhook_trigger nodes, we're particularly interested in the last_payload
            if node.get('type') == 'webhook_trigger' and 'last_payload' in node.get('data', {}):
                node_data_map[node_id] = node['data']['last_payload']
    
    # Replace template variables with actual node data
    import re
    
    # Find all template variables like {{dndnode_X}}
    template_vars = re.findall(r"{{([\w\d_-]+)}}", test_prompt)
    
    # Replace each template variable with actual data if available
    for var in template_vars:
        if var in node_data_map:
            replacement = json.dumps(node_data_map[var], indent=2)
            logger.info(f"LLM Node Test: Replacing template variable {{{{{var}}}}} with actual node data")
            test_prompt = test_prompt.replace(f"{{{{{var}}}}}", replacement)
        else:
            logger.warning(f"LLM Node Test: Template variable {{{{{var}}}}} not found in workflow data")
            # Create a fallback sample payload
            sample_payload = {
                "event": "test.event",
                "data": {
                    "message": "This is a test message for missing node data",
                    "node_id": var
                }
            }
            test_prompt = test_prompt.replace(f"{{{{{var}}}}}", json.dumps(sample_payload, indent=2))
    
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
        raise ValueError("Model name is required for LLM node testing")
    
    try:
        # Use same logic as in execute_node for LLM, but simplified
        if not api_key:
            api_key = os.environ.get('OPENAI_API_KEY')
            if not api_key:
                raise ValueError(f"API Key not found in node data or environment variables for model {model}")
        
        # Sample input data for testing - simplified from what a real execution would use
        input_data = {"test": "This is a test of the LLM node functionality"}
        
        # Basic message structure
        messages = [
            {"role": "system", "content": test_prompt}, 
            {"role": "user", "content": f"Input Data:\n```json\n{json.dumps(input_data, indent=2)}\n```"}
        ]
        
        logger.info(f"LLM Node Test: Calling model '{model}'...")
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
        logger.error(f"Error testing LLM node: {e}", exc_info=True)
        error_msg = str(e)
        if "auth" in error_msg.lower():
            error_msg = f"Authentication failed for model {model}. Check API key."
        
        return {
            "status": "error",
            "error": error_msg,
            "model": model
        } 

def execute_code_node(node_data: Dict[str, Any], input_data: Any) -> Any:
    """Execute a code node with the given input data."""
    code = node_data.get('code', '')
    if not code:
        logger.warning("Code node: No code provided. Passing input through.")
        return input_data

    try:
        # Create a new namespace for execution
        local_vars = {
            'input_data': input_data,
            'result': None
        }
        
        # Execute the code in the isolated namespace
        exec(code, {"__builtins__": __builtins__}, local_vars)
        
        # Get the result from the namespace
        output_data = local_vars.get('result')
        
        # If no result was set, return the input data
        if output_data is None:
            logger.warning("Code node: No result variable set. Passing input through.")
            return input_data
            
        return {
            "status": "success",
            "output": output_data,
            "details": {
                "code_executed": code[:100] + ('...' if len(code) > 100 else ''),
                "input_type": type(input_data).__name__,
                "output_type": type(output_data).__name__
            }
        }
        
    except Exception as e:
        logger.error(f"Code node execution error: {e}", exc_info=True)
        raise ValueError(f"Code execution failed: {str(e)}") 

async def test_code_node_in_docker(code: str, input_data: Dict[str, Any], requirements: Optional[str], timeout_seconds: int = 60) -> Dict[str, Any]:
    """
    Executes Python code in the dedicated code-executor container, passing input via STDIN.
    """
    logger.info(f"Attempting to test code in code-executor container via STDIN. Code snippet: {code[:100]}...")
    
    tmp_dir = None # Keep tmp_dir for requirements.txt if needed
    try:
        # Convert input_data to JSON string to be passed via STDIN
        input_json_str = json.dumps(input_data)
        
        # 1. Create main.py (user's code, wrapped to handle input/output from STDIN)
        main_py_content = f"""
import json
import sys
import os

# --- User's Python code starts ---
{code}
# --- User's Python code ends ---

if __name__ == '__main__':
    input_payload = {{}}
    error_occurred = False
    error_details = {{}}

    try:
        # Read input from STDIN
        stdin_data = sys.stdin.read()
        if not stdin_data:
            # Handle case where STDIN is empty, though subprocess.run input should provide it
            # This might indicate an issue with how data is piped.
            input_payload = {{}} # Default to empty if no STDIN, or raise error
            logger.warning("Code executor: STDIN was empty. Using empty input_payload.")
        else:
            input_payload = json.loads(stdin_data)
            
    except json.JSONDecodeError as e:
        error_details = {{"error": "Invalid JSON from STDIN", "details": str(e)}}
        error_occurred = True
    except Exception as e_stdin: # Catch other potential errors during STDIN processing
        error_details = {{"error": "Error processing STDIN", "details": str(e_stdin)}}
        error_occurred = True


    if error_occurred:
        # Output error as JSON to STDOUT so it can be captured
        print(json.dumps({{"status": "error", "error": error_details.get("error"), "details": error_details.get("details")}}))
        sys.exit(0) # Exit cleanly for Docker, actual error is in JSON

    try:
        if 'execute' not in globals() and 'execute' not in locals():
            raise NameError("Function 'execute(input_data)' is not defined in the provided code.")

        result = execute(input_payload) # Pass the loaded payload
        print(json.dumps({{"status": "success", "result": result}}))

    except Exception as e:
        print(json.dumps({{\
            "status": "error", 
            "error": f"Error during Python code execution: {{str(e)}}",
            "error_type": type(e).__name__,
        }}))
    finally:
        # Ensure a clean exit for Docker; result/error is captured from STDOUT
        sys.exit(0)
"""
        # Create a temporary directory if requirements are provided or for main.py
        # This part can be simplified if requirements are also handled differently or not present.
        # For now, we keep it for housing main.py and potentially requirements.txt.
        tmp_dir = tempfile.mkdtemp()
        logger.debug(f"Created temporary directory for code execution artifacts: {tmp_dir}")

        main_py_path = os.path.join(tmp_dir, "main.py")
        with open(main_py_path, "w") as f:
            f.write(main_py_content)
        logger.debug(f"Created main.py at {main_py_path}")

        # 2. Create requirements.txt if provided
        requirements_txt_path = None
        if requirements:
            requirements_txt_path = os.path.join(tmp_dir, "requirements.txt")
            with open(requirements_txt_path, "w") as f:
                f.write(requirements)
            logger.debug(f"Created requirements.txt at {requirements_txt_path}")

        # Define container paths
        container_app_dir = "/app"
        container_main_py = f"{container_app_dir}/main.py"
        container_requirements_txt = f"{container_app_dir}/requirements.txt" if requirements else None

        # 3. Copy files to the Docker container
        # Copy main.py
        # Ensure main.py is executable by the user inside the container if needed, though python execution doesn't require it.
        cmd_cp_main = ["docker", "cp", main_py_path, f"{CODE_EXECUTOR_CONTAINER_NAME}:{container_main_py}"]
        subprocess.run(cmd_cp_main, check=True, capture_output=True)
        logger.debug(f"Copied main.py to {CODE_EXECUTOR_CONTAINER_NAME}:{container_main_py}")

        if requirements_txt_path and container_requirements_txt:
            cmd_cp_req = ["docker", "cp", requirements_txt_path, f"{CODE_EXECUTOR_CONTAINER_NAME}:{container_requirements_txt}"]
            subprocess.run(cmd_cp_req, check=True, capture_output=True)
            logger.debug(f"Copied requirements.txt to {CODE_EXECUTOR_CONTAINER_NAME}:{container_requirements_txt}")
            
            # Install requirements
            # It's important that the user running this can write to the site-packages or a local venv
            # For simplicity, assuming global install within the container as root or a user with write access.
            # The Dockerfile for code-executor should set up a user/permissions appropriately if not root.
            # We should also consider if requirements installation should happen every time or if it can be cached.
            # For now, installing every time for simplicity.
            install_command = [
                "docker", "exec", CODE_EXECUTOR_CONTAINER_NAME,
                "pip", "install", "-r", container_requirements_txt, "--user" # Install to user site-packages
            ]
            logger.info(f"Installing requirements from {container_requirements_txt} in {CODE_EXECUTOR_CONTAINER_NAME}")
            pip_process = subprocess.run(install_command, capture_output=True, text=True, timeout=120) # Increased timeout for pip
            if pip_process.returncode != 0:
                logger.error(f"Pip install failed. STDOUT: {pip_process.stdout} STDERR: {pip_process.stderr}")
                return {"status": "error", "error": "Failed to install requirements", "details": pip_process.stderr or pip_process.stdout}
            logger.info(f"Pip install successful. STDOUT: {pip_process.stdout}")


        # 4. Execute the code in Docker, passing input_json_str via STDIN
        exec_command = [
            "docker", "exec", "-i", # -i is crucial for passing STDIN
            CODE_EXECUTOR_CONTAINER_NAME,
            "python", container_main_py 
        ]
        logger.info(f"Executing code in {CODE_EXECUTOR_CONTAINER_NAME} with STDIN. Command: {' '.join(exec_command)}")
        
        try:
            # Pass input_json_str to the process's STDIN
            exec_process = subprocess.run(
                exec_command,
                input=input_json_str, # Pass the JSON string as input
                capture_output=True,
                text=True, # Decodes stdout/stderr as text
                timeout=timeout_seconds,
                check=False # We will check return code and parse output manually
            )
            
            # Log stdout/stderr regardless of success for debugging
            logger.debug(f"Code execution STDOUT: {exec_process.stdout}")
            if exec_process.stderr:
                logger.warning(f"Code execution STDERR: {exec_process.stderr}")

            # The Python script (main_py_content) is designed to always exit with 0
            # and print a JSON to STDOUT. So, we primarily parse STDOUT.
            # A non-zero exit from `docker exec` itself would indicate a deeper issue.

            if exec_process.returncode != 0:
                # This might happen if `python main.py` itself crashes before our try/except in main.py
                # or if `docker exec` command fails.
                logger.error(f"Docker exec command returned non-zero exit code: {exec_process.returncode}. STDERR: {exec_process.stderr}")
                return {
                    "status": "error",
                    "error": "Docker execution command failed",
                    "details": exec_process.stderr or f"Docker exec exited with {exec_process.returncode}"
                }

            # Parse the output from the script's STDOUT
            try:
                # Handle cases where stdout might be empty or not JSON
                if not exec_process.stdout.strip():
                    logger.error("Code execution produced no STDOUT. This is unexpected.")
                    return {
                        "status": "error",
                        "error": "Execution produced no output",
                        "details": exec_process.stderr or "The script's STDOUT was empty."
                    }
                
                result_json = json.loads(exec_process.stdout)
                # Log the actual result from the user's code perspective
                if result_json.get("status") == "success":
                    logger.info(f"Code execution successful via STDIN. Result preview: {str(result_json.get('result'))[:100]}...")
                else:
                    logger.warning(f"Code execution reported failure via STDIN. Error: {result_json.get('error')}, Details: {result_json.get('details')}")
                return result_json
            except json.JSONDecodeError as e:
                logger.error(f"Failed to parse JSON output from script: {e}. Raw STDOUT: {exec_process.stdout[:1000]}")
                return {
                    "status": "error",
                    "error": "Failed to parse execution result from script",
                    "details": f"Output was not valid JSON. STDOUT: {exec_process.stdout[:1000]}. STDERR: {exec_process.stderr}"
                }

        except subprocess.TimeoutExpired:
            logger.warning(f"Code execution timed out after {timeout_seconds} seconds (STDIN method)")
            return {
                "status": "error",
                "error": f"Code execution timed out after {timeout_seconds} seconds"
            }
        except subprocess.CalledProcessError as e: # Should be caught by check=False and manual check now
            logger.error(f"Error during Docker command execution (CalledProcessError): {e}. Output: {e.output}, Stderr: {e.stderr}")
            return {
                "status": "error",
                "error": "Failed to execute code in Docker (CalledProcessError)",
                "details": str(e.stderr) or str(e.output) or str(e)
            }
        except Exception as e: # Catch-all for other subprocess or docker issues
            logger.error(f"General error executing code in Docker (STDIN method): {e}", exc_info=True)
            return {
                "status": "error",
                "error": "Failed to execute code in Docker due to an unexpected issue",
                "details": str(e)
            }

    except FileNotFoundError as e: # e.g. if 'docker' command is not found
        logger.error(f"Docker command not found: {e}. Ensure Docker CLI is installed and in PATH.", exc_info=True)
        # Re-raise a more specific error or return a structured error
        return {"status": "error", "error": "Docker command not found", "details": str(e)}

    except Exception as e:
        logger.error(f"Outer error during code execution setup (STDIN method): {e}", exc_info=True)
        return {
            "status": "error",
            "error": "An unexpected error occurred during code test setup (STDIN method)",
            "details": str(e)
        }
    finally:
        if tmp_dir and os.path.exists(tmp_dir):
            try:
                shutil.rmtree(tmp_dir)
                logger.debug(f"Removed temporary directory {tmp_dir}")
            except Exception as e_clean:
                logger.error(f"Failed to remove temporary directory {tmp_dir}: {e_clean}")

    # Fallback, should ideally be handled by one of the return paths above
    logger.error("Reached end of test_code_node_in_docker function unexpectedly (STDIN method).")
    return {"status": "error", "error": "Reached end of code execution function unexpectedly."}

async def generate_code_with_llm(
    available_inputs_schema: Dict[str, Any], 
    current_code: Optional[str], 
    user_instruction: str,
    model_config_id: Optional[str] = None, # New parameter
    workflow_nodes: Optional[List[Dict[str, Any]]] = None # New parameter
) -> Dict[str, Any]:
    """
    Generates Python code using an LLM based on available inputs, current code, and user instruction.
    The generated code should define a function: def execute(input_data):
    """
    logger.info(f"Initiating AI code generation. Instruction: {user_instruction[:100]}...")

    # Construct a detailed prompt for the LLM
    prompt_parts = []
    prompt_parts.append("You are an expert Python coding assistant. Your task is to generate or update a Python script for a workflow automation node.")
    prompt_parts.append("The script MUST define a single function with the exact signature: `def execute(input_data):`")
    prompt_parts.append("This function will receive a dictionary `input_data` containing outputs from upstream nodes.")

    if available_inputs_schema:
        prompt_parts.append("\nHere's a description of the `input_data` structure you can expect, keyed by upstream node ID:")
        for node_id, schema_info in available_inputs_schema.items():
            input_description = f"  - Node '{schema_info.get('node_name', node_id)}' (ID: {node_id}, Type: {schema_info.get('node_type', 'N/A')}):\n"
            input_description += f"    Its output will be available as `input_data['{node_id}']`.\n"
            input_description += f"    Sample data structure: {json.dumps(schema_info.get('data_structure_sample', {}), indent=2)}"
            prompt_parts.append(input_description)
        prompt_parts.append("For example, to access data from a node named 'Webhook Data' with ID 'node_abc', you would use `input_data['node_abc']`.")
    else:
        prompt_parts.append("The `input_data` dictionary will likely be empty as no upstream inputs are connected or have sample data.")

    prompt_parts.append("\nUser's instruction for the code to be generated/updated:")
    prompt_parts.append(f"'''{user_instruction}'''")

    if current_code and current_code.strip():
        prompt_parts.append("\nThis is the current code in the editor. Please try to modify or build upon it if relevant to the instruction. If the instruction is entirely new, you can replace it:")
        prompt_parts.append("```python")
        prompt_parts.append(current_code)
        prompt_parts.append("```")
    else:
        prompt_parts.append("\nThere is no existing code in the editor. Please generate the new code based on the instruction.")
    
    prompt_parts.append("\nPlease provide ONLY the complete Python code for the `execute` function and any necessary helper functions or imports within the script. Do not include any explanatory text before or after the code block.")
    prompt_parts.append('The function must return a value (e.g., a dictionary, a string, a number). Example return: `{"summary": "summary_text", "data_processed": True}`')
    prompt_parts.append("Ensure all necessary imports are included at the top of the script.")

    final_prompt = "\n".join(prompt_parts)
    logger.debug(f"Generated LLM Prompt:\n{final_prompt}")

    # LLM Configuration (you might want to make this more configurable, e.g., from settings or model_config node)
    # For now, using a common default. Ensure OPENAI_API_KEY is set in your environment or handled by litellm.
    llm_model = os.environ.get("DEFAULT_CODE_GENERATION_MODEL", "gpt-3.5-turbo") 
    api_key = os.environ.get("OPENAI_API_KEY") # LiteLLM will pick this up
    custom_api_base = os.environ.get("OPENAI_API_BASE") # If using a custom base
    resolved_model_config_name = "environment default"

    if model_config_id and workflow_nodes:
        found_config = None
        for node_dict in workflow_nodes:
            if node_dict.get('id') == model_config_id and node_dict.get('type') == 'model_config':
                found_config = node_dict.get('data', {})
                break
        
        if found_config:
            logger.info(f"Using model configuration '{found_config.get('config_name', model_config_id)}' for AI code generation.")
            llm_model = found_config.get('model', llm_model)
            # API key from model_config overrides environment if present and non-empty
            config_api_key = found_config.get('api_key')
            if config_api_key:
                api_key = config_api_key
            # API base from model_config overrides environment if present and non-empty
            config_api_base = found_config.get('api_base')
            if config_api_base:
                custom_api_base = config_api_base
            resolved_model_config_name = found_config.get('config_name', model_config_id)
        else:
            logger.warning(f"Model configuration ID '{model_config_id}' provided but not found in workflow_nodes. Falling back to defaults.")

    # Ensure api_key is not None before passing to litellm if required by the model provider
    # LiteLLM can sometimes work without an explicit key if it's configured for a proxy or certain local models.
    if not api_key and not os.environ.get("AZURE_API_KEY"): # Check common LiteLLM env vars
         logger.warning(f"No API key found for LLM (model: {llm_model}, config: '{resolved_model_config_name}'). Code generation might fail or use a default free model if available.")

    messages = [
        {"role": "system", "content": "You are an expert Python coding assistant tasked with generating a Python script for a workflow node."}, # System prompt can be simpler here as details are in user prompt
        {"role": "user", "content": final_prompt}
    ]

    try:
        logger.info(f"Calling LLM ({llm_model}) for code generation...")
        response = await litellm_acompletion(
            model=llm_model,
            messages=messages,
            api_key=api_key, # Pass explicitly if fetched
            api_base=custom_api_base, # Pass explicitly if fetched
            temperature=0.2, # Lower temperature for more deterministic code
            max_tokens=1500 # Adjust as needed
        )
        
        generated_code_raw = response.choices[0].message.content
        logger.debug(f"Raw LLM response: {generated_code_raw}")

        # Post-process the generated code: extract code from markdown triple backticks if present
        match = re.search(r"```python\n(.*?)\n```", generated_code_raw, re.DOTALL)
        if match:
            generated_code = match.group(1).strip()
        else:
            # If no markdown block, assume the whole response is code, but warn if it contains common conversational phrases
            if any(phrase in generated_code_raw.lower() for phrase in ["here is the code", "certainly,", "sure,"]):
                 logger.warning("LLM response might contain conversational text outside a markdown block. Attempting to use as is.")
            generated_code = generated_code_raw.strip()

        # Basic validation: Does it contain "def execute(input_data):"?
        if "def execute(input_data):" not in generated_code:
            logger.warning("Generated code does not contain 'def execute(input_data):'. LLM might have misunderstood.")
            # Fallback: Try to wrap the code if it seems like a simple script body
            if not any(kw in generated_code for kw in ["def ", "class "]) and generated_code.count('\n') > 0:
                logger.info("Attempting to wrap the generated snippet into an execute function.")
                indented_generated_code = "    " + generated_code.replace('\n', '\n    ')
                generated_code = f"""import json
import os

def execute(input_data):
    # Code generated by AI, review carefully
    # Assuming the generated code should be indented under this function
{indented_generated_code}
    return {{'message': 'AI generated code executed, please verify output.'}}"""
            else:
                 return {
                    "status": "error",
                    "error": "Generated code is missing the required `def execute(input_data):` function definition.",
                    "details": "The AI did not produce the expected function structure. Please try rephrasing your instruction."
                }

        logger.info(f"Successfully generated code. Snippet: {generated_code[:100]}...")
        return {
            "status": "success",
            "generated_code": generated_code
        }

    except Exception as e:
        logger.error(f"LLM call failed during code generation: {e}", exc_info=True)
        error_message = str(e)
        if "auth" in error_message.lower():
             error_message = "Authentication failed with the LLM provider. Check your API key and configuration."
        elif "rate limit" in error_message.lower():
            error_message = "LLM rate limit exceeded. Please try again later."
        
        return {
            "status": "error",
            "error": f"Failed to generate code using LLM: {error_message}",
            "details": type(e).__name__
        } 