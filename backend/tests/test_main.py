from fastapi.testclient import TestClient
from unittest.mock import patch, MagicMock # Added MagicMock
from app.main import app # Corrected import path
from app.models.workflow import Workflow, Node, Edge # Added workflow models
from app.utils.persistence import workflows_db # Added for test setup/teardown

client = TestClient(app)

# Helper to create a sample workflow
def create_sample_workflow_model(id: str = "test-workflow-1", name: str = "Test Workflow") -> Workflow:
    return Workflow(
        id=id,
        name=name,
        nodes=[
            Node(id="node-1", type="inputNode", position={"x": 0, "y": 0}, data={"label": "Start"}),
            Node(id="node-2", type="outputNode", position={"x": 200, "y": 0}, data={"label": "End"})
        ],
        edges=[
            Edge(id="edge-1", source="node-1", target="node-2")
        ],
        metadata={"description": "A simple test workflow"},
        is_active=False,
        tested=False
    )

def test_read_root():
    response = client.get("/")
    assert response.status_code == 200
    assert response.json() == {"message": "Welcome to the Mini Workflow Engine Backend!"}

# You can add an __init__.py file to the tests directory if needed,
# especially if you plan to have subdirectories for tests.
# For a flat structure like this example, it might not be strictly necessary
# but is good practice for Python packages.

def test_code_execution_success():
    payload = {
        "code": "def execute(input_data):\n    return {'sum': input_data['a'] + input_data['b']}",
        "input_data": {"a": 5, "b": 10}
    }
    response = client.post("/api/node/code/test", json=payload)
    assert response.status_code == 200
    json_response = response.json()
    assert json_response["status"] == "success"
    assert json_response["result"] == {"sum": 15}
    assert json_response["error"] is None

def test_code_execution_error():
    payload = {
        "code": "def execute(input_data):\n    return 1 / 0", # Intentional division by zero
        "input_data": {}
    }
    response = client.post("/api/node/code/test", json=payload)
    assert response.status_code == 200 # The endpoint itself should still return 200
    json_response = response.json()
    assert json_response["status"] == "error"
    assert json_response["result"] is None
    assert "division by zero" in json_response["error"]

@patch('app.services.node_execution.generate_code_with_llm')
def test_generate_code_success(mock_generate_llm):
    mock_generate_llm.return_value = {
        "status": "success",
        "generated_code": "def execute(input_data):\n    return input_data",
        "error": None,
        "details": "Successfully generated code."
    }
    payload = {
        "user_instruction": "Create a simple pass-through function."
    }
    response = client.post("/api/node/code/generate", json=payload)
    assert response.status_code == 200
    json_response = response.json()
    assert json_response["status"] == "success"
    assert "def execute(input_data):" in json_response["generated_code"]
    assert json_response["error"] is None
    mock_generate_llm.assert_called_once()

@patch('app.services.node_execution.generate_code_with_llm')
def test_generate_code_error(mock_generate_llm):
    mock_generate_llm.return_value = {
        "status": "error",
        "generated_code": None,
        "error": "LLM service unavailable",
        "details": "The AI model could not be reached."
    }
    payload = {
        "user_instruction": "Create a complex function."
    }
    response = client.post("/api/node/code/generate", json=payload)
    assert response.status_code == 200 # Endpoint should still be 200
    json_response = response.json()
    assert json_response["status"] == "error"
    assert json_response["generated_code"] is None
    assert "LLM service unavailable" in json_response["error"]
    mock_generate_llm.assert_called_once()

@patch('app.routes.workflows.save_workflows_to_disk')
def test_save_workflow_and_get_workflow_details(mock_save_disk):
    workflows_db.clear() # Ensure clean state
    sample_workflow = create_sample_workflow_model()

    # 1. Save workflow
    response_save = client.post("/api/workflows", json=sample_workflow.model_dump())
    assert response_save.status_code == 201
    save_data = response_save.json()
    assert save_data["message"] == "Workflow saved successfully"
    assert save_data["workflow_id"] == sample_workflow.id
    mock_save_disk.assert_called_once()

    # 2. Get workflow by ID
    response_get = client.get(f"/api/workflows/{sample_workflow.id}")
    assert response_get.status_code == 200
    retrieved_workflow = Workflow(**response_get.json())
    assert retrieved_workflow.id == sample_workflow.id
    assert retrieved_workflow.name == sample_workflow.name
    assert len(retrieved_workflow.nodes) == len(sample_workflow.nodes)

    # 3. List workflows and check if it's there
    response_list = client.get("/api/workflows")
    assert response_list.status_code == 200
    list_data = response_list.json()
    assert isinstance(list_data, list)
    assert any(wf['id'] == sample_workflow.id for wf in list_data)
    workflows_db.clear() # Cleanup

@patch('app.routes.workflows.save_workflows_to_disk')
def test_import_single_workflow(mock_save_disk):
    workflows_db.clear()
    workflow_to_import = create_sample_workflow_model(id="imported-wf", name="Imported Workflow")
    
    response = client.post("/api/workflows/import_single", json=workflow_to_import.model_dump())
    assert response.status_code == 200
    import_data = response.json()
    assert import_data["message"] == "Workflow imported successfully"
    assert import_data["workflow_id"] == workflow_to_import.id
    mock_save_disk.assert_called_once()

    # Verify it was actually added/updated
    response_get = client.get(f"/api/workflows/{workflow_to_import.id}")
    assert response_get.status_code == 200
    retrieved_workflow = Workflow(**response_get.json())
    assert retrieved_workflow.name == workflow_to_import.name
    workflows_db.clear()

@patch('app.routes.workflows.save_workflows_to_disk') # Still need to mock save even if not called for this path
def test_get_nonexistent_workflow(mock_save_disk):
    workflows_db.clear()
    response = client.get("/api/workflows/non-existent-id")
    assert response.status_code == 404
    assert response.json()["detail"] == "Workflow not found"
    workflows_db.clear() 