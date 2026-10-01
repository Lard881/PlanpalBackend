import admin from 'firebase-admin';
import { adminClient } from './supabase.js';
import logger from './logger.js';
import { config } from '../config/env.js';

// Initialize Firebase Admin (only once)
let firebaseInitialized = false;

function initializeFirebase() {
  if (firebaseInitialized) return;

  try {
    // Check if service account credentials are provided
    if (!config.firebase?.serviceAccount) {
      logger.warn('Firebase service account not configured. Push notifications disabled.');
      return;
    }

    admin.initializeApp({
      credential: admin.credential.cert(config.firebase.serviceAccount),
    });

    firebaseInitialized = true;
    logger.info('Firebase Admin SDK initialized successfully');
  } catch (error) {
    logger.error('Failed to initialize Firebase Admin SDK:', error);
    throw error;
  }
}

/**
 * Send push notification to a single device
 * @param {string} token - Device token
 * @param {Object} notification - Notification payload
 * @param {string} notification.title - Notification title
 * @param {string} notification.body - Notification body
 * @param {Object} data - Additional data payload
 * @returns {Promise<Object>} Send result
 */
async function sendToDevice(token, notification, data = {}) {
  if (!firebaseInitialized) {
    initializeFirebase();
  }

  if (!firebaseInitialized) {
    throw new Error('Firebase not initialized');
  }

  try {
    const message = {
      token: token,
      notification: {
        title: notification.title,
        body: notification.body,
      },
      data: {
        ...data,
        // Convert all data values to strings (FCM requirement)
        ...Object.keys(data).reduce((acc, key) => {
          acc[key] = String(data[key]);
          return acc;
        }, {}),
      },
      android: {
        priority: 'high',
        notification: {
          sound: 'default',
          channelId: 'planpal_notifications',
        },
      },
      apns: {
        payload: {
          aps: {
            sound: 'default',
            badge: 1,
          },
        },
      },
    };

    const response = await admin.messaging().send(message);
    logger.debug(`Push sent successfully to token ${token.substring(0, 10)}...`);
    return { success: true, messageId: response };
  } catch (error) {
    logger.error(`Failed to send push to token ${token.substring(0, 10)}...:`, error.message);

    // Check for invalid token errors
    const isInvalidToken =
      error.code === 'messaging/invalid-registration-token' ||
      error.code === 'messaging/registration-token-not-registered' ||
      error.code === 'messaging/invalid-argument';

    return {
      success: false,
      error: error.message,
      code: error.code,
      isInvalidToken: isInvalidToken,
    };
  }
}

/**
 * Send push notifications in batches (up to 500 per batch)
 * @param {Array<Object>} messages - Array of {token, notification, data}
 * @returns {Promise<Object>} Batch result with success/failure counts
 */
async function sendBatch(messages) {
  if (!firebaseInitialized) {
    initializeFirebase();
  }

  if (!firebaseInitialized) {
    throw new Error('Firebase not initialized');
  }

  if (!messages || messages.length === 0) {
    return { successCount: 0, failureCount: 0, invalidTokens: [] };
  }

  // Firebase allows max 500 messages per batch
  const batchSize = 500;
  let successCount = 0;
  let failureCount = 0;
  const invalidTokens = [];

  for (let i = 0; i < messages.length; i += batchSize) {
    const batch = messages.slice(i, i + batchSize);

    const firebaseMessages = batch.map((msg) => ({
      token: msg.token,
      notification: {
        title: msg.notification.title,
        body: msg.notification.body,
      },
      data: Object.keys(msg.data || {}).reduce((acc, key) => {
        acc[key] = String(msg.data[key]);
        return acc;
      }, {}),
      android: {
        priority: 'high',
        notification: {
          sound: 'default',
          channelId: 'planpal_notifications',
        },
      },
      apns: {
        payload: {
          aps: {
            sound: 'default',
            badge: 1,
          },
        },
      },
    }));

    try {
      const response = await admin.messaging().sendEach(firebaseMessages);

      successCount += response.successCount;
      failureCount += response.failureCount;

      // Collect invalid tokens
      response.responses.forEach((resp, idx) => {
        if (!resp.success) {
          const error = resp.error;
          const isInvalidToken =
            error.code === 'messaging/invalid-registration-token' ||
            error.code === 'messaging/registration-token-not-registered' ||
            error.code === 'messaging/invalid-argument';

          if (isInvalidToken) {
            invalidTokens.push(batch[idx].token);
          }
        }
      });

      logger.info(
        `Batch push result: ${response.successCount} success, ${response.failureCount} failure`
      );
    } catch (error) {
      logger.error('Batch push send failed:', error);
      failureCount += batch.length;
    }
  }

  return {
    successCount,
    failureCount,
    invalidTokens,
  };
}

/**
 * Process unsent notifications and send push notifications
 * This should be called periodically (e.g., every minute)
 * @returns {Promise<Object>} Processing result
 */
export async function processPushQueue() {
  try {
    logger.info('Starting push notification processing...');

    // Get notifications that haven't been pushed yet (created in last 24 hours)
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { data: notifications, error: notifError } = await adminClient
      .from('notifications')
      .select('id, user_id, type, title, body, entity_type, entity_id, workspace_id')
      .is('pushed_at', null)
      .gte('created_at', oneDayAgo)
      .order('created_at', { ascending: true })
      .limit(1000); // Process max 1000 at a time

    if (notifError) throw notifError;

    if (!notifications || notifications.length === 0) {
      logger.info('No notifications to process');
      return { processed: 0, sent: 0, failed: 0 };
    }

    logger.info(`Processing ${notifications.length} notifications`);

    // Group notifications by user to get their device tokens
    const userIds = [...new Set(notifications.map((n) => n.user_id))];

    // Get device tokens for all users
    const { data: deviceTokens, error: tokenError } = await adminClient
      .from('device_tokens')
      .select('user_id, token, platform')
      .in('user_id', userIds);

    if (tokenError) throw tokenError;

    // Create a map of user_id to tokens
    const userTokensMap = {};
    deviceTokens.forEach((dt) => {
      if (!userTokensMap[dt.user_id]) {
        userTokensMap[dt.user_id] = [];
      }
      userTokensMap[dt.user_id].push({
        token: dt.token,
        platform: dt.platform,
      });
    });

    // Build messages for batch sending
    const messages = [];
    const notificationIds = [];

    notifications.forEach((notif) => {
      const tokens = userTokensMap[notif.user_id];

      if (!tokens || tokens.length === 0) {
        // No tokens for this user, mark as pushed anyway
        notificationIds.push(notif.id);
        return;
      }

      // Send to all user's devices
      tokens.forEach((deviceToken) => {
        messages.push({
          token: deviceToken.token,
          notification: {
            title: notif.title,
            body: notif.body,
          },
          data: {
            notification_id: notif.id,
            type: notif.type,
            entity_type: notif.entity_type || '',
            entity_id: notif.entity_id || '',
            workspace_id: notif.workspace_id || '',
          },
        });
      });

      notificationIds.push(notif.id);
    });

    // Send push notifications in batches
    let result = { successCount: 0, failureCount: 0, invalidTokens: [] };

    if (messages.length > 0) {
      result = await sendBatch(messages);
      logger.info(
        `Sent ${result.successCount} pushes, ${result.failureCount} failed, ${result.invalidTokens.length} invalid tokens`
      );
    }

    // Mark notifications as pushed
    if (notificationIds.length > 0) {
      const { error: updateError } = await adminClient
        .from('notifications')
        .update({ pushed_at: new Date().toISOString() })
        .in('id', notificationIds);

      if (updateError) {
        logger.error('Failed to mark notifications as pushed:', updateError);
      }
    }

    // Clean up invalid tokens
    if (result.invalidTokens.length > 0) {
      logger.info(`Cleaning up ${result.invalidTokens.length} invalid tokens`);

      const { error: deleteError } = await adminClient
        .from('device_tokens')
        .delete()
        .in('token', result.invalidTokens);

      if (deleteError) {
        logger.error('Failed to delete invalid tokens:', deleteError);
      }
    }

    logger.info(
      `Push processing complete: ${notificationIds.length} notifications processed, ${result.successCount} sent`
    );

    return {
      processed: notificationIds.length,
      sent: result.successCount,
      failed: result.failureCount,
      invalidTokensCleaned: result.invalidTokens.length,
    };
  } catch (error) {
    logger.error('Push queue processing failed:', error);
    throw error;
  }
}

/**
 * Send immediate push notification (bypasses queue)
 * Use for high-priority notifications
 * @param {string} userId - User ID to send to
 * @param {Object} notification - Notification data
 * @returns {Promise<Object>} Send result
 */
export async function sendImmediatePush(userId, notification) {
  try {
    // Get user's device tokens
    const { data: deviceTokens, error } = await adminClient
      .from('device_tokens')
      .select('token, platform')
      .eq('user_id', userId);

    if (error) throw error;

    if (!deviceTokens || deviceTokens.length === 0) {
      logger.info(`No device tokens for user ${userId}`);
      return { sent: 0, failed: 0 };
    }

    const messages = deviceTokens.map((dt) => ({
      token: dt.token,
      notification: {
        title: notification.title,
        body: notification.body,
      },
      data: notification.data || {},
    }));

    const result = await sendBatch(messages);

    // Clean up invalid tokens
    if (result.invalidTokens.length > 0) {
      await adminClient.from('device_tokens').delete().in('token', result.invalidTokens);
    }

    return {
      sent: result.successCount,
      failed: result.failureCount,
    };
  } catch (error) {
    logger.error('Immediate push send failed:', error);
    throw error;
  }
}

// Initialize on module load
initializeFirebase();

export default {
  sendToDevice,
  sendBatch,
  processPushQueue,
  sendImmediatePush,
};
