import { createApp } from './app.js';
import { config } from './config/env.js';
import { logger } from './lib/logger.js';

const app = createApp();

let server;

// Start server
function start() {
  server = app.listen(config.port, () => {
    logger.info(`🚀 PlanPal API running on port ${config.port}`);
    logger.info(`📝 Environment: ${config.nodeEnv}`);
    logger.info(`🔗 Health check: http://localhost:${config.port}/health`);
  });
}

// Graceful shutdown
function shutdown() {
  logger.info('📴 Shutting down gracefully...');
  
  if (server) {
    server.close(() => {
      logger.info('✅ Server closed');
      process.exit(0);
    });
    
    // Force close after 10 seconds
    setTimeout(() => {
      logger.error('❌ Forced shutdown');
      process.exit(1);
    }, 10000);
  } else {
    process.exit(0);
  }
}

// Handle shutdown signals
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  logger.error({ err: error }, 'Uncaught exception');
  shutdown();
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error({ reason, promise }, 'Unhandled rejection');
});

start();
