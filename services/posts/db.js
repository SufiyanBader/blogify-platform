const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://blogify:blogify@postgres:5432/blogify',
});

async function initSchema() {
  await pool.query(`
    CREATE SCHEMA IF NOT EXISTS posts;
    CREATE TABLE IF NOT EXISTS posts.posts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      author_id UUID NOT NULL,
      title VARCHAR(255) NOT NULL,
      slug VARCHAR(280) UNIQUE NOT NULL,
      body TEXT NOT NULL,
      tags TEXT[] DEFAULT '{}',
      cover_image_url TEXT,
      status VARCHAR(20) NOT NULL DEFAULT 'draft',
      published_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_posts_status ON posts.posts(status);
    CREATE INDEX IF NOT EXISTS idx_posts_author ON posts.posts(author_id);
  `);
}

module.exports = { pool, initSchema };
