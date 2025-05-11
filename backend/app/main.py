import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routes import router
from app.utils.persistence import load_workflows_from_disk, get_storage_summary

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)

@asynccontextmanager
async def lifespan(app_instance: FastAPI):
    # Code here runs on startup
    logger.info("Starting Mini Workflow Engine Backend...")
    load_workflows_from_disk()
    logger.info(f"Loaded {get_storage_summary()}")
    yield
    # Code here runs on shutdown (if any)
    logger.info("Mini Workflow Engine Backend shutting down...")

# Create FastAPI application
app = FastAPI(title="Mini Workflow Engine Backend", lifespan=lifespan)

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, specify frontend URL
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include all routes
app.include_router(router)

# Root endpoint
@app.get("/")
async def read_root():
    return {"message": "Welcome to the Mini Workflow Engine Backend!"}

# Main entry point
if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True) 