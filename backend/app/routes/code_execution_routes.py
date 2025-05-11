from fastapi import APIRouter, HTTPException, Body
from pydantic import BaseModel
from typing import Any, Dict, Optional, List

from app.services.node_execution import test_code_node_in_docker

import logging

logger = logging.getLogger(__name__)

router = APIRouter(prefix='/api')

class CodeTestPayload(BaseModel):
    code: str
    input_data: Dict[str, Any] = {}
    requirements: Optional[str] = None
    node_id: Optional[str] = None # Keep consistent with frontend payload

class CodeTestResponse(BaseModel):
    status: str
    result: Optional[Any] = None
    error: Optional[str] = None
    details: Optional[Any] = None

class AICodeGenerationPayload(BaseModel):
    available_inputs_schema: Dict[str, Any] = {}
    current_code: Optional[str] = ''
    user_instruction: str
    node_id: Optional[str] = None # For logging/context
    model_config_id: Optional[str] = None # New: To use a specific model config
    workflow_nodes: Optional[List[Dict[str, Any]]] = None # New: For resolving model_config_id

class AICodeGenerationResponse(BaseModel):
    status: str
    generated_code: Optional[str] = None
    error: Optional[str] = None
    details: Optional[str] = None

@router.post("/node/code/test", response_model=CodeTestResponse, tags=["test"])
async def test_code_execution_endpoint(payload: CodeTestPayload = Body(...)):
    """
    Receives Python code, input data, and requirements, then executes it
    in a sandboxed Docker environment.
    """
    logger.info(f"Received code test request for node_id: {payload.node_id or 'N/A'}. Code snippet: {payload.code[:100]}...")
    
    try:
        # Potentially get timeout from settings if you add it there
        # timeout_seconds = settings.CODE_EXECUTION_TIMEOUT 
        timeout_seconds = 60 # Defaulting to 60 seconds as discussed

        execution_result = await test_code_node_in_docker(
            code=payload.code,
            input_data=payload.input_data,
            requirements=payload.requirements,
            timeout_seconds=timeout_seconds
        )
        
        # The test_code_node_in_docker function is expected to return a dict
        # that matches the CodeTestResponse structure.
        if execution_result.get("status") == "success":
            logger.info(f"Code test successful for node_id: {payload.node_id or 'N/A'}. Result: {str(execution_result.get('result'))[:100]}...")
            return CodeTestResponse(**execution_result)
        else:
            logger.error(f"Code test failed for node_id: {payload.node_id or 'N/A'}. Error: {execution_result.get('error')}, Details: {execution_result.get('details')}")
            return CodeTestResponse(**execution_result)

    except Exception as e:
        logger.error(f"Unhandled exception in /node/code/test endpoint: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"An unexpected error occurred on the server: {str(e)}")

@router.post("/node/code/generate", response_model=AICodeGenerationResponse, tags=["test"])
async def generate_code_with_ai_endpoint(payload: AICodeGenerationPayload = Body(...)):
    logger.info(f"Received AI code generation request for node: {payload.node_id or 'N/A'}. Instruction: {payload.user_instruction[:100]}...")
    try:
        from app.services.node_execution import generate_code_with_llm # Import here to avoid circular dependency if any

        # You might want to fetch model, api_key, etc., from a central config or model_config node if applicable
        # For now, let's assume the service function handles LLM specifics or uses defaults.
        llm_result = await generate_code_with_llm(
            available_inputs_schema=payload.available_inputs_schema,
            current_code=payload.current_code,
            user_instruction=payload.user_instruction,
            model_config_id=payload.model_config_id, # Pass to service
            workflow_nodes=payload.workflow_nodes # Pass to service
        )

        if llm_result.get("status") == "success":
            logger.info(f"AI code generation successful for node: {payload.node_id or 'N/A'}. Generated code snippet: {llm_result.get('generated_code')[:100]}...")
            return AICodeGenerationResponse(**llm_result)
        else:
            logger.error(f"AI code generation failed for node: {payload.node_id or 'N/A'}. Error: {llm_result.get('error')}")
            return AICodeGenerationResponse(**llm_result)

    except ImportError as ie:
        logger.error(f"Failed to import generate_code_with_llm: {ie}", exc_info=True)
        raise HTTPException(status_code=500, detail="Code generation service not available.")
    except Exception as e:
        logger.error(f"Unhandled exception in /node/code/generate endpoint: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"An unexpected error occurred during AI code generation: {str(e)}")

# Example of how you might include this router in your main app (e.g., backend/app/main.py):
# from app.routes import code_execution_routes
# app.include_router(code_execution_routes.router, prefix="/api") 
# Note: The path above in @router.post already includes /node/code/test, so if you prefix with /api
# the full path would be /api/node/code/test. Adjust as per your existing structure. 