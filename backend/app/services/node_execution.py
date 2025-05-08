import logging
import time
import requests
import os
import json
from typing import Any, Dict, Optional, List
import base64
from urllib.parse import urlencode
import re # Added for templating

from app.models.workflow import Node, Workflow, NodeExecutionResult
from app.utils.persistence import webhook_payloads
from litellm import completion as litellm_completion

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
        if node_type == 'input' or node_type == 'trigger':
            output_data = input_data 
            logger.info(f"Node {node.id} ({node_type}) passing data through.")
        
        elif node_type == 'webhook_trigger':
            # For a webhook trigger, the relevant data is typically the input_data provided
            # to this execution step (which might have come from the actual webhook callback
            # or from a test signal). We don't need to re-fetch from persistence here.
            output_data = input_data 
            logger.info(f"Webhook Trigger Node {node.id} ({node_label}): Using provided input data.")

        elif node_type == 'llm':
            output_data = execute_llm_node(node, input_data, workflow, run_outputs)
        
        elif node_type == 'model_config':
            # Model config nodes are primarily data holders, not operational steps.
            # They shouldn't block the flow. Their data is accessed by linked LLM nodes.
            # We return a success message, but this node type is handled differently in the execution loop.
            config_name = node_data.get('config_name', 'Unnamed Configuration')
            model = node_data.get('model', 'unknown')
            output_data = {
                "status": "Configured",
                "message": f"Model configuration '{config_name}' ({model}) processed.",
                "config_data": node_data # Pass the config data itself
            }
            logger.info(f"Model Config Node {node.id} ({config_name}): Data processed (not executed in flow).")
        
        elif node_type == 'code':
            # Placeholder - needs sandboxing and actual execution
            code = node_data.get('code', 'pass')
            # Simulate execution, potentially using input_data
            try:
                # Safer simulation: just report the code and input
                output_data = {"result": f"Simulated execution of code: {code[:50]}...", "input_received_summary": str(input_data)[:100]}
                logger.info(f"Simulating Code node {node.id}: {output_data}")
                time.sleep(0.1) # Simulate work
            except Exception as code_exec_e:
                logger.error(f"Simulated Code node {node.id}: Error during execution: {code_exec_e}")
                output_data = {"error": f"Error executing code: {code_exec_e}", "original_input": input_data}
                raise # Re-raise to mark node as failed

        elif node_type == 'webhook_action':
            output_data = execute_webhook_action_node(node, input_data, run_outputs)
        
        elif node_type == 'api_consumer':
            output_data = execute_api_consumer_node(node, input_data, run_outputs)
        
        elif node_type == 'default':
            # Default node logs the input and passes it through
            logger.info(f"Default node {node.id} ({node_label}) received: {str(input_data)[:100]}...")
            output_data = {"logged_input_summary": str(input_data)[:100]} # Log and pass summary
        
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
        raise ValueError("URL is required for webhook_action")
    
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