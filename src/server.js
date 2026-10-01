import { createApp } from './app.js';
import { config } from './config/env.js';
import { logger } from './lib/logger.js';
import { wsServer } from './lib/websocket.js';
import { startPushScheduler, stopPushScheduler } from './workers/push-scheduler.js';
import { startReminderScheduler, stopReminderScheduler } from './workers/reminder-scheduler.js';

const app = createApp();

let server;

// Start server
function start() {
  server = app.listen(config.port, () => {
    logger.info(`🚀 PlanPal API running on port ${config.port}`);
    logger.info(`📝 Environment: ${config.nodeEnv}`);
    logger.info(`🔗 Health check: http://localhost:${config.port}/health`);
    
    // Initialize WebSocket server
    wsServer.initialize(server);
    wsServer.startHeartbeat();
    logger.info('🔌 WebSocket server started on /ws');
    
    // Start push notification scheduler
    startPushScheduler(1); // Run every 1 minute
    logger.info('🔔 Push notification scheduler started');
    
    // Start reminder scheduler
    startReminderScheduler(5); // Run every 5 minutes
    logger.info('⏰ Reminder scheduler started');
  });
}

// Graceful shutdown
function shutdown() {
  logger.info('📴 Shutting down gracefully...');
  
  // Stop schedulers
  stopPushScheduler();
  stopReminderScheduler();
  
  // Shutdown WebSocket server
  wsServer.shutdown();
  
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
