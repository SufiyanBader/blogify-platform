require('dotenv').config();
const express = require('express');
const jwt = require('jsonwebtoken');
const { pool, initSchema } = require('./db');
const { connectQueue, publishEvent } = require('./queue');

const app = express();
app.use(express.json());

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-prod';

let dbReady = false;
initSchema()
  .then(() => { dbReady = true; console.log('Comments: schema ready'); })
  .catch(err => console.error('Comments: schema init failed', err));

connectQueue();

function requireAuth(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Missing token' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', service: 'comments', version: process.env.APP_VERSION || '1.0.0', db: dbReady });
  } catch (err) {
    res.status(503).json({ status: 'error', error: err.message });
  }
});

// GET /posts/:postId/comments — threaded list
app.get('/posts/:postId/comments', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM comments.comments WHERE post_id = $1 AND status = 'visible' ORDER BY created_at ASC`,
      [req.params.postId]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /posts/:postId/comments — create a comment (optionally a reply via parentId)
app.post('/posts/:postId/comments', requireAuth, async (req, res) => {
  try {
    const { body, parentId } = req.body;
    if (!body) return res.status(400).json({ error: 'body is required' });

    const result = await pool.query(
      `INSERT INTO comments.comments (post_id, author_id, parent_id, body) VALUES ($1, $2, $3, $4) RETURNING *`,
      [req.params.postId, req.user.sub, parentId || null, body]
    );
    const comment = result.rows[0];

    // Fire-and-forget event for the notification worker to consume
    publishEvent('comment.created', {
      commentId: comment.id,
      postId: comment.post_id,
      authorId: comment.author_id,
      parentId: comment.parent_id,
      body: comment.body,
      createdAt: comment.created_at
    });

    res.status(201).json(comment);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /comments/:id — soft delete (author only)
app.delete('/comments/:id', requireAuth, async (req, res) => {
  try {
    const existing = await pool.query('SELECT author_id FROM comments.comments WHERE id = $1', [req.params.id]);
    if (!existing.rows[0]) return res.status(404).json({ error: 'Comment not found' });
    if (existing.rows[0].author_id !== req.user.sub) return res.status(403).json({ error: 'Not your comment' });

    await pool.query(`UPDATE comments.comments SET status = 'deleted' WHERE id = $1`, [req.params.id]);
    res.json({ message: 'Comment deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 4003;
app.listen(PORT, () => console.log(`Comments service v${process.env.APP_VERSION || '1.0.0'} on port ${PORT}`));
