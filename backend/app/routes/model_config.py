from fastapi import APIRouter, HTTPException
from typing import Dict, Any

from app.services.model_config_service import test_model_config

router = APIRouter(prefix="/api/model_config", tags=["model_config"])

@router.post("/test")
async def test_model_config_endpoint(model_config: Dict[str, Any]):
    """Test a model configuration by sending a simple message."""
    try:
        if not model_config.get('model'):
            raise HTTPException(status_code=400, detail="Model name is required")
        
        result = await test_model_config(model_config)
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error testing model configuration: {str(e)}") 