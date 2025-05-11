from fastapi import APIRouter, HTTPException
from typing import Dict, Any

from app.services.api_consumer_service import test_api_connection

router = APIRouter(prefix="/api/api_consumer", tags=["test"])

@router.post("/test")
async def test_api_connection_endpoint(api_config: Dict[str, Any]):
    """Test an API connection by sending a request with the specified configuration."""
    try:
        if not api_config.get('url'):
            raise HTTPException(status_code=400, detail="API URL is required")
        
        result = await test_api_connection(api_config)
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except ConnectionError as e:
        raise HTTPException(status_code=400, detail=f"Connection error: {str(e)}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error testing API connection: {str(e)}") 