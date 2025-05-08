import logging
import os
from typing import Dict, Any

from litellm import completion as litellm_completion

# Set up logging
logger = logging.getLogger(__name__)

async def test_model_config(model_config: Dict[str, Any]) -> Dict[str, Any]:
    """Test a model configuration by sending a simple message."""
    logger.info(f"Testing model configuration: {model_config.get('config_name')}")
    
    model = model_config.get('model')
    api_key = model_config.get('api_key')
    custom_api_base = model_config.get('api_base')
    test_message = model_config.get('test_message', 'Hi')
    
    if not model:
        raise ValueError("Model name is required")
    
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