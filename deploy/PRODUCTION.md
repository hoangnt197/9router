# 9router production deployment

The production service is intentionally internal-only. The compose file uses
host networking but binds the application to `127.0.0.1:20129`; PostgreSQL and
Redis must also remain loopback-only or on a private network.

## Required runtime configuration

Create `deploy/.env.production` with mode `0600` and provide:

- `NINE_ROUTER_DATABASE_URL` — required PostgreSQL source of truth.
- `NINE_ROUTER_REDIS_URL` — shared Redis for multi-instance cache invalidation.
- `JWT_SECRET`, `INITIAL_PASSWORD`, `API_KEY_SECRET`, and `MACHINE_ID_SALT`.

Never commit this file or copy it into an image.

## Operations

```bash
cd /opt/9router-prod/app/deploy
docker compose -f docker-compose.production.yml up -d --build
docker compose -f docker-compose.production.yml ps
curl --fail http://127.0.0.1:20129/api/health
docker compose -f docker-compose.production.yml logs -f --tail=100
```

The container uses `restart: unless-stopped`, a health check, capped logs, an
8-connection PostgreSQL pool per instance, and a 2 GiB memory ceiling. Do not
expose port 20129 publicly; terminate TLS and enforce access control in a
reverse proxy when the service is promoted.
