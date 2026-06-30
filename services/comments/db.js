const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://blogify:blogify@postgres:5432/blogify',
});

async function initSchema() {
  await pool.query(`
    CREATE SCHEMA IF NOT EXISTS comments;
    CREATE TABLE IF NOT EXISTS comments.comments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      post_id UUID NOT NULL,
      author_id UUID NOT NULL,
      parent_id UUID REFERENCES comments.comments(id) ON DELETE CASCADE,
      body TEXT NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'visible',
      created_at TIMESTAMPTZ DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_comments_post ON comments.comments(post_id);
    CREATE INDEX IF NOT EXISTS idx_comments_parent ON comments.comments(parent_id);
  `);
}

module.exports = { pool, initSchema };
