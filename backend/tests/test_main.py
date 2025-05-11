from fastapi.testclient import TestClient
from unittest.mock import patch # Added for mocking
from app.main import app # Corrected import path

client = TestClient(app)

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