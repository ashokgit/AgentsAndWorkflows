from fastapi.testclient import TestClient
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