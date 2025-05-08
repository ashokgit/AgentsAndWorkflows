from fastapi import APIRouter

from app.routes.workflows import router as workflows_router
from app.routes.webhooks import router_api as webhooks_api_router
from app.routes.webhooks import router_webhooks as webhooks_router
from app.routes.model_config import router as model_config_router

router = APIRouter()

# Include all routers
router.include_router(workflows_router)
router.include_router(webhooks_api_router)
router.include_router(webhooks_router)
router.include_router(model_config_router)
