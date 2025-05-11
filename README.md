# Mini Workflow Engine

A minimal n8n-like workflow automation tool with a visual editor.

## Features

*   **Visual Workflow Editor:** Design and manage workflows using a drag-and-drop interface.
*   **Webhook Trigger:** Start workflows based on incoming HTTP requests.
*   **LLM Node:** Integrate with Large Language Models (e.g., OpenAI, Anthropic).
*   **Python Code Node:** Execute custom Python scripts within a workflow.
*   **Generic Code Node:** Execute custom code snippets (details TBD, may include JavaScript).
*   **API Consumer Node:** Make HTTP requests to external APIs as part of a workflow (can function as a Webhook Action).
*   **Webhook Action:** (Covered by API Consumer Node)
*   **(Planned) Branching Logic:** Implement conditional paths in workflows.
*   **(Planned) If/Else Conditions:** Create conditional logic within workflow execution.
*   **(TBD) Messaging Integrations:** Connect with services like Slack, WhatsApp, etc.

## Tech Stack

*   **Backend:** Python (FastAPI)
*   **Frontend:** React (Vite), React Flow
*   **Database:** (TBD - Likely SQLite or PostgreSQL for persistence)

## Screenshots

Here are some glimpses of the Mini Workflow Engine in action:

*   **Simple Workflow and Logs:**
    ![Simple Workflow and Logs](./assets/ASimpleWorkflow_And_LogsScreen.png)
*   **Code Execution Configuration:**
    ![Code Execution Screen](./assets/CodeExecutionScreen.png)
*   **Node Configuration:**
    ![Node Configuration Screen](./assets/NodeConfigurationScreen.png)
*   **Webhook Setup:**
    ![Webhook Setup Screen](./assets/WebHookSetupScreen.png)
*   **Workflow Editing:**
    ![Editing Screen](./assets/EditingScreen.png)

## Setup

Everything is setup and configured for docker

Simply `docker-compose up -d` to get started.

## Contributing

We welcome contributions! Please see `CONTRIBUTING.md` for details on how to contribute, submit bug reports, or request features. (You'll need to create this file).

## License

This project is licensed under the [YOUR CHOSEN LICENSE HERE] - see the `LICENSE` file for details. (You'll need to create this file and choose a license).

