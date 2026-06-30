import logging
import os
import threading
from contextlib import asynccontextmanager

from fastapi import FastAPI
from dotenv import load_dotenv

from consumer import run_consumer

load_dotenv()
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("notification-worker")

RABBITMQ_URL = os.getenv("RABBITMQ_URL", "amqp://blogify:blogify@rabbitmq:5672")
APP_VERSION = os.getenv("APP_VERSION", "1.0.0")

stats = {"connected": False, "processed": 0, "flagged": 0, "last_event": None}
stop_event = threading.Event()
consumer_thread: threading.Thread | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global consumer_thread
    consumer_thread = threading.Thread(
        target=run_consumer, args=(RABBITMQ_URL, stats, stop_event), daemon=True
    )
    consumer_thread.start()
    logger.info("Notification worker started, consumer thread running")
    yield
    stop_event.set()
    if consumer_thread:
        consumer_thread.join(timeout=5)


app = FastAPI(title="Blogify Notification Worker", lifespan=lifespan)


@app.get("/health")
def health():
    # 'ok' as long as the process is up; 'connected' reflects the RabbitMQ link specifically.
    # The blue-green deploy script only checks for HTTP 200, so we keep it lenient — the worker
    # is allowed to be briefly disconnected while RabbitMQ itself restarts.
    return {
        "status": "ok",
        "service": "notification-worker",
        "version": APP_VERSION,
        "rabbitmq_connected": stats["connected"],
    }


@app.get("/stats")
def get_stats():
    return stats
