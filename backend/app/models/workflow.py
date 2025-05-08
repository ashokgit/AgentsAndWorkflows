from pydantic import BaseModel
from typing import List, Dict, Any, Optional
from datetime import datetime

class Node(BaseModel):
    id: str
    type: str
    position: Dict[str, float]
    data: Dict[str, Any]

class Edge(BaseModel):
    id: str
    source: str
    target: str
    sourceHandle: Optional[str] = None
    targetHandle: Optional[str] = None

class Workflow(BaseModel):
    id: str
    name: str
    nodes: List[Node]
    edges: List[Edge]
    # We might store viewport info etc. from the frontend too
    metadata: Optional[Dict[str, Any]] = None
    # Active state for the workflow
    is_active: bool = False
    # Flag to track if the workflow has been fully tested
    tested: bool = False
    # Timestamp when last tested successfully
    last_tested: Optional[datetime] = None
    
    class Config:
        # Allow arbitrary types for data fields
        arbitrary_types_allowed = True
        
        # Custom JSON encoders
        json_encoders = {
            datetime: lambda dt: dt.isoformat(),
        }
    
    def dict(self, **kwargs):
        """Custom dict method to handle nested serialization"""
        result = super().dict(**kwargs)
        return result
        
    @classmethod
    def parse_obj(cls, obj):
        """Custom parse method to handle nested deserialization"""
        return super().parse_obj(obj)

class NodeExecutionResult(BaseModel):
    output: Any
    next_node_id: Optional[str] = None  # For simple linear flow for now
    # Later: Add support for multiple outputs/branching (e.g., based on sourceHandle)

class WebhookRegistration(BaseModel):
    workflow_id: str
    node_id: str 