import { wsServer } from './websocket.js';
import { logger } from './logger.js';

/**
 * Real-time Broadcasting Helpers
 * 
 * These functions are called from API routes to broadcast
 * real-time updates via WebSocket
 */

/**
 * Broadcast task update
 */
export function broadcastTaskUpdate(taskId, task, action = 'updated') {
  try {
    wsServer.broadcastTaskUpdate(taskId, task, action);
    logger.debug(`Broadcasted task update: ${taskId} (${action})`);
  } catch (error) {
    logger.error('Error broadcasting task update', error);
  }
}

/**
 * Broadcast task created
 */
export function broadcastTaskCreated(workspaceId, task) {
  try {
    wsServer.broadcastToWorkspace(workspaceId, {
      type: 'task_created',
      task,
    });
    logger.debug(`Broadcasted task created: ${task.id}`);
  } catch (error) {
    logger.error('Error broadcasting task created', error);
  }
}

/**
 * Broadcast task deleted
 */
export function broadcastTaskDeleted(taskId, workspaceId) {
  try {
    wsServer.broadcastToWorkspace(workspaceId, {
      type: 'task_deleted',
      task_id: taskId,
    });
    logger.debug(`Broadcasted task deleted: ${taskId}`);
  } catch (error) {
    logger.error('Error broadcasting task deleted', error);
  }
}

/**
 * Broadcast comment added
 */
export function broadcastCommentAdded(taskId, comment) {
  try {
    wsServer.broadcastCommentAdded(taskId, comment);
    logger.debug(`Broadcasted comment added: ${comment.id} on task ${taskId}`);
  } catch (error) {
    logger.error('Error broadcasting comment added', error);
  }
}

/**
 * Broadcast comment updated
 */
export function broadcastCommentUpdated(taskId, comment) {
  try {
    wsServer.broadcastToTask(taskId, {
      type: 'comment_updated',
      task_id: taskId,
      comment,
    });
    logger.debug(`Broadcasted comment updated: ${comment.id}`);
  } catch (error) {
    logger.error('Error broadcasting comment updated', error);
  }
}

/**
 * Broadcast comment deleted
 */
export function broadcastCommentDeleted(taskId, commentId) {
  try {
    wsServer.broadcastToTask(taskId, {
      type: 'comment_deleted',
      task_id: taskId,
      comment_id: commentId,
    });
    logger.debug(`Broadcasted comment deleted: ${commentId}`);
  } catch (error) {
    logger.error('Error broadcasting comment deleted', error);
  }
}

/**
 * Broadcast mention notification
 */
export function broadcastMention(userId, mention) {
  try {
    wsServer.broadcastMention(userId, mention);
    logger.debug(`Broadcasted mention to user: ${userId}`);
  } catch (error) {
    logger.error('Error broadcasting mention', error);
  }
}

/**
 * Broadcast activity
 */
export function broadcastActivity(workspaceId, activity) {
  try {
    wsServer.broadcastActivity(workspaceId, activity);
    logger.debug(`Broadcasted activity to workspace: ${workspaceId}`);
  } catch (error) {
    logger.error('Error broadcasting activity', error);
  }
}

/**
 * Broadcast project update
 */
export function broadcastProjectUpdate(workspaceId, project, action = 'updated') {
  try {
    wsServer.broadcastToWorkspace(workspaceId, {
      type: 'project_updated',
      project,
      action,
    });
    logger.debug(`Broadcasted project update: ${project.id} (${action})`);
  } catch (error) {
    logger.error('Error broadcasting project update', error);
  }
}

/**
 * Broadcast notification
 */
export function broadcastNotification(userId, notification) {
  try {
    wsServer.sendToUser(userId, {
      type: 'notification',
      notification,
    });
    logger.debug(`Broadcasted notification to user: ${userId}`);
  } catch (error) {
    logger.error('Error broadcasting notification', error);
  }
}

/**
 * Broadcast workspace member added
 */
export function broadcastMemberAdded(workspaceId, member) {
  try {
    wsServer.broadcastToWorkspace(workspaceId, {
      type: 'member_added',
      workspace_id: workspaceId,
      member,
    });
    logger.debug(`Broadcasted member added to workspace: ${workspaceId}`);
  } catch (error) {
    logger.error('Error broadcasting member added', error);
  }
}

/**
 * Broadcast workspace member removed
 */
export function broadcastMemberRemoved(workspaceId, userId) {
  try {
    wsServer.broadcastToWorkspace(workspaceId, {
      type: 'member_removed',
      workspace_id: workspaceId,
      user_id: userId,
    });
    logger.debug(`Broadcasted member removed from workspace: ${workspaceId}`);
  } catch (error) {
    logger.error('Error broadcasting member removed', error);
  }
}

/**
 * Get online users in workspace
 */
export function getOnlineUsersInWorkspace(workspaceId) {
  try {
    const subscribers = wsServer.workspaceSubscriptions.get(workspaceId);
    return subscribers ? Array.from(subscribers) : [];
  } catch (error) {
    logger.error('Error getting online users', error);
    return [];
  }
}

/**
 * Get users viewing a task
 */
export function getUsersViewingTask(taskId) {
  try {
    const subscribers = wsServer.taskSubscriptions.get(taskId);
    return subscribers ? Array.from(subscribers) : [];
  } catch (error) {
    logger.error('Error getting task viewers', error);
    return [];
  }
}
