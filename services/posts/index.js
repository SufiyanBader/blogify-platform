require('dotenv').config();
const express = require('express');
const slugify = require('slugify');
const Redis = require('ioredis');
const { pool, initSchema } = require('./db');
const { requireAuth, optionalAuth } = require('./auth-middleware');

const app = express();
app.use(express.json());

const redis = new Redis(process.env.REDIS_URL || 'redis://redis:6379');
const FEED_CACHE_TTL = 30; // seconds

let dbReady = false;
initSchema()
  .then(() => { dbReady = true; console.log('Posts: schema ready'); })
  .catch(err => console.error('Posts: schema init failed', err));

app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', service: 'posts', version: process.env.APP_VERSION || '1.0.0', db: dbReady });
  } catch (err) {
    res.status(503).json({ status: 'error', error: err.message });
  }
});

// GET /posts — published feed (cached in Redis)
app.get('/posts', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 10, 50);
    const offset = (page - 1) * limit;
    const cacheKey = `feed:page:${page}:limit:${limit}`;

    const cached = await redis.get(cacheKey);
    if (cached) return res.json(JSON.parse(cached));

    const result = await pool.query(
      `SELECT id, author_id, title, slug, tags, cover_image_url, published_at
       FROM posts.posts WHERE status = 'published'
       ORDER BY published_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    await redis.set(cacheKey, JSON.stringify(result.rows), 'EX', FEED_CACHE_TTL);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /posts/:slug — single post
app.get('/posts/:slug', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM posts.posts WHERE slug = $1', [req.params.slug]);
    if (!result.rows[0]) return res.status(404).json({ error: 'Post not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /posts — create a draft (requires auth)
app.post('/posts', requireAuth, async (req, res) => {
  try {
    const { title, body, tags, coverImageUrl } = req.body;
    if (!title || !body) return res.status(400).json({ error: 'title and body are required' });

    let slug = slugify(title, { lower: true, strict: true });
    const existing = await pool.query('SELECT id FROM posts.posts WHERE slug = $1', [slug]);
    if (existing.rows.length > 0) slug = `${slug}-${Date.now().toString(36)}`;

    const result = await pool.query(
      `INSERT INTO posts.posts (author_id, title, slug, body, tags, cover_image_url)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [req.user.sub, title, slug, body, tags || [], coverImageUrl || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /posts/:id — update a post (author only)
app.put('/posts/:id', requireAuth, async (req, res) => {
  try {
    const post = await pool.query('SELECT author_id FROM posts.posts WHERE id = $1', [req.params.id]);
    if (!post.rows[0]) return res.status(404).json({ error: 'Post not found' });
    if (post.rows[0].author_id !== req.user.sub) return res.status(403).json({ error: 'Not your post' });

    const { title, body, tags, coverImageUrl } = req.body;
    const result = await pool.query(
      `UPDATE posts.posts SET title = COALESCE($1, title), body = COALESCE($2, body),
       tags = COALESCE($3, tags), cover_image_url = COALESCE($4, cover_image_url), updated_at = now()
       WHERE id = $5 RETURNING *`,
      [title, body, tags, coverImageUrl, req.params.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /posts/:id/publish — publish a draft
app.post('/posts/:id/publish', requireAuth, async (req, res) => {
  try {
    const post = await pool.query('SELECT author_id FROM posts.posts WHERE id = $1', [req.params.id]);
    if (!post.rows[0]) return res.status(404).json({ error: 'Post not found' });
    if (post.rows[0].author_id !== req.user.sub) return res.status(403).json({ error: 'Not your post' });

    const result = await pool.query(
      `UPDATE posts.posts SET status = 'published', published_at = now() WHERE id = $1 RETURNING *`,
      [req.params.id]
    );
    // Invalidate feed cache so the new post appears immediately
    const keys = await redis.keys('feed:page:*');
    if (keys.length) await redis.del(...keys);

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /posts/:id
app.delete('/posts/:id', requireAuth, async (req, res) => {
  try {
    const post = await pool.query('SELECT author_id FROM posts.posts WHERE id = $1', [req.params.id]);
    if (!post.rows[0]) return res.status(404).json({ error: 'Post not found' });
    if (post.rows[0].author_id !== req.user.sub) return res.status(403).json({ error: 'Not your post' });

    await pool.query('DELETE FROM posts.posts WHERE id = $1', [req.params.id]);
    res.json({ message: 'Post deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 4002;
app.listen(PORT, () => console.log(`Posts service v${process.env.APP_VERSION || '1.0.0'} on port ${PORT}`));
