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
import workspacesRouter from './routes/workspaces.js';
import labelsRouter from './routes/labels.js';
import syncRouter from './routes/sync.js';
import tasksRouter from './routes/tasks.js';
import eventsRouter from './routes/events.js';
import filesRouter from './routes/files.js';
import documentsRouter from './routes/documents.js';
import channelsRouter from './routes/channels.js';
import notificationsRouter from './routes/notifications.js';
import devicesRouter from './routes/devices.js';
import searchRouter from './routes/search.js';
import analyticsRouter from './routes/analytics.js';

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
  
  // Attach request ID to response header
  app.use((req, res, next) => {
    res.setHeader('X-Request-Id', req.id);
    next();
  });
  
  // Health check (no auth)
  app.use('/health', healthRouter);
  
  // API routes
  const apiRouter = express.Router();
  
  // Apply auth and rate limiting to all API routes
  apiRouter.use(authenticate);
  apiRouter.use(generalLimiter);
  
  // API endpoints
  apiRouter.use('/me', meRouter);
  apiRouter.use('/workspaces', workspacesRouter);
  apiRouter.use('/', tasksRouter); // Tasks routes (includes /tasks, /subtasks, /comments)
  apiRouter.use('/', filesRouter); // Files routes (includes /files)
  apiRouter.use('/notifications', notificationsRouter);
  apiRouter.use('/devices', devicesRouter);
  apiRouter.use('/search', searchRouter);
  
  // Nested routes under workspaces
  const workspaceNestedRouter = express.Router({ mergeParams: true });
  workspaceNestedRouter.use('/labels', labelsRouter);
  workspaceNestedRouter.use('/sync', syncRouter);
  workspaceNestedRouter.use('/events', eventsRouter);
  workspaceNestedRouter.use('/', documentsRouter); // folders and documents
  workspaceNestedRouter.use('/', channelsRouter); // channels and messages
  workspaceNestedRouter.use('/', analyticsRouter); // analytics and overview
  apiRouter.use('/workspaces/:workspaceId', workspaceNestedRouter);
  
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
