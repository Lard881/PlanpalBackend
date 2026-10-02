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
import tasksRouter from './routes/tasks.js';
import labelsRouter from './routes/labels.js';
import workspacesRouter from './routes/workspaces.js';
import invitesRouter from './routes/invites.js';
import commentsRouter from './routes/comments.js';
import notificationsRouter from './routes/notifications.js';
import deviceTokensRouter from './routes/device-tokens.js';
import pushRouter from './routes/push.js';
import attachmentsRouter from './routes/attachments.js';
import searchRouter from './routes/search.js';
import analyticsRouter from './routes/analytics.js';
import syncRouter from './routes/sync.js';
import remindersRouter from './routes/reminders.js';

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
  apiRouter.use('/tasks', tasksRouter);
  apiRouter.use('/labels', labelsRouter);
  apiRouter.use('/workspaces', workspacesRouter);
  apiRouter.use('/invites', invitesRouter);
  apiRouter.use('/comments', commentsRouter);
  apiRouter.use('/notifications', notificationsRouter);
  apiRouter.use('/device-tokens', deviceTokensRouter);
  apiRouter.use('/push', pushRouter);
  apiRouter.use('/', attachmentsRouter); // Handles /tasks/:id/attachments and /attachments/:id
  apiRouter.use('/search', searchRouter);
  apiRouter.use('/analytics', analyticsRouter);
  apiRouter.use('/sync', syncRouter);
  apiRouter.use('/reminders', remindersRouter);
  
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
