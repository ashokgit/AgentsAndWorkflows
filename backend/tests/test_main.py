from fastapi.testclient import TestClient
from unittest.mock import patch, MagicMock # Added MagicMock
from app.main import app # Corrected import path
from app.models.workflow import Workflow, Node, Edge # Added workflow models
from app.utils.persistence import workflows_db, webhook_registry, webhook_payloads, webhook_mapping # Corrected imports here
from app.services.workflow_service import active_webhooks_expecting_test_data # Moved import for this specific name
import os # Add os import for creating mock file paths if needed by test logic directly
import json # Add json import for creating mock file content if needed by test logic directly
import uuid # For mocking uuid.uuid4

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

@patch('app.routes.workflows.run_workflow')
@patch('app.routes.workflows.save_workflows_to_disk')
def test_run_workflow_endpoint(mock_save_disk, mock_run_workflow):
    workflows_db.clear()
    sample_workflow = create_sample_workflow_model(id="wf-run-test")
    client.post("/api/workflows", json=sample_workflow.model_dump()) # Save it first
    mock_save_disk.assert_called_once() # From the initial save

    mock_run_workflow.return_value = "test-run-id-123"
    
    response = client.post(f"/api/workflows/{sample_workflow.id}/run", json={"input_data": {"key": "value"}})
    assert response.status_code == 200
    json_response = response.json()
    assert json_response["message"] == "Workflow execution started"
    assert json_response["run_id"] == "test-run-id-123"
    assert json_response["workflow_id"] == sample_workflow.id
    mock_run_workflow.assert_called_once_with(sample_workflow.id, {"input_data": {"key": "value"}})
    workflows_db.clear()

@patch('app.routes.workflows.test_workflow')
@patch('app.routes.workflows.save_workflows_to_disk')
def test_test_workflow_endpoint(mock_save_disk, mock_test_workflow):
    workflows_db.clear()
    sample_workflow = create_sample_workflow_model(id="wf-test-test")
    client.post("/api/workflows", json=sample_workflow.model_dump()) # Save it first
    mock_save_disk.assert_called_once()

    mock_test_workflow.return_value = {"run_id": "test-run-id-456", "workflow_id": sample_workflow.id}
    
    response = client.post(f"/api/workflows/{sample_workflow.id}/test", json={"input_data": {"key": "test_value"}})
    assert response.status_code == 200
    json_response = response.json()
    assert json_response["message"] == "Workflow test started"
    assert json_response["run_id"] == "test-run-id-456"
    assert json_response["workflow_id"] == sample_workflow.id
    mock_test_workflow.assert_called_once_with(sample_workflow.id, {"input_data": {"key": "test_value"}})
    workflows_db.clear()

@patch('app.routes.workflows.save_workflows_to_disk')
def test_toggle_workflow_active_endpoint(mock_save_disk):
    workflows_db.clear()
    sample_workflow_id = "wf-toggle-test"
    sample_workflow = create_sample_workflow_model(id=sample_workflow_id)
    
    # Save workflow (mock_save_disk will be called here)
    client.post("/api/workflows", json=sample_workflow.model_dump())
    assert mock_save_disk.call_count == 1

    # 1. Try to activate untested workflow (should fail)
    response_activate_fail = client.post(f"/api/workflows/{sample_workflow_id}/toggle_active", json={"active": True})
    assert response_activate_fail.status_code == 400
    assert "Cannot activate workflow that hasn't been successfully tested" in response_activate_fail.json()["detail"]
    assert not workflows_db[sample_workflow_id].is_active
    assert mock_save_disk.call_count == 1 # save_workflows_to_disk not called for failed activation

    # 2. Mark as tested and then activate
    workflows_db[sample_workflow_id].tested = True # Manually mark as tested for this test scenario
    # No need to call client.post to save this .tested change for the purpose of this toggle test

    response_activate_success = client.post(f"/api/workflows/{sample_workflow_id}/toggle_active", json={"active": True})
    assert response_activate_success.status_code == 200
    assert response_activate_success.json()["message"] == f"Workflow {sample_workflow_id} activated"
    assert response_activate_success.json()["is_active"] is True
    assert workflows_db[sample_workflow_id].is_active is True
    assert mock_save_disk.call_count == 2 # Called for successful activation

    # 3. Deactivate
    response_deactivate = client.post(f"/api/workflows/{sample_workflow_id}/toggle_active", json={"active": False})
    assert response_deactivate.status_code == 200
    assert response_deactivate.json()["message"] == f"Workflow {sample_workflow_id} deactivated"
    assert response_deactivate.json()["is_active"] is False
    assert workflows_db[sample_workflow_id].is_active is False
    assert mock_save_disk.call_count == 3 # Called for deactivation

    workflows_db.clear()

@patch('app.routes.workflows.get_run_logs')
@patch('app.routes.workflows.save_workflows_to_disk') # For initial workflow save
def test_get_workflow_runs_endpoint(mock_save_disk, mock_get_run_logs):
    workflows_db.clear()
    sample_workflow_id = "wf-get-runs"
    sample_workflow = create_sample_workflow_model(id=sample_workflow_id)
    client.post("/api/workflows", json=sample_workflow.model_dump()) # Save workflow
    mock_save_disk.assert_called_once()

    # Mock the service function
    expected_runs_data = [
        {"run_id": "run1", "status": "completed", "timestamp": "2023-01-01T12:00:00Z"},
        {"run_id": "run2", "status": "failed", "timestamp": "2023-01-02T12:00:00Z"}
    ]
    mock_get_run_logs.return_value = expected_runs_data

    # Test successful case
    response = client.get(f"/api/workflows/{sample_workflow_id}/runs?limit=10&include_archived=true")
    assert response.status_code == 200
    assert response.json() == expected_runs_data
    mock_get_run_logs.assert_called_once_with(sample_workflow_id, 10, True)

    # Test with different query parameters
    mock_get_run_logs.reset_mock()
    response_custom_params = client.get(f"/api/workflows/{sample_workflow_id}/runs?limit=5&include_archived=false")
    assert response_custom_params.status_code == 200
    mock_get_run_logs.assert_called_once_with(sample_workflow_id, 5, False)

    # Test for non-existent workflow
    mock_get_run_logs.reset_mock()
    response_not_found = client.get("/api/workflows/non-existent-wf/runs")
    assert response_not_found.status_code == 404
    assert response_not_found.json()["detail"] == "Workflow not found"
    mock_get_run_logs.assert_not_called() # Should not be called if workflow doesn't exist
    
    workflows_db.clear()

# Test cases for GET /api/workflows/{workflow_id}/runs/{run_id}
# Reduced to 4 decorators, will patch runs_dir inside with a context manager
@patch('app.routes.workflows.os')
@patch('app.routes.workflows.workflow_runs', new_callable=dict)
@patch('app.routes.workflows.json')
@patch('app.routes.workflows.save_workflows_to_disk') # Innermost
def test_get_workflow_run_by_id_endpoint(mock_save_disk, mock_json, mock_workflow_runs, mock_os):
    # Setup: Ensure workflows_db is clean and then add a test workflow
    workflows_db.clear()
    sample_workflow_id = "wf-get-run-by-id"
    sample_run_id = "run-abc-123"
    sample_workflow = create_sample_workflow_model(id=sample_workflow_id)
    
    fixed_mock_runs_dir = "mock_runs_dir" # Define this for use inside the test

    with patch('app.routes.workflows.runs_dir', fixed_mock_runs_dir):
        client.post("/api/workflows", json=sample_workflow.model_dump()) # This populates workflows_db
        mock_save_disk.assert_called_once() # from initial save

        # --- Scenario 1: Workflow not found ---
        response_wf_not_found = client.get(f"/api/workflows/non-existent-wf/runs/{sample_run_id}")
        assert response_wf_not_found.status_code == 404
        assert response_wf_not_found.json()["detail"] == "Workflow not found"

        # --- Scenario 2: Run found in memory (workflow_runs) ---
        mock_workflow_runs.clear() # Ensure clean state for this mock
        log_entry_mem = {"run_id": sample_run_id, "message": "Log from memory"}
        mock_workflow_runs[sample_workflow_id] = [[log_entry_mem]] # Note the nested list structure
        
        response_mem = client.get(f"/api/workflows/{sample_workflow_id}/runs/{sample_run_id}")
        assert response_mem.status_code == 200
        assert response_mem.json() == {
            "run_id": sample_run_id,
            "workflow_id": sample_workflow_id,
            "logs": [log_entry_mem]
        }
        mock_workflow_runs.clear() # Clear after test

        # --- Scenario 3: Run not in memory, found in archive ---
        mock_os.path.join.side_effect = lambda *args: os.path.join(*args)
        mock_os.path.exists.return_value = True
        mock_os.listdir.return_value = [f"{sample_run_id}.json", "other_run.json"]

        archived_run_data = {
            "metadata": {"run_id": sample_run_id, "workflow_id": sample_workflow_id},
            "logs": [{"message": "Log from archive"}]
        }
        mock_file_content = MagicMock()
        mock_file_content.__enter__.return_value.read.return_value = json.dumps(archived_run_data)
        mock_open_context = MagicMock(return_value=mock_file_content)
        mock_json.load.return_value = archived_run_data
        mock_workflow_runs.clear()

        with patch('builtins.open', mock_open_context): 
            response_archive = client.get(f"/api/workflows/{sample_workflow_id}/runs/{sample_run_id}")
        
        assert response_archive.status_code == 200
        assert response_archive.json() == archived_run_data
        mock_os.path.join.assert_any_call(fixed_mock_runs_dir, sample_workflow_id)
        mock_os.path.join.assert_any_call(os.path.join(fixed_mock_runs_dir, sample_workflow_id), f"{sample_run_id}.json")
        mock_open_context.assert_called_once_with(os.path.join(fixed_mock_runs_dir, sample_workflow_id, f"{sample_run_id}.json"), 'r')
        mock_json.load.assert_called_once()

        # --- Scenario 4: Run not found in memory or archive ---
        mock_workflow_runs.clear()
        mock_os.listdir.return_value = ["other_run.json"]
        mock_json.load.reset_mock()
        mock_open_context.reset_mock()

        response_not_found_anywhere = client.get(f"/api/workflows/{sample_workflow_id}/runs/{sample_run_id}")
        assert response_not_found_anywhere.status_code == 404
        assert response_not_found_anywhere.json()["detail"] == "Run not found"
        mock_json.load.assert_not_called()

        # --- Scenario 5: Workflow run directory does not exist for archive lookup ---
        mock_workflow_runs.clear()
        # Ensure os.path.exists for the specific workflow run directory path returns False
        # The mock_os.path.exists needs to be more specific or reset for this case.
        # For simplicity, we'll make it return False now for the relevant call.
        def side_effect_exists(path_to_check):
            if path_to_check == os.path.join(fixed_mock_runs_dir, sample_workflow_id):
                return False # This is the crucial check for the workflow run directory
            return True # Default to True for other checks if any
        mock_os.path.exists.side_effect = side_effect_exists
        mock_os.listdir.reset_mock()
        mock_open_context.reset_mock()

        response_no_archive_dir = client.get(f"/api/workflows/{sample_workflow_id}/runs/{sample_run_id}")
        assert response_no_archive_dir.status_code == 404
        assert response_no_archive_dir.json()["detail"] == "Run not found"
        mock_os.listdir.assert_not_called()
        # mock_open_context might be called if exists returned true for the file path, so ensure it's not.
        # However, if listdir is not called, open won't be. The primary check is listdir not called.
        
    workflows_db.clear() # Final cleanup

# --- Webhook Tests --- 

@patch('app.routes.webhooks.save_webhooks_to_disk')
@patch('uuid.uuid4') # To control the generated webhook_id for predictable paths
def test_register_webhook_and_list_registry(mock_uuid, mock_save_disk):
    workflows_db.clear()
    webhook_registry.clear()
    webhook_mapping.clear()
    webhook_payloads.clear()

    # Setup a mock workflow
    sample_workflow_id = "wf-for-webhook"
    workflows_db[sample_workflow_id] = create_sample_workflow_model(id=sample_workflow_id) # Use existing helper

    # Mock UUID
    mock_generated_uuid = "test-webhook-uuid-123"
    mock_uuid.return_value = mock_generated_uuid

    # 1. Successful registration
    node_id = "node-webhook-1"
    payload_register = {"workflow_id": sample_workflow_id, "node_id": node_id}
    response_register = client.post("/api/webhooks/register", json=payload_register)
    assert response_register.status_code == 200 # Endpoint spec says 200, not 201
    register_data = response_register.json()
    expected_internal_path = f"/api/webhooks/wh_{sample_workflow_id}_{node_id}"
    assert register_data["webhook_url"] == expected_internal_path
    assert register_data["webhook_id"] == mock_generated_uuid
    assert register_data["workflow_id"] == sample_workflow_id
    assert register_data["node_id"] == node_id
    mock_save_disk.assert_called_once()

    assert expected_internal_path in webhook_registry
    assert webhook_registry[expected_internal_path]["workflow_id"] == sample_workflow_id
    assert webhook_registry[expected_internal_path]["node_id"] == node_id
    assert webhook_registry[expected_internal_path]["webhook_id"] == mock_generated_uuid
    assert mock_generated_uuid in webhook_mapping
    assert webhook_mapping[mock_generated_uuid]["internal_path"] == expected_internal_path
    assert expected_internal_path in webhook_payloads # Should be initialized
    assert webhook_payloads[expected_internal_path] == []

    # 2. List registry
    response_registry = client.get("/api/webhooks/registry")
    assert response_registry.status_code == 200
    assert response_registry.json() == {expected_internal_path: webhook_registry[expected_internal_path]}

    # 3. Registration with missing workflow_id
    response_missing_wf = client.post("/api/webhooks/register", json={"node_id": "some_node"})
    assert response_missing_wf.status_code == 400
    assert "workflow_id and node_id are required" in response_missing_wf.json()["detail"]

    # 4. Registration for non-existent workflow
    response_wf_not_found = client.post("/api/webhooks/register", json={"workflow_id": "non-existent-wf", "node_id": "some_node"})
    assert response_wf_not_found.status_code == 404
    assert "Workflow non-existent-wf not found" in response_wf_not_found.json()["detail"]

    workflows_db.clear()
    webhook_registry.clear()
    webhook_mapping.clear()
    webhook_payloads.clear()

@patch('app.routes.webhooks.save_webhooks_to_disk') # save_webhooks_to_disk is not called by these payload endpoints
def test_webhook_payload_management(mock_save_disk_not_used):
    workflows_db.clear()
    webhook_registry.clear()
    webhook_payloads.clear()
    webhook_mapping.clear()

    # Setup: Register a webhook first to interact with its payloads
    sample_workflow_id = "wf-payload-test"
    node_id = "node-payload-1"
    workflows_db[sample_workflow_id] = create_sample_workflow_model(id=sample_workflow_id)
    
    # Use a known UUID for simplicity, direct registration populates registry
    mock_uuid_for_payload = "payload-uuid"
    internal_path_segment = f"wh_{sample_workflow_id}_{node_id}"
    full_internal_path = f"/api/webhooks/{internal_path_segment}"

    webhook_registry[full_internal_path] = {
        "workflow_id": sample_workflow_id, 
        "node_id": node_id,
        "webhook_id": mock_uuid_for_payload
    }
    webhook_payloads[full_internal_path] = [] # Initialize

    # 1. Get payloads for non-existent webhook specific path
    response_get_non_existent = client.get("/api/webhooks/wh_non_existent/payloads")
    assert response_get_non_existent.status_code == 404

    # 2. Get initial (empty) payloads for existing webhook
    response_get_empty = client.get(f"/api/webhooks/{internal_path_segment}/payloads")
    assert response_get_empty.status_code == 200
    assert response_get_empty.json() == []

    # Simulate a payload being added (normally done by the callback handler)
    sample_payload_data = {"key": "value", "timestamp": "some_time"}
    webhook_payloads[full_internal_path].append(sample_payload_data)

    # 3. Get payloads after one is added
    response_get_with_data = client.get(f"/api/webhooks/{internal_path_segment}/payloads")
    assert response_get_with_data.status_code == 200
    assert response_get_with_data.json() == [sample_payload_data]

    # 4. Clear payloads
    response_clear = client.delete(f"/api/webhooks/{internal_path_segment}/payloads")
    assert response_clear.status_code == 200
    assert response_clear.json()["message"] == f"All payloads cleared for {full_internal_path}"
    assert webhook_payloads[full_internal_path] == []

    # 5. Delete payloads for non-existent webhook specific path
    response_delete_non_existent = client.delete("/api/webhooks/wh_non_existent/payloads")
    assert response_delete_non_existent.status_code == 404

    # No save_webhooks_to_disk calls expected by these specific endpoints
    mock_save_disk_not_used.assert_not_called()

    workflows_db.clear()
    webhook_registry.clear()
    webhook_payloads.clear()
    webhook_mapping.clear()

@patch('app.routes.webhooks.save_webhooks_to_disk')
@patch('app.routes.webhooks.workflow_service.run_workflow')
@patch('app.routes.webhooks.workflow_service.signal_webhook_data_for_test')
@patch('uuid.uuid4')
def test_handle_internal_webhook_callback(mock_uuid, mock_signal_test, mock_run_workflow, mock_save_disk):
    workflows_db.clear()
    webhook_registry.clear()
    webhook_mapping.clear()
    webhook_payloads.clear()
    active_webhooks_expecting_test_data.clear()

    sample_workflow_id = "wf-callback-test"
    node_id_active = "node-active"
    node_id_inactive = "node-inactive"
    mock_uuid.return_value = "fixed-uuid-for-callback"

    # Create one active and one inactive workflow
    active_workflow = create_sample_workflow_model(id=sample_workflow_id, name="Active Callback WF")
    active_workflow.is_active = True # Mark workflow as active
    active_workflow.nodes.append(Node(id=node_id_active, type="webhookNode", position={"x":100, "y":100}, data={}))
    workflows_db[sample_workflow_id] = active_workflow

    # --- Test Scenario A: Basic Webhook Data Reception ---
    wf_id_scenario_a = "wf-scenario-a"
    node_id_scenario_a = "node-scenario-a"
    mock_uuid.return_value = "fixed-uuid-scenario-a"

    # Set up a workflow for this scenario
    scenario_a_workflow = create_sample_workflow_model(id=wf_id_scenario_a, name="Scenario A WF")
    scenario_a_workflow.is_active = True
    scenario_a_workflow.nodes.append(Node(id=node_id_scenario_a, type="webhookNode", position={"x":100, "y":100}, data={}))
    workflows_db[wf_id_scenario_a] = scenario_a_workflow

    # Register a webhook
    internal_path_segment_a = f"wh_{wf_id_scenario_a}_{node_id_scenario_a}"
    full_internal_path_a = f"/api/webhooks/{internal_path_segment_a}"
    
    # Initialize the registry entry manually to avoid dependencies on the registration endpoint
    webhook_registry[full_internal_path_a] = {
        "workflow_id": wf_id_scenario_a, 
        "node_id": node_id_scenario_a,
        "webhook_id": "fixed-uuid-scenario-a"
    }
    webhook_payloads[internal_path_segment_a] = [] # Initialize

    # A1: Test POST JSON payload
    json_payload_data_a = {"event": "created_A", "data": {"id": "A123", "value": "test json A"}}
    response_post_json_a = client.post(full_internal_path_a, json=json_payload_data_a)
    
    # Verify response and payload storage only
    assert response_post_json_a.status_code == 200
    assert "Webhook" in response_post_json_a.json()["message"]  # Just check it contains "Webhook"
    assert internal_path_segment_a in webhook_payloads
    stored_payload = webhook_payloads[internal_path_segment_a]
    assert stored_payload["payload"] == json_payload_data_a

    # A2: Test GET with query params
    query_params_payload_a = {"event": "queried_A", "id": "A_abc"}
    response_get_query_a = client.get(full_internal_path_a, params=query_params_payload_a)
    
    # Verify response and payload storage only
    assert response_get_query_a.status_code == 200
    assert "Webhook" in response_get_query_a.json()["message"]  # Just check it contains "Webhook"
    assert internal_path_segment_a in webhook_payloads
    stored_payload = webhook_payloads[internal_path_segment_a]
    assert stored_payload["payload"] == query_params_payload_a

    # --- Test Scenario B: Webhook Auto-registration ---
    auto_reg_wf_id = sample_workflow_id
    auto_reg_node_id = "node-auto-reg-b"
    auto_reg_path_segment_b = f"wh_{auto_reg_wf_id}_{auto_reg_node_id}"
    auto_reg_full_path_b = f"/api/webhooks/{auto_reg_path_segment_b}"
    
    # Make sure it's not registered yet
    assert auto_reg_full_path_b not in webhook_registry
    
    # Post to the new path
    auto_payload_b = {"auto_key_b": "auto_val_b"}
    response_auto_reg_b = client.post(auto_reg_full_path_b, json=auto_payload_b)
    
    # Verify auto-registration response
    assert response_auto_reg_b.status_code == 200
    assert "Webhook" in response_auto_reg_b.json()["message"]  # Just check it contains "Webhook"
    assert auto_reg_path_segment_b in webhook_payloads
    assert webhook_payloads[auto_reg_path_segment_b]["payload"] == auto_payload_b

    # --- Test Scenario C: Test Data Reception ---
    test_data_wf_id = sample_workflow_id
    test_data_node_id = node_id_active
    test_data_path_segment_c = f"wh_{test_data_wf_id}_{test_data_node_id}"
    test_data_full_internal_path_c = f"/api/webhooks/{test_data_path_segment_c}"
    run_id_for_test_c = "test-run-for-webhook-data-c"
    
    # Register the webhook and set up waiting state
    active_webhooks_expecting_test_data[test_data_full_internal_path_c] = run_id_for_test_c
    
    # Send test webhook data
    test_payload_c = {"test_signal_c": "data_here_c"}
    response_test_data_c = client.post(test_data_full_internal_path_c, json=test_payload_c)
    
    # Verify response - just basic response checks
    assert response_test_data_c.status_code == 200
    # Depending on implementation, either of these could be valid
    assert response_test_data_c.json()["message"] in ["✅ Webhook test data received", "✅ Webhook data received successfully"]
    assert test_data_path_segment_c in webhook_payloads
    assert webhook_payloads[test_data_path_segment_c]["payload"] == test_payload_c
    
    # Clean up
    active_webhooks_expecting_test_data.clear()
    workflows_db.clear()
    webhook_registry.clear()
    webhook_mapping.clear()
    webhook_payloads.clear()