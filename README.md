# PlanPal Backend

Express REST API for PlanPal task management application.

## Tech Stack
- Node.js + Express
- Supabase (Postgres + Auth + Realtime + Storage)
- Firebase Admin (Push notifications)
- Pino (Logging)
- Zod (Validation)

## Setup

1. Copy `.env.example` to `.env` and fill in your credentials
2. Install dependencies:
   ```bash
   npm install
   ```
3. Run migrations on your Supabase project (see `/supabase/migrations/`)
4. Start development server:
   ```bash
   npm run dev
   ```

## Scripts
- `npm start` - Start production server
- `npm run dev` - Start development server with hot reload
- `npm test` - Run tests
- `npm run lint` - Lint code
- `npm run lint:fix` - Fix lint issues

## API Documentation
Base URL: `/api/v1`

See `docs/02-backend.md` for complete API documentation.

## Deployment
Deployed on Render free tier. See `docs/00-overview.md` section 8 for deployment instructions.
