import json
import logging
import threading
import time

import pika

logger = logging.getLogger("notification-worker.consumer")

RABBITMQ_URL = None
EXCHANGE = "blogify.events"
QUEUE = "notification.comment_created"
ROUTING_KEY = "comment.created"

# Simple in-process moderation: flag comments containing any of these words.
BLOCKLIST = {"spam", "viagra", "casino"}


def moderate(body: str) -> str:
    lowered = body.lower()
    return "flagged" if any(word in lowered for word in BLOCKLIST) else "approved"


def handle_message(channel, method, properties, body, stats):
    try:
        event = json.loads(body)
        decision = moderate(event.get("body", ""))
        stats["processed"] += 1
        stats["last_event"] = {
            "commentId": event.get("commentId"),
            "postId": event.get("postId"),
            "decision": decision,
        }
        if decision == "flagged":
            stats["flagged"] += 1
            logger.warning("Comment %s flagged by moderation", event.get("commentId"))
        else:
            logger.info(
                "Notification: would email author of post %s about new comment %s",
                event.get("postId"), event.get("commentId")
            )
        channel.basic_ack(delivery_tag=method.delivery_tag)
    except Exception as exc:
        logger.error("Failed to process message: %s", exc)
        channel.basic_nack(delivery_tag=method.delivery_tag, requeue=False)


def run_consumer(rabbitmq_url: str, stats: dict, stop_event: threading.Event):
    while not stop_event.is_set():
        try:
            params = pika.URLParameters(rabbitmq_url)
            connection = pika.BlockingConnection(params)
            channel = connection.channel()
            channel.exchange_declare(exchange=EXCHANGE, exchange_type="topic", durable=True)
            channel.queue_declare(queue=QUEUE, durable=True)
            channel.queue_bind(exchange=EXCHANGE, queue=QUEUE, routing_key=ROUTING_KEY)
            channel.basic_qos(prefetch_count=10)

            stats["connected"] = True
            logger.info("Connected to RabbitMQ, consuming queue=%s", QUEUE)

            def callback(ch, method, properties, body):
                handle_message(ch, method, properties, body, stats)

            channel.basic_consume(queue=QUEUE, on_message_callback=callback)

            while not stop_event.is_set():
                connection.process_data_events(time_limit=1)

        except Exception as exc:
            stats["connected"] = False
            logger.warning("RabbitMQ connection lost or failed: %s. Retrying in 5s...", exc)
            time.sleep(5)
