# Blogify — Platform (app repo)

A microservices blogging/CMS platform. This repo holds the application code; deployment infrastructure lives in the sibling [`blogify-infra`](../blogify-infra) repo.

## Services

| Service | Language | Port | Responsibility |
|---|---|---|---|
| `auth` | Node/Express | 4001 | Registration, login, JWT issuance |
| `posts` | Node/Express | 4002 | Post CRUD, drafts, publishing, feed caching |
| `comments` | Node/Express | 4003 | Threaded comments, publishes `comment.created` events |
| `media` | Node/Express | 4004 | Image uploads to MinIO (S3-compatible) |
| `notification-worker` | **Python/FastAPI** | 4005 | Consumes RabbitMQ events, moderates + "notifies" |

## Shared infrastructure (local dev, via docker-compose)

- **PostgreSQL** — one database, one schema per service (`auth.*`, `posts.*`, `comments.*`)
- **Redis** — sessions + feed cache
- **RabbitMQ** — `comment.created` events from comments → notification-worker
- **MinIO** — S3-compatible object storage for images
- **Nginx** — single entrypoint at `/api/*`

## Run locally

```bash
cp .env.example .env
docker compose up -d --build

# Wait ~20s for all healthchecks to pass, then test:
curl http://localhost/health

# Register a user
curl -X POST http://localhost/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"a@b.com","password":"secret123","displayName":"Bader"}'

# Login
curl -X POST http://localhost/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"a@b.com","password":"secret123"}'
# -> copy the returned token

# Create a post (replace TOKEN)
curl -X POST http://localhost/api/posts/posts \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer TOKEN" \
  -d '{"title":"Hello world","body":"My first post"}'
```

RabbitMQ management UI: http://localhost:15672 (blogify/blogify)
MinIO console: http://localhost:9001 (blogify/blogify123)

## API routes (via gateway, port 80)

```
POST   /api/auth/register
POST   /api/auth/login
POST   /api/auth/logout
GET    /api/auth/verify

GET    /api/posts/posts
GET    /api/posts/posts/:slug
POST   /api/posts/posts
PUT    /api/posts/posts/:id
POST   /api/posts/posts/:id/publish
DELETE /api/posts/posts/:id

GET    /api/posts/:postId/comments
POST   /api/posts/:postId/comments
DELETE /api/comments/comments/:id

POST   /api/media/media        (multipart form, field name "file")
DELETE /api/media/media/:objectName
```

## CI/CD

`.github/workflows/build-and-push.yml`:
1. Detects which service folders changed
2. Builds + pushes only those images to Docker Hub, tagged with short commit SHA + `latest`
3. Fires a `repository_dispatch` event to `blogify-infra`, which picks it up and runs the blue-green deployment

### Required GitHub secrets (this repo)

| Secret | Purpose |
|---|---|
| `DOCKERHUB_USERNAME` | Docker Hub username |
| `DOCKERHUB_TOKEN` | Docker Hub access token |
| `INFRA_REPO_PAT` | A GitHub Personal Access Token (repo scope) with write access to `blogify-infra`, used to fire the dispatch event |
| `INFRA_REPO_OWNER` | Your GitHub username/org (so the workflow can address `OWNER/blogify-infra`) |
