# Production Deployment Guide

## Pre-Deployment Checklist

### Environment Setup

#### 1. Environment Variables
```env
# Required Production Variables
NODE_ENV=production
PORT=3000

# Supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_KEY=your-service-key

# Database
DATABASE_URL=postgresql://user:pass@host:5432/database

# JWT
JWT_SECRET=your-secure-jwt-secret-min-32-chars

# CORS
CORS_ORIGINS=https://app.planpal.com,https://admin.planpal.com

# File Upload
UPLOAD_DIR=/var/app/uploads
MAX_FILE_SIZE=10485760

# Optional: Redis Cache
REDIS_URL=redis://localhost:6379

# Optional: Logging
LOG_LEVEL=info
```

#### 2. Database Migrations

**Run migrations in order:**
```bash
# Connect to production database
psql $DATABASE_URL

# Run each migration
\i migrations/001_initial_schema.sql
\i migrations/002_create_labels.sql
\i migrations/003_create_comments_activities.sql
\i migrations/004_create_attachments_and_links.sql
\i migrations/005_create_analytics_events.sql
\i migrations/006_analytics_aggregation_functions.sql
\i migrations/007_create_sync_infrastructure.sql
\i migrations/008_create_mentions.sql
\i migrations/009_enhance_activity_feed.sql
\i migrations/010_create_user_preferences.sql
\i migrations/011_create_custom_fields.sql
\i migrations/012_create_task_templates.sql
\i migrations/013_create_time_tracking.sql
\i migrations/014_create_saved_views.sql
```

**Verify migrations:**
```sql
-- Check all tables exist
SELECT tablename FROM pg_tables WHERE schemaname = 'public';

-- Check RLS is enabled
SELECT tablename FROM pg_tables 
WHERE schemaname = 'public' AND rowsecurity = true;
```

#### 3. Install Dependencies
```bash
cd BACKEND
npm ci --production
```

#### 4. Build (if using TypeScript)
```bash
npm run build
```

---

## Deployment Options

### Option 1: Render.com (Recommended for Quick Start)

**Steps:**
1. Connect GitHub repository
2. Set build command: `npm install`
3. Set start command: `npm start`
4. Add environment variables in Render dashboard
5. Enable auto-deploy on push to main

**Render Configuration:**
```yaml
# render.yaml
services:
  - type: web
    name: planpal-api
    env: node
    buildCommand: npm install
    startCommand: npm start
    envVars:
      - key: NODE_ENV
        value: production
      - key: SUPABASE_URL
        sync: false
      - key: SUPABASE_SERVICE_KEY
        sync: false
```

### Option 2: AWS (Production Scale)

**Components:**
- **Compute:** Elastic Beanstalk or ECS
- **Database:** RDS PostgreSQL (or Supabase hosted)
- **File Storage:** S3
- **CDN:** CloudFront
- **Load Balancer:** ALB
- **Monitoring:** CloudWatch

**Deployment Steps:**
```bash
# Install EB CLI
pip install awsebcli

# Initialize
eb init

# Create environment
eb create planpal-prod

# Deploy
eb deploy
```

### Option 3: Docker

**Dockerfile:**
```dockerfile
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --production

COPY . .

EXPOSE 3000

CMD ["npm", "start"]
```

**Build and Run:**
```bash
docker build -t planpal-api .
docker run -p 3000:3000 --env-file .env planpal-api
```

**Docker Compose:**
```yaml
version: '3.8'
services:
  api:
    build: .
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
    env_file:
      - .env.production
    restart: unless-stopped
```

---

## Post-Deployment Setup

### 1. Cron Jobs

**Auto-stop old timers (hourly):**
```bash
# crontab -e
0 * * * * psql $DATABASE_URL -c "SELECT auto_stop_old_timers();"
```

**Refresh materialized views (hourly):**
```bash
0 * * * * psql $DATABASE_URL -c "REFRESH MATERIALIZED VIEW CONCURRENTLY activity_feed_recent;"
0 * * * * psql $DATABASE_URL -c "REFRESH MATERIALIZED VIEW CONCURRENTLY popular_templates;"
```

**Cleanup old activities (daily at 2 AM):**
```bash
0 2 * * * psql $DATABASE_URL -c "DELETE FROM activities WHERE created_at < NOW() - INTERVAL '90 days';"
```

### 2. Monitoring Setup

**Health Check Endpoint:**
```http
GET /health
```

**Expected Response:**
```json
{
  "status": "ok",
  "timestamp": "2024-01-15T10:00:00Z",
  "database": "connected",
  "uptime": 3600
}
```

**Monitoring Tools:**
- **Uptime:** UptimeRobot, Pingdom
- **APM:** New Relic, Datadog
- **Logs:** Papertrail, Loggly
- **Errors:** Sentry

### 3. Backup Strategy

**Database Backups:**
```bash
# Daily backup
0 3 * * * pg_dump $DATABASE_URL > /backups/planpal_$(date +\%Y\%m\%d).sql

# Keep last 30 days
find /backups -name "planpal_*.sql" -mtime +30 -delete
```

**File Uploads Backup:**
```bash
# Sync to S3 daily
0 4 * * * aws s3 sync /var/app/uploads s3://planpal-backups/uploads/
```

### 4. SSL/TLS Configuration

**Let's Encrypt (Free):**
```bash
# Install certbot
sudo apt-get install certbot

# Get certificate
sudo certbot certonly --standalone -d api.planpal.com

# Auto-renewal
sudo certbot renew --dry-run
```

**Nginx Configuration:**
```nginx
server {
    listen 443 ssl http2;
    server_name api.planpal.com;

    ssl_certificate /etc/letsencrypt/live/api.planpal.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.planpal.com/privkey.pem;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

---

## Production Verification

### API Tests
```bash
# Health check
curl https://api.planpal.com/health

# Authentication test
curl -H "Authorization: Bearer $TOKEN" \
  https://api.planpal.com/api/v1/me

# Create test task
curl -X POST https://api.planpal.com/api/v1/tasks \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"workspace_id":"xxx","title":"Test Task"}'
```

### Performance Tests
```bash
# Response time test
curl -w "@curl-format.txt" -o /dev/null -s \
  https://api.planpal.com/api/v1/tasks

# Load test with k6
k6 run --vus 10 --duration 30s load-tests/api.js
```

### Security Tests
```bash
# SSL test
curl -I https://api.planpal.com

# Security headers check
curl -I https://api.planpal.com | grep -i "x-frame-options\|x-content-type-options"
```

---

## Rollback Procedure

### Quick Rollback
```bash
# Render
render rollback <service-id>

# AWS Elastic Beanstalk
eb deploy --version previous-version

# Docker
docker pull planpal-api:previous-tag
docker-compose up -d
```

### Database Rollback
```bash
# Restore from backup
psql $DATABASE_URL < /backups/planpal_YYYYMMDD.sql
```

---

## Scaling Recommendations

### Horizontal Scaling
- **API:** Multiple instances behind load balancer
- **Database:** Read replicas for read-heavy operations
- **File Storage:** CDN (CloudFront, Cloudflare)

### Vertical Scaling
- **API:** Increase CPU/RAM as needed
- **Database:** Upgrade instance size

### Performance Optimization
- Enable Redis caching
- Implement CDN for static assets
- Use database connection pooling
- Enable gzip compression

---

## Security Hardening

### Production Checklist
- [ ] HTTPS enforced
- [ ] Security headers enabled (Helmet.js)
- [ ] Rate limiting configured
- [ ] CORS properly restricted
- [ ] Environment variables secured
- [ ] Database backups automated
- [ ] Monitoring and alerting set up
- [ ] Error tracking configured (Sentry)
- [ ] Firewall rules configured
- [ ] SSH keys only (no password auth)
- [ ] OS security updates automated
- [ ] Dependency vulnerability scanning
- [ ] Regular security audits

---

## Troubleshooting

### Common Issues

**1. Database Connection Failures**
```bash
# Check connection
psql $DATABASE_URL

# Check connection pool
SELECT count(*) FROM pg_stat_activity;
```

**2. High Memory Usage**
```bash
# Check Node.js memory
pm2 monit

# Increase memory limit
node --max-old-space-size=4096 src/server.js
```

**3. Slow Queries**
```sql
-- Find slow queries
SELECT query, calls, total_time, mean_time
FROM pg_stat_statements
ORDER BY mean_time DESC
LIMIT 10;
```

**4. Rate Limit Issues**
```bash
# Check rate limit logs
grep "Too many requests" /var/log/planpal/api.log

# Adjust limits in production config
```

---

## Support & Maintenance

### Regular Tasks
- **Daily:** Check error logs, monitor uptime
- **Weekly:** Review performance metrics, check disk space
- **Monthly:** Security updates, dependency updates, backup verification
- **Quarterly:** Security audit, performance optimization review

### Emergency Contacts
- Database: Supabase Support
- Hosting: Render/AWS Support
- DNS: Cloudflare Support

---

## Status: Ready for Production ✅

All deployment procedures documented and tested.
