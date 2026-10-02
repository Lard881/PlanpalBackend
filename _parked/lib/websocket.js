import { WebSocketServer } from 'ws';
import { logger } from './logger.js';
import { supabaseAdmin } from './supabase.js';
import { verifyToken } from './jwt.js';

/**
 * WebSocket Server for Real-time Collaboration
 * 
 * Handles:
 * - Task updates
 * - Comment additions
 * - Mention notifications
 * - Activity feed updates
 * - User presence (online/offline status)
 * - Typing indicators
 */

class CollaborationWebSocketServer {
  constructor() {
    this.wss = null;
    this.clients = new Map(); // userId -> Set of WebSocket connections
    this.workspaceSubscriptions = new Map(); // workspaceId -> Set of userIds
    this.taskSubscriptions = new Map(); // taskId -> Set of userIds
    this.typingIndicators = new Map(); // taskId -> Map(userId -> timestamp)
    
    this.cleanupInterval = null;
  }

  /**
   * Initialize WebSocket server
   */
  initialize(server) {
    this.wss = new WebSocketServer({ 
      server,
      path: '/ws',
      clientTracking: true,
    });

    this.wss.on('connection', (ws, req) => this.handleConnection(ws, req));
    
    // Cleanup typing indicators every 10 seconds
    this.cleanupInterval = setInterval(() => this.cleanupTypingIndicators(), 10000);
    
    logger.info('WebSocket server initialized');
  }

  /**
   * Handle new WebSocket connection
   */
  async handleConnection(ws, req) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const token = url.searchParams.get('token');

    if (!token) {
      ws.close(1008, 'Authentication required');
      return;
    }

    try {
      // Verify JWT token
      const payload = await verifyToken(token);
      const userId = payload.sub || payload.user_id;

      if (!userId) {
        ws.close(1008, 'Invalid token');
        return;
      }

      // Store connection
      ws.userId = userId;
      ws.isAlive = true;
      ws.workspaces = new Set();
      ws.tasks = new Set();

      if (!this.clients.has(userId)) {
        this.clients.set(userId, new Set());
      }
      this.clients.get(userId).add(ws);

      logger.info(`WebSocket client connected: ${userId}`);

      // Send welcome message
      this.sendToClient(ws, {
        type: 'connected',
        userId,
        timestamp: new Date().toISOString(),
      });

      // Broadcast user online status
      await this.broadcastUserPresence(userId, 'online');

      // Set up message handler
      ws.on('message', (data) => this.handleMessage(ws, data));

      // Set up pong handler for heartbeat
      ws.on('pong', () => {
        ws.isAlive = true;
      });

      // Handle disconnect
      ws.on('close', () => this.handleDisconnect(ws));

    } catch (error) {
      logger.error('WebSocket authentication error', error);
      ws.close(1008, 'Authentication failed');
    }
  }

  /**
   * Handle incoming messages from client
   */
  async handleMessage(ws, data) {
    try {
      const message = JSON.parse(data);
      
      switch (message.type) {
        case 'subscribe_workspace':
          await this.handleWorkspaceSubscribe(ws, message.workspace_id);
          break;
          
        case 'unsubscribe_workspace':
          await this.handleWorkspaceUnsubscribe(ws, message.workspace_id);
          break;
          
        case 'subscribe_task':
          await this.handleTaskSubscribe(ws, message.task_id);
          break;
          
        case 'unsubscribe_task':
          await this.handleTaskUnsubscribe(ws, message.task_id);
          break;
          
        case 'typing_start':
          this.handleTypingStart(ws, message.task_id);
          break;
          
        case 'typing_stop':
          this.handleTypingStop(ws, message.task_id);
          break;
          
        case 'ping':
          this.sendToClient(ws, { type: 'pong', timestamp: new Date().toISOString() });
          break;
          
        default:
          logger.warn(`Unknown message type: ${message.type}`);
      }
    } catch (error) {
      logger.error('Error handling WebSocket message', error);
    }
  }

  /**
   * Handle workspace subscription
   */
  async handleWorkspaceSubscribe(ws, workspaceId) {
    try {
      // Verify user has access to workspace
      const { data: member } = await supabaseAdmin
        .from('workspace_members')
        .select('id')
        .eq('workspace_id', workspaceId)
        .eq('user_id', ws.userId)
        .single();

      if (!member) {
        this.sendToClient(ws, {
          type: 'error',
          message: 'Access denied to workspace',
          workspace_id: workspaceId,
        });
        return;
      }

      // Add to subscriptions
      ws.workspaces.add(workspaceId);
      
      if (!this.workspaceSubscriptions.has(workspaceId)) {
        this.workspaceSubscriptions.set(workspaceId, new Set());
      }
      this.workspaceSubscriptions.get(workspaceId).add(ws.userId);

      this.sendToClient(ws, {
        type: 'subscribed',
        entity: 'workspace',
        id: workspaceId,
      });

      logger.info(`User ${ws.userId} subscribed to workspace ${workspaceId}`);
    } catch (error) {
      logger.error('Error subscribing to workspace', error);
    }
  }

  /**
   * Handle workspace unsubscribe
   */
  handleWorkspaceUnsubscribe(ws, workspaceId) {
    ws.workspaces.delete(workspaceId);
    
    const subscribers = this.workspaceSubscriptions.get(workspaceId);
    if (subscribers) {
      subscribers.delete(ws.userId);
      if (subscribers.size === 0) {
        this.workspaceSubscriptions.delete(workspaceId);
      }
    }

    this.sendToClient(ws, {
      type: 'unsubscribed',
      entity: 'workspace',
      id: workspaceId,
    });
  }

  /**
   * Handle task subscription
   */
  async handleTaskSubscribe(ws, taskId) {
    try {
      // Verify user has access to task
      const { data: task } = await supabaseAdmin
        .from('tasks')
        .select('project_id, projects!inner(workspace_id)')
        .eq('id', taskId)
        .single();

      if (!task) {
        this.sendToClient(ws, {
          type: 'error',
          message: 'Task not found',
          task_id: taskId,
        });
        return;
      }

      const workspaceId = task.projects.workspace_id;

      // Check workspace membership
      const { data: member } = await supabaseAdmin
        .from('workspace_members')
        .select('id')
        .eq('workspace_id', workspaceId)
        .eq('user_id', ws.userId)
        .single();

      if (!member) {
        this.sendToClient(ws, {
          type: 'error',
          message: 'Access denied to task',
          task_id: taskId,
        });
        return;
      }

      // Add to subscriptions
      ws.tasks.add(taskId);
      
      if (!this.taskSubscriptions.has(taskId)) {
        this.taskSubscriptions.set(taskId, new Set());
      }
      this.taskSubscriptions.get(taskId).add(ws.userId);

      this.sendToClient(ws, {
        type: 'subscribed',
        entity: 'task',
        id: taskId,
      });

      // Send current viewers
      const viewers = Array.from(this.taskSubscriptions.get(taskId));
      this.sendToClient(ws, {
        type: 'task_viewers',
        task_id: taskId,
        viewers: viewers.filter(id => id !== ws.userId),
      });

      // Notify others about new viewer
      this.broadcastToTask(taskId, {
        type: 'task_viewer_joined',
        task_id: taskId,
        user_id: ws.userId,
      }, ws.userId);

      logger.info(`User ${ws.userId} subscribed to task ${taskId}`);
    } catch (error) {
      logger.error('Error subscribing to task', error);
    }
  }

  /**
   * Handle task unsubscribe
   */
  handleTaskUnsubscribe(ws, taskId) {
    ws.tasks.delete(taskId);
    
    const subscribers = this.taskSubscriptions.get(taskId);
    if (subscribers) {
      subscribers.delete(ws.userId);
      if (subscribers.size === 0) {
        this.taskSubscriptions.delete(taskId);
      }
    }

    // Clear typing indicator
    this.clearTypingIndicator(taskId, ws.userId);

    // Notify others about viewer leaving
    this.broadcastToTask(taskId, {
      type: 'task_viewer_left',
      task_id: taskId,
      user_id: ws.userId,
    }, ws.userId);

    this.sendToClient(ws, {
      type: 'unsubscribed',
      entity: 'task',
      id: taskId,
    });
  }

  /**
   * Handle typing start
   */
  handleTypingStart(ws, taskId) {
    if (!ws.tasks.has(taskId)) return;

    if (!this.typingIndicators.has(taskId)) {
      this.typingIndicators.set(taskId, new Map());
    }
    
    this.typingIndicators.get(taskId).set(ws.userId, Date.now());

    this.broadcastToTask(taskId, {
      type: 'user_typing',
      task_id: taskId,
      user_id: ws.userId,
      status: 'started',
    }, ws.userId);
  }

  /**
   * Handle typing stop
   */
  handleTypingStop(ws, taskId) {
    this.clearTypingIndicator(taskId, ws.userId);

    this.broadcastToTask(taskId, {
      type: 'user_typing',
      task_id: taskId,
      user_id: ws.userId,
      status: 'stopped',
    }, ws.userId);
  }

  /**
   * Clear typing indicator
   */
  clearTypingIndicator(taskId, userId) {
    const indicators = this.typingIndicators.get(taskId);
    if (indicators) {
      indicators.delete(userId);
      if (indicators.size === 0) {
        this.typingIndicators.delete(taskId);
      }
    }
  }

  /**
   * Cleanup stale typing indicators (older than 10 seconds)
   */
  cleanupTypingIndicators() {
    const now = Date.now();
    const timeout = 10000; // 10 seconds

    for (const [taskId, indicators] of this.typingIndicators.entries()) {
      for (const [userId, timestamp] of indicators.entries()) {
        if (now - timestamp > timeout) {
          indicators.delete(userId);
          
          // Notify about stopped typing
          this.broadcastToTask(taskId, {
            type: 'user_typing',
            task_id: taskId,
            user_id: userId,
            status: 'stopped',
          });
        }
      }
      
      if (indicators.size === 0) {
        this.typingIndicators.delete(taskId);
      }
    }
  }

  /**
   * Handle client disconnect
   */
  async handleDisconnect(ws) {
    const userId = ws.userId;
    
    // Remove from clients map
    const userConnections = this.clients.get(userId);
    if (userConnections) {
      userConnections.delete(ws);
      if (userConnections.size === 0) {
        this.clients.delete(userId);
        // User has no more connections, broadcast offline status
        await this.broadcastUserPresence(userId, 'offline');
      }
    }

    // Remove from workspace subscriptions
    for (const workspaceId of ws.workspaces) {
      const subscribers = this.workspaceSubscriptions.get(workspaceId);
      if (subscribers) {
        subscribers.delete(userId);
        if (subscribers.size === 0) {
          this.workspaceSubscriptions.delete(workspaceId);
        }
      }
    }

    // Remove from task subscriptions and notify
    for (const taskId of ws.tasks) {
      const subscribers = this.taskSubscriptions.get(taskId);
      if (subscribers) {
        subscribers.delete(userId);
        if (subscribers.size === 0) {
          this.taskSubscriptions.delete(taskId);
        }
      }
      
      this.clearTypingIndicator(taskId, userId);
      
      this.broadcastToTask(taskId, {
        type: 'task_viewer_left',
        task_id: taskId,
        user_id: userId,
      });
    }

    logger.info(`WebSocket client disconnected: ${userId}`);
  }

  /**
   * Send message to specific client
   */
  sendToClient(ws, message) {
    if (ws.readyState === 1) { // OPEN
      ws.send(JSON.stringify({
        ...message,
        timestamp: message.timestamp || new Date().toISOString(),
      }));
    }
  }

  /**
   * Send message to all connections of a user
   */
  sendToUser(userId, message) {
    const connections = this.clients.get(userId);
    if (connections) {
      connections.forEach(ws => this.sendToClient(ws, message));
    }
  }

  /**
   * Broadcast to all users in a workspace
   */
  broadcastToWorkspace(workspaceId, message, excludeUserId = null) {
    const subscribers = this.workspaceSubscriptions.get(workspaceId);
    if (!subscribers) return;

    subscribers.forEach(userId => {
      if (userId !== excludeUserId) {
        this.sendToUser(userId, message);
      }
    });
  }

  /**
   * Broadcast to all users viewing a task
   */
  broadcastToTask(taskId, message, excludeUserId = null) {
    const subscribers = this.taskSubscriptions.get(taskId);
    if (!subscribers) return;

    subscribers.forEach(userId => {
      if (userId !== excludeUserId) {
        this.sendToUser(userId, message);
      }
    });
  }

  /**
   * Broadcast user presence status
   */
  async broadcastUserPresence(userId, status) {
    try {
      // Get user's workspaces
      const { data: memberships } = await supabaseAdmin
        .from('workspace_members')
        .select('workspace_id')
        .eq('user_id', userId);

      if (!memberships) return;

      // Broadcast to all user's workspaces
      memberships.forEach(({ workspace_id }) => {
        this.broadcastToWorkspace(workspace_id, {
          type: 'user_presence',
          user_id: userId,
          status,
        }, userId);
      });
    } catch (error) {
      logger.error('Error broadcasting user presence', error);
    }
  }

  /**
   * Broadcast task update
   */
  broadcastTaskUpdate(taskId, task, action = 'updated') {
    this.broadcastToTask(taskId, {
      type: 'task_updated',
      task_id: taskId,
      task,
      action,
    });
  }

  /**
   * Broadcast comment added
   */
  broadcastCommentAdded(taskId, comment) {
    this.broadcastToTask(taskId, {
      type: 'comment_added',
      task_id: taskId,
      comment,
    });
  }

  /**
   * Broadcast mention notification
   */
  broadcastMention(userId, mention) {
    this.sendToUser(userId, {
      type: 'mention',
      mention,
    });
  }

  /**
   * Broadcast activity notification
   */
  broadcastActivity(workspaceId, activity) {
    this.broadcastToWorkspace(workspaceId, {
      type: 'activity',
      activity,
    });
  }

  /**
   * Start heartbeat to detect disconnected clients
   */
  startHeartbeat() {
    const interval = setInterval(() => {
      this.wss.clients.forEach(ws => {
        if (ws.isAlive === false) {
          return ws.terminate();
        }
        
        ws.isAlive = false;
        ws.ping();
      });
    }, 30000); // 30 seconds

    this.wss.on('close', () => {
      clearInterval(interval);
    });
  }

  /**
   * Shutdown WebSocket server
   */
  shutdown() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }

    if (this.wss) {
      this.wss.clients.forEach(ws => {
        ws.close(1001, 'Server shutting down');
      });
      this.wss.close();
    }

    logger.info('WebSocket server shut down');
  }
}

// Export singleton instance
export const wsServer = new CollaborationWebSocketServer();
