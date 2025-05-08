import logging
import json
import requests
import base64
from typing import Dict, Any
from urllib.parse import urlencode

logger = logging.getLogger(__name__)

async def test_api_connection(api_config: Dict[str, Any]) -> Dict[str, Any]:
    """Test an API connection by sending a request with the specified configuration."""
    url = api_config.get('url')
    method = api_config.get('method', 'GET').upper()
    headers = api_config.get('headers', {})
    body = api_config.get('body')
    auth_type = api_config.get('auth_type', 'none')
    timeout = int(api_config.get('timeout', 10000)) / 1000  # Convert from ms to seconds
    response_handling = api_config.get('response_handling', 'json')
    
    if not url:
        raise ValueError("API URL is required")
        
    logger.info(f"Testing API connection to {url} with method {method}")
    
    # Parse the headers if it's a string
    if isinstance(headers, str):
        try:
            headers = json.loads(headers)
        except json.JSONDecodeError:
            logger.warning("Invalid headers JSON, using empty headers")
            headers = {}
    
    # Process query parameters
    query_params = api_config.get('query_params', '{}')
    if isinstance(query_params, str):
        try:
            query_params = json.loads(query_params)
        except json.JSONDecodeError:
            logger.warning("Invalid query params JSON, using empty params")
            query_params = {}
    
    # Build the full URL with query parameters
    request_url = url
    if query_params:
        url_params = urlencode(query_params)
        if '?' in request_url:
            request_url = f"{request_url}&{url_params}"
        else:
            request_url = f"{request_url}?{url_params}"
    
    # Process the body if it's a string and meant to be JSON
    request_body = body
    if isinstance(request_body, str) and request_body.strip():
        try:
            request_body = json.loads(request_body)
        except json.JSONDecodeError:
            logger.warning("Invalid body JSON, sending as raw string")
    
    # Apply authentication based on the type
    auth = None
    if auth_type == 'api_key':
        api_key_name = api_config.get('api_key_name', 'X-API-Key')
        api_key_value = api_config.get('api_key_value', '')
        api_key_location = api_config.get('api_key_location', 'header')
        
        if api_key_location == 'header':
            headers[api_key_name] = api_key_value
        elif api_key_location == 'query':
            # Add to URL if not already added with other query params
            param = urlencode({api_key_name: api_key_value})
            if '?' in request_url:
                request_url = f"{request_url}&{param}"
            else:
                request_url = f"{request_url}?{param}"
    
    elif auth_type == 'bearer':
        bearer_token = api_config.get('bearer_token', '')
        headers['Authorization'] = f"Bearer {bearer_token}"
    
    elif auth_type == 'basic':
        username = api_config.get('basic_username', '')
        password = api_config.get('basic_password', '')
        auth = requests.auth.HTTPBasicAuth(username, password)
    
    elif auth_type == 'oauth2':
        # For OAuth2, we would need to get a token first
        client_id = api_config.get('oauth_client_id', '')
        client_secret = api_config.get('oauth_client_secret', '')
        token_url = api_config.get('oauth_token_url', '')
        scope = api_config.get('oauth_scope', '')
        
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
                    logger.error("Failed to get OAuth2 token")
                    raise ValueError("OAuth2 token acquisition failed: no access_token in response")
            except Exception as e:
                logger.error(f"OAuth2 token acquisition failed: {e}")
                raise ValueError(f"OAuth2 token acquisition failed: {str(e)}")
    
    try:
        # Set appropriate request arguments based on method
        request_kwargs = {
            'method': method,
            'url': request_url,
            'headers': headers,
            'timeout': timeout,
            'auth': auth
        }
        
        # Add body for methods that support it
        if method in ['POST', 'PUT', 'PATCH']:
            if isinstance(request_body, (dict, list)):
                request_kwargs['json'] = request_body
            elif request_body:
                request_kwargs['data'] = request_body
        
        logger.info(f"Sending {method} request to {request_url}")
        response = requests.request(**request_kwargs)
        
        # Process the response based on the specified handling method
        if response_handling == 'json':
            try:
                response_data = response.json()
            except json.JSONDecodeError:
                response_data = response.text
                logger.warning("Could not parse response as JSON, returning as text")
        elif response_handling == 'text':
            response_data = response.text
        elif response_handling == 'binary':
            # Return a preview of binary data as base64
            content_preview = response.content[:10000]  # Limit size for preview
            response_data = {
                'data_preview': base64.b64encode(content_preview).decode('utf-8'),
                'encoding': 'base64',
                'content_type': response.headers.get('Content-Type'),
                'content_length': len(response.content),
                'preview_size': len(content_preview)
            }
        else:
            response_data = response.text
        
        result = {
            "status": "success",
            "status_code": response.status_code,
            "response": response_data,
            "headers": dict(response.headers),
            "url": response.url,
            "request": {
                "method": method,
                "url": request_url,
                "headers": {k: v for k, v in headers.items() if k.lower() not in ['authorization', 'api-key', 'x-api-key']}
            }
        }
        
        return result
        
    except requests.exceptions.RequestException as e:
        logger.error(f"API request failed: {e}")
        raise ConnectionError(f"API request failed: {str(e)}")
    except Exception as e:
        logger.error(f"Error processing API request: {e}")
        raise 