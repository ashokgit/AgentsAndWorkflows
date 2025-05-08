from fastapi import APIRouter, HTTPException, Body
from typing import Dict, Any, List, Optional

from app.services.node_execution import test_llm_node

router = APIRouter(prefix="/api/node", tags=["node"])

@router.post("/llm/test")
async def test_llm_node_endpoint(
    node_data: Dict[str, Any] = Body(...),
    workflow_nodes: Optional[List[Dict[str, Any]]] = Body(None)
):
    """Test an LLM node by sending a simple message."""
    try:
        result = await test_llm_node(node_data, workflow_nodes)
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error testing LLM node: {str(e)}") 