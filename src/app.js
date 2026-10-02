import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { config } from './config/env.js';
import { httpLogger } from './lib/logger.js';
import { errorHandler } from './middleware/errorHandler.js';
import { authenticate } from './middleware/auth.js';
import { generalLimiter } from './middleware/rateLimit.js';

// Routes
import healthRouter from './routes/health.js';
import meRouter from './routes/me.js';

export function createApp() {
  const app = express();
  
  // Security
  app.use(helmet());
  app.use(cors({
    origin: config.cors.origins,
    credentials: true,
  }));
  
  // Trust proxy (Render is behind a proxy)
  app.set('trust proxy', 1);
  
  // Body parsing
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));
  
  // Logging
  app.use(httpLogger);
  
  // Health check (no auth)
  app.use('/health', healthRouter);
  
  // API routes
  const apiRouter = express.Router();
  
  // Apply auth and rate limiting to all API routes
  apiRouter.use(authenticate);
  apiRouter.use(generalLimiter);
  
  // API endpoints
  apiRouter.use('/me', meRouter);
  
  app.use('/api/v1', apiRouter);
  
  // 404 handler
  app.use((req, res) => {
    res.status(404).json({
      error: {
        code: 'NOT_FOUND',
        message: 'Route not found',
        requestId: req.id || 'unknown',
      },
    });
  });
  
  // Error handler (must be last)
  app.use(errorHandler);
  
  return app;
}
