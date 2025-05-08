import logging
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routes import router
from app.utils.persistence import load_data_from_disk, get_storage_summary

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)

# Create FastAPI application
app = FastAPI(title="Mini Workflow Engine Backend")

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

# Startup event
@app.on_event("startup")
async def startup_event():
    logger.info("Starting Mini Workflow Engine Backend...")
    # Load data from disk
    load_data_from_disk()
    logger.info(f"Loaded {get_storage_summary()}")

# Main entry point
if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True) 