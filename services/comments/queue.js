const amqp = require('amqplib');

const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://blogify:blogify@rabbitmq:5672';
const EXCHANGE = 'blogify.events';

let channel = null;

async function connectQueue(retries = 10, delayMs = 3000) {
  for (let i = 0; i < retries; i++) {
    try {
      const conn = await amqp.connect(RABBITMQ_URL);
      channel = await conn.createChannel();
      await channel.assertExchange(EXCHANGE, 'topic', { durable: true });
      console.log('Comments: connected to RabbitMQ');
      conn.on('close', () => {
        console.warn('Comments: RabbitMQ connection closed, retrying...');
        channel = null;
        setTimeout(() => connectQueue(), delayMs);
      });
      return;
    } catch (err) {
      console.warn(`Comments: RabbitMQ connect attempt ${i + 1} failed: ${err.message}`);
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
  console.error('Comments: could not connect to RabbitMQ after retries — continuing without events');
}

function publishEvent(routingKey, payload) {
  if (!channel) {
    console.warn(`Comments: channel not ready, dropping event ${routingKey}`);
    return false;
  }
  channel.publish(EXCHANGE, routingKey, Buffer.from(JSON.stringify(payload)), { persistent: true });
  return true;
}

module.exports = { connectQueue, publishEvent };
