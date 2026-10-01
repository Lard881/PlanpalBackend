import { adminClient } from './supabase.js';
import logger from './logger.js';

/**
 * Create a notification
 * @param {Object} notification - Notification data
 * @param {string} notification.user_id - User to notify
 * @param {string} notification.workspace_id - Workspace context
 * @param {string} notification.type - Notification type
 * @param {string} notification.title - Notification title
 * @param {string} notification.body - Notification body
 * @param {string} [notification.entity_type] - Entity type (task, event, etc.)
 * @param {string} [notification.entity_id] - Entity ID
 * @param {string} [notification.dedupe_key] - Deduplication key
 * @returns {Promise<Object>} Created notification
 */
export async function createNotification(notification) {
  try {
    const { data, error } = await adminClient
      .from('notifications')
      .insert({
        user_id: notification.user_id,
        workspace_id: notification.workspace_id,
        type: notification.type,
        title: notification.title,
        body: notification.body || '',
        entity_type: notification.entity_type || null,
        entity_id: notification.entity_id || null,
        dedupe_key: notification.dedupe_key || null,
      })
      .select()
      .single();

    if (error) {
      // If dedupe_key causes conflict, notification already exists
      if (error.code === '23505' && error.message.includes('dedupe_key')) {
        logger.debug(`Duplicate notification prevented: ${notification.dedupe_key}`);
        return null;
      }
      throw error;
    }

    logger.info(`Notification created: ${data.id} for user ${notification.user_id}`);
    return data;
  } catch (error) {
    logger.error('Error creating notification:', error);
    throw error;
  }
}

/**
 * Create multiple notifications (batch)
 * @param {Array<Object>} notifications - Array of notification data
 * @returns {Promise<Array<Object>>} Created notifications
 */
export async function createNotifications(notifications) {
  if (!notifications || notifications.length === 0) {
    return [];
  }

  try {
    const { data, error } = await adminClient
      .from('notifications')
      .insert(notifications)
      .select();

    if (error) throw error;

    logger.info(`${data.length} notifications created`);
    return data;
  } catch (error) {
    logger.error('Error creating batch notifications:', error);
    throw error;
  }
}

/**
 * Create task assigned notification
 * @param {string} userId - User assigned to task
 * @param {string} workspaceId - Workspace ID
 * @param {string} taskId - Task ID
 * @param {string} taskTitle - Task title
 * @param {string} assignedBy - User who assigned the task
 * @returns {Promise<Object>} Created notification
 */
export async function notifyTaskAssigned(userId, workspaceId, taskId, taskTitle, assignedBy) {
  // Don't notify if user assigned task to themselves
  if (userId === assignedBy) {
    return null;
  }

  return createNotification({
    user_id: userId,
    workspace_id: workspaceId,
    type: 'task_assigned',
    title: 'Task assigned to you',
    body: `You have been assigned to "${taskTitle}"`,
    entity_type: 'task',
    entity_id: taskId,
  });
}

/**
 * Create task comment notification
 * @param {string} userId - User to notify
 * @param {string} workspaceId - Workspace ID
 * @param {string} taskId - Task ID
 * @param {string} taskTitle - Task title
 * @param {string} commentedBy - User who commented
 * @returns {Promise<Object>} Created notification
 */
export async function notifyTaskComment(userId, workspaceId, taskId, taskTitle, commentedBy) {
  // Don't notify the commenter
  if (userId === commentedBy) {
    return null;
  }

  return createNotification({
    user_id: userId,
    workspace_id: workspaceId,
    type: 'task_comment',
    title: 'New comment on task',
    body: `New comment on "${taskTitle}"`,
    entity_type: 'task',
    entity_id: taskId,
  });
}

/**
 * Create mention notification
 * @param {string} userId - User mentioned
 * @param {string} workspaceId - Workspace ID
 * @param {string} entityType - Entity type (task, event, etc.)
 * @param {string} entityId - Entity ID
 * @param {string} mentionedBy - User who mentioned
 * @param {string} context - Context text
 * @returns {Promise<Object>} Created notification
 */
export async function notifyMention(userId, workspaceId, entityType, entityId, mentionedBy, context) {
  // Don't notify if user mentioned themselves
  if (userId === mentionedBy) {
    return null;
  }

  return createNotification({
    user_id: userId,
    workspace_id: workspaceId,
    type: 'mention',
    title: 'You were mentioned',
    body: context || 'You were mentioned in a comment',
    entity_type: entityType,
    entity_id: entityId,
  });
}

/**
 * Create member joined notification (for workspace admins)
 * @param {string} workspaceId - Workspace ID
 * @param {string} newMemberName - Name of new member
 * @param {Array<string>} adminUserIds - Workspace admin IDs
 * @returns {Promise<Array<Object>>} Created notifications
 */
export async function notifyMemberJoined(workspaceId, newMemberName, adminUserIds) {
  const notifications = adminUserIds.map(userId => ({
    user_id: userId,
    workspace_id: workspaceId,
    type: 'member_joined',
    title: 'New member joined',
    body: `${newMemberName} joined the workspace`,
    entity_type: 'workspace',
    entity_id: workspaceId,
  }));

  return createNotifications(notifications);
}

/**
 * Create deadline approaching notification
 * @param {string} userId - User to notify
 * @param {string} workspaceId - Workspace ID
 * @param {string} taskId - Task ID
 * @param {string} taskTitle - Task title
 * @param {Date} dueAt - Due date
 * @returns {Promise<Object>} Created notification
 */
export async function notifyDeadlineApproaching(userId, workspaceId, taskId, taskTitle, dueAt) {
  const hoursUntilDue = Math.floor((new Date(dueAt) - new Date()) / (1000 * 60 * 60));
  const dedupeKey = `deadline:${taskId}:${dueAt.toISOString()}:${hoursUntilDue}h`;

  return createNotification({
    user_id: userId,
    workspace_id: workspaceId,
    type: 'deadline_approaching',
    title: 'Task deadline approaching',
    body: `"${taskTitle}" is due in ${hoursUntilDue} hours`,
    entity_type: 'task',
    entity_id: taskId,
    dedupe_key: dedupeKey,
  });
}

/**
 * Create task overdue notification
 * @param {string} userId - User to notify
 * @param {string} workspaceId - Workspace ID
 * @param {string} taskId - Task ID
 * @param {string} taskTitle - Task title
 * @returns {Promise<Object>} Created notification
 */
export async function notifyTaskOverdue(userId, workspaceId, taskId, taskTitle) {
  const dedupeKey = `overdue:${taskId}`;

  return createNotification({
    user_id: userId,
    workspace_id: workspaceId,
    type: 'task_overdue',
    title: 'Task is overdue',
    body: `"${taskTitle}" is overdue`,
    entity_type: 'task',
    entity_id: taskId,
    dedupe_key: dedupeKey,
  });
}

/**
 * Create event reminder notification
 * @param {string} userId - User to notify
 * @param {string} workspaceId - Workspace ID
 * @param {string} eventId - Event ID
 * @param {string} eventTitle - Event title
 * @param {Date} startsAt - Event start time
 * @returns {Promise<Object>} Created notification
 */
export async function notifyEventReminder(userId, workspaceId, eventId, eventTitle, startsAt) {
  const minutesUntilStart = Math.floor((new Date(startsAt) - new Date()) / (1000 * 60));
  const dedupeKey = `event:${eventId}:${startsAt.toISOString()}:${minutesUntilStart}m`;

  return createNotification({
    user_id: userId,
    workspace_id: workspaceId,
    type: 'event_reminder',
    title: 'Event starting soon',
    body: `"${eventTitle}" starts in ${minutesUntilStart} minutes`,
    entity_type: 'event',
    entity_id: eventId,
    dedupe_key: dedupeKey,
  });
}
