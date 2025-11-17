# Docker Multi-Service Application Debug Summary

## Major Problems & Solutions

### Problem 1: Postgres Version Incompatibility

**Error:**

```
postgres-1 | Error: in 18+, these Docker images are configured to store database data in a format which is compatible with "pg_ctlcluster"
```

**Root Cause:** PostgreSQL 18+ changed data storage format, incompatible with existing volumes.

**Solution:**

```yaml
postgres:
  image: "postgres:16" # Use specific version, not latest
```

**Commands:**

```bash
docker compose down -v
docker compose up
```

---

### Problem 2: Node.js Version Too New

**Error:**

```
Error: No such module: http_parser
```

**Root Cause:** Node.js v25 removed `http_parser` module that old `webpack-dev-server` depends on.

**Solution:** Create proper `Dockerfile.dev`:

```dockerfile
FROM node:16-alpine
WORKDIR /app
COPY package.json .
RUN npm install
COPY . .
CMD ["npm", "start"]
```

**Commands:**

```bash
docker compose build --no-cache client
docker compose up
```

---

### Problem 3: Postgres Connection Timeout (MAIN ISSUE)

**Error:**

```
Connection terminated due to connection timeout
```

**Troubleshooting Process:**

#### Step 1: Check if Postgres service works

```bash
docker compose exec postgres psql -U postgres -c "SELECT 1"
```

✅ Result: Works fine

#### Step 2: Check network connectivity

```bash
docker compose exec api ping -c 3 postgres
docker compose exec api nc -zv postgres 5432
```

✅ Result: Network and port both open

#### Step 3: Check environment variables

```bash
docker compose exec api env | grep PG
```

✅ Result: All correct

#### Step 4: Test with hardcoded credentials

```bash
docker compose exec api node -e "
const { Pool } = require('pg');
const pool = new Pool({
  user: 'postgres',
  host: 'postgres',
  database: 'postgres',
  password: 'postgres_password',
  port: 5432,
  connectionTimeoutMillis: 5000
});
pool.connect((err, client, done) => {
  if (err) console.log('FAILED:', err.message);
  else console.log('SUCCESS');
});
"
```

❌ Result: Still timeout

#### Step 5: Check package versions

```bash
cat ./server/package.json
```

**Root Cause:** `pg: 7.4.3` (2018) incompatible with `postgres:16` (2023)

**Solution:** Upgrade pg package

```json
{
  "dependencies": {
    "pg": "8.7.3"
  }
}
```

**Commands:**

```bash
docker compose down
docker compose build --no-cache api
docker compose up
```

---

## Key Troubleshooting Commands

### Container Management

```bash
docker compose up                          # Start services
docker compose up --build                  # Rebuild and start
docker compose down                        # Stop services
docker compose down -v                     # Stop and remove volumes
docker compose build --no-cache [service]  # Rebuild without cache
docker compose restart [service]           # Restart specific service
docker compose logs [service]              # View logs
docker compose logs -f [service]           # Follow logs
docker compose ps                          # Check status
```

### Database Operations

```bash
# Postgres
docker compose exec postgres psql -U postgres
docker compose exec postgres psql -U postgres -c "SELECT 1"
docker compose exec postgres psql -U postgres -c "CREATE TABLE values (number INT);"

# Inside psql
\dt                    # List tables
SELECT * FROM table;   # Query data
\q                     # Quit

# Redis
docker compose exec redis redis-cli
# Inside redis-cli
PING                   # Test connection
HGETALL values         # Get hash data
KEYS *                 # List all keys
exit                   # Quit
```

### Network Diagnostics

```bash
docker compose exec [service] ping -c 3 [target]
docker compose exec [service] nc -zv [host] [port]
docker compose exec [service] env | grep [VAR]
```

### Testing APIs

```bash
curl http://localhost:3050/api/values/all
curl http://localhost:3050/api/values/current
```

---

## Recommended Package Versions

### Docker Images

```yaml
postgres: "postgres:16"
redis: "redis:6-alpine"
node: "node:16-alpine"
```

### NPM Packages (server)

```json
{
  "dependencies": {
    "express": "4.16.3",
    "pg": "8.7.3",
    "redis": "2.8.0",
    "cors": "2.8.4",
    "nodemon": "1.18.3",
    "body-parser": "*"
  }
}
```

### NPM Packages (client)

```json
{
  "dependencies": {
    "react": "^16.14.0",
    "react-dom": "^16.14.0",
    "react-scripts": "4.0.3",
    "react-router-dom": "4.3.1",
    "axios": "0.21.1"
  }
}
```

---

## Final Working docker-compose.yml

```yaml
version: "3.8"
services:
  postgres:
    image: "postgres:16"
    environment:
      - POSTGRES_PASSWORD=postgres_password
    volumes:
      - postgres-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 10s
      timeout: 5s
      retries: 5

  redis:
    image: "redis:6-alpine"
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5

  nginx:
    restart: always
    build:
      dockerfile: Dockerfile.dev
      context: ./nginx
    ports:
      - "3050:80"
    depends_on:
      - api
      - client

  api:
    build:
      dockerfile: Dockerfile.dev
      context: ./server
    volumes:
      - /app/node_modules
      - ./server:/app
    environment:
      - REDIS_HOST=redis
      - REDIS_PORT=6379
      - PGUSER=postgres
      - PGHOST=postgres
      - PGDATABASE=postgres
      - PGPASSWORD=postgres_password
      - PGPORT=5432
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy

  client:
    build:
      dockerfile: Dockerfile.dev
      context: ./client
    volumes:
      - /app/node_modules
      - ./client:/app
    environment:
      - CHOKIDAR_USEPOLLING=true

  worker:
    build:
      dockerfile: Dockerfile.dev
      context: ./worker
    volumes:
      - /app/node_modules
      - ./worker:/app
    environment:
      - REDIS_HOST=redis
      - REDIS_PORT=6379
    depends_on:
      redis:
        condition: service_healthy

volumes:
  postgres-data:
```

---

## Key Lessons

1. **Never use `latest` tags** - Always specify exact versions
2. **Check package compatibility** - Old client libraries may not work with new servers
3. **Systematic debugging** - Test from service → network → client library
4. **Network ≠ Connection** - Port open doesn't mean protocol compatible
5. **Check logs first** - Most errors have clear messages

---

## Debugging Flow

```
1. Check service logs
   ↓
2. Verify service works independently
   ↓
3. Test network connectivity (ping, nc)
   ↓
4. Check environment variables
   ↓
5. Test with hardcoded values
   ↓
6. Check package versions
   ↓
7. Upgrade incompatible packages
```
