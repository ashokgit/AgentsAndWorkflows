from fastapi import APIRouter
from app.routes import workflows, webhooks, node, api_consumer, model_config
from app.routes.webhooks_ui import router as webhooks_ui_router
from app.routes.code_execution_routes import router as code_execution_routes

# Main router that includes all other routers
router = APIRouter()

# Register all routers
router.include_router(workflows.router)
router.include_router(webhooks.router)
router.include_router(node.router)
router.include_router(api_consumer.router)
router.include_router(model_config.router)
router.include_router(code_execution_routes)

# Register UI-facing webhook router (non-api prefix)
router.include_router(webhooks_ui_router)
