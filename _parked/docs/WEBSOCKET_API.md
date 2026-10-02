# WebSocket API Documentation

## Overview
The WebSocket API provides real-time collaboration features including live updates, user presence, typing indicators, and instant notifications.

**WebSocket URL:** `ws://your-domain/ws` or `wss://your-domain/ws` (production)

**Authentication:** JWT token required as query parameter

---

## Connection

### Establishing Connection

Connect to the WebSocket server with your JWT token:

```javascript
const token = 'your-jwt-token';
const ws = new WebSocket(`wss://api.planpal.com/ws?token=${token}`);

ws.onopen = () => {
  console.log('Connected to WebSocket');
};

ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  console.log('Received:', message);
};

ws.onerror = (error) => {
  console.error('WebSocket error:', error);
};

ws.onclose = (event) => {
  console.log('Disconnected:', event.code, event.reason);
};
```

### Connection Response

Upon successful connection, you'll receive:

```json
{
  "type": "connected",
  "userId": "user-uuid",
  "timestamp": "2024-01-01T12:00:00Z"
}
```

### Authentication Errors

- **1008**: Authentication required or failed
- Missing token: `"Authentication required"`
- Invalid token: `"Authentication failed"`

---

## Client-to-Server Messages

### Subscribe to Workspace

Subscribe to real-time updates for a workspace.

```json
{
  "type": "subscribe_workspace",
  "workspace_id": "workspace-uuid"
}
```

**Response:**
```json
{
  "type": "subscribed",
  "entity": "workspace",
  "id": "workspace-uuid"
}
```

**Error Response:**
```json
{
  "type": "error",
  "message": "Access denied to workspace",
  "workspace_id": "workspace-uuid"
}
```

---

### Unsubscribe from Workspace

```json
{
  "type": "unsubscribe_workspace",
  "workspace_id": "workspace-uuid"
}
```

**Response:**
```json
{
  "type": "unsubscribed",
  "entity": "workspace",
  "id": "workspace-uuid"
}
```

---

### Subscribe to Task

Subscribe to real-time updates for a specific task.

```json
{
  "type": "subscribe_task",
  "task_id": "task-uuid"
}
```

**Response:**
```json
{
  "type": "subscribed",
  "entity": "task",
  "id": "task-uuid"
}
```

**Task Viewers Update:**
```json
{
  "type": "task_viewers",
  "task_id": "task-uuid",
  "viewers": ["user-uuid-1", "user-uuid-2"]
}
```

---

### Unsubscribe from Task

```json
{
  "type": "unsubscribe_task",
  "task_id": "task-uuid"
}
```

**Response:**
```json
{
  "type": "unsubscribed",
  "entity": "task",
  "id": "task-uuid"
}
```

---

### Start Typing Indicator

Indicate that user is typing a comment on a task.

```json
{
  "type": "typing_start",
  "task_id": "task-uuid"
}
```

**Note:** Must be subscribed to the task first.

---

### Stop Typing Indicator

```json
{
  "type": "typing_stop",
  "task_id": "task-uuid"
}
```

**Note:** Typing indicators automatically expire after 10 seconds.

---

### Ping

Keep connection alive and check latency.

```json
{
  "type": "ping"
}
```

**Response:**
```json
{
  "type": "pong",
  "timestamp": "2024-01-01T12:00:00Z"
}
```

---

## Server-to-Client Messages

### User Presence

Notifies when users come online or go offline in your workspaces.

```json
{
  "type": "user_presence",
  "user_id": "user-uuid",
  "status": "online|offline",
  "timestamp": "2024-01-01T12:00:00Z"
}
```

**Trigger:** User connects/disconnects

---

### Task Created

New task created in workspace.

```json
{
  "type": "task_created",
  "task": {
    "id": "task-uuid",
    "title": "New Task",
    "status": "todo",
    "project_id": "project-uuid",
    "assigned_to": "user-uuid",
    ...
  },
  "timestamp": "2024-01-01T12:00:00Z"
}
```

**Trigger:** POST /api/v1/tasks

---

### Task Updated

Task was modified.

```json
{
  "type": "task_updated",
  "task_id": "task-uuid",
  "action": "updated|completed|status_changed",
  "task": {
    "id": "task-uuid",
    "title": "Updated Task",
    "status": "in_progress",
    ...
  },
  "timestamp": "2024-01-01T12:00:00Z"
}
```

**Trigger:** PUT /api/v1/tasks/:id

---

### Task Deleted

Task was deleted.

```json
{
  "type": "task_deleted",
  "task_id": "task-uuid",
  "timestamp": "2024-01-01T12:00:00Z"
}
```

**Trigger:** DELETE /api/v1/tasks/:id

---

### Comment Added

New comment added to task.

```json
{
  "type": "comment_added",
  "task_id": "task-uuid",
  "comment": {
    "id": "comment-uuid",
    "content": "Great work!",
    "user_id": "user-uuid",
    "created_at": "2024-01-01T12:00:00Z",
    ...
  },
  "timestamp": "2024-01-01T12:00:00Z"
}
```

**Trigger:** POST /api/v1/comments

---

### Comment Updated

Comment was modified.

```json
{
  "type": "comment_updated",
  "task_id": "task-uuid",
  "comment": {
    "id": "comment-uuid",
    "content": "Updated comment",
    ...
  },
  "timestamp": "2024-01-01T12:00:00Z"
}
```

**Trigger:** PUT /api/v1/comments/:id

---

### Comment Deleted

Comment was removed.

```json
{
  "type": "comment_deleted",
  "task_id": "task-uuid",
  "comment_id": "comment-uuid",
  "timestamp": "2024-01-01T12:00:00Z"
}
```

**Trigger:** DELETE /api/v1/comments/:id

---

### Mention Notification

User was mentioned in a task or comment.

```json
{
  "type": "mention",
  "mention": {
    "id": "mention-uuid",
    "mention_type": "task|comment",
    "task_id": "task-uuid",
    "comment_id": "comment-uuid",
    "mentioned_by_user_id": "user-uuid",
    "is_read": false,
    "created_at": "2024-01-01T12:00:00Z"
  },
  "timestamp": "2024-01-01T12:00:00Z"
}
```

**Trigger:** Mention detection in tasks/comments

---

### Activity Update

New activity in workspace.

```json
{
  "type": "activity",
  "activity": {
    "id": "activity-uuid",
    "entity_type": "task",
    "entity_id": "task-uuid",
    "action": "completed",
    "user_id": "user-uuid",
    "workspace_id": "workspace-uuid",
    "created_at": "2024-01-01T12:00:00Z",
    ...
  },
  "timestamp": "2024-01-01T12:00:00Z"
}
```

**Trigger:** Any activity-generating action

---

### Notification

Real-time notification delivery.

```json
{
  "type": "notification",
  "notification": {
    "id": "notification-uuid",
    "type": "task_assigned|mention_task|task_completed",
    "title": "You were assigned a task",
    "body": "John assigned you 'Complete homepage'",
    "is_read": false,
    "created_at": "2024-01-01T12:00:00Z",
    ...
  },
  "timestamp": "2024-01-01T12:00:00Z"
}
```

**Trigger:** Notification creation

---

### Task Viewer Joined

Someone started viewing a task.

```json
{
  "type": "task_viewer_joined",
  "task_id": "task-uuid",
  "user_id": "user-uuid",
  "timestamp": "2024-01-01T12:00:00Z"
}
```

**Trigger:** User subscribes to task

---

### Task Viewer Left

Someone stopped viewing a task.

```json
{
  "type": "task_viewer_left",
  "task_id": "task-uuid",
  "user_id": "user-uuid",
  "timestamp": "2024-01-01T12:00:00Z"
}
```

**Trigger:** User unsubscribes from task or disconnects

---

### User Typing

Someone is typing a comment.

```json
{
  "type": "user_typing",
  "task_id": "task-uuid",
  "user_id": "user-uuid",
  "status": "started|stopped",
  "timestamp": "2024-01-01T12:00:00Z"
}
```

**Trigger:** typing_start/typing_stop messages or 10-second timeout

---

### Project Updated

Project was modified.

```json
{
  "type": "project_updated",
  "action": "updated|created|deleted",
  "project": {
    "id": "project-uuid",
    "name": "Updated Project",
    "color": "#FF5733",
    ...
  },
  "timestamp": "2024-01-01T12:00:00Z"
}
```

**Trigger:** Project CRUD operations

---

### Member Added

New member joined workspace.

```json
{
  "type": "member_added",
  "workspace_id": "workspace-uuid",
  "member": {
    "user_id": "user-uuid",
    "role": "member",
    "joined_at": "2024-01-01T12:00:00Z"
  },
  "timestamp": "2024-01-01T12:00:00Z"
}
```

**Trigger:** Workspace invitation accepted

---

### Member Removed

Member left or was removed from workspace.

```json
{
  "type": "member_removed",
  "workspace_id": "workspace-uuid",
  "user_id": "user-uuid",
  "timestamp": "2024-01-01T12:00:00Z"
}
```

**Trigger:** Member removal

---

## Connection Management

### Heartbeat

The server sends ping frames every 30 seconds to detect disconnected clients. Clients should respond with pong frames (handled automatically by most WebSocket clients).

**Behavior:**
- If client doesn't respond to 2 consecutive pings, connection is terminated
- Send `{"type": "ping"}` from client to test connection and latency

### Reconnection

Implement exponential backoff for reconnection:

```javascript
let reconnectDelay = 1000; // Start with 1 second
const maxDelay = 30000; // Max 30 seconds

function connect() {
  const ws = new WebSocket(`wss://api.planpal.com/ws?token=${token}`);
  
  ws.onopen = () => {
    reconnectDelay = 1000; // Reset on successful connection
    // Resubscribe to workspaces and tasks
    resubscribe(ws);
  };
  
  ws.onclose = () => {
    setTimeout(connect, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, maxDelay);
  };
}

function resubscribe(ws) {
  // Resubscribe to previously subscribed entities
  currentWorkspaces.forEach(id => {
    ws.send(JSON.stringify({ type: 'subscribe_workspace', workspace_id: id }));
  });
  currentTasks.forEach(id => {
    ws.send(JSON.stringify({ type: 'subscribe_task', task_id: id }));
  });
}
```

---

## Best Practices

### 1. Subscription Management

- Subscribe to workspace on app load
- Subscribe to task when viewing task details
- Unsubscribe when leaving view to reduce server load

### 2. Message Handling

- Always parse incoming messages with try-catch
- Handle unknown message types gracefully
- Implement message queuing for offline scenarios

### 3. UI Updates

- Update UI optimistically then confirm with WebSocket message
- Use message timestamps to resolve conflicts
- Implement debouncing for typing indicators

### 4. Performance

- Keep subscriptions minimal (only active views)
- Batch UI updates if receiving many messages
- Use service workers for background updates

### 5. Error Handling

- Implement reconnection with exponential backoff
- Show connection status to users
- Queue actions when offline

---

## Example Implementation

### React Hook

```javascript
import { useEffect, useRef, useState } from 'react';

export function useWebSocket(token) {
  const ws = useRef(null);
  const [connected, setConnected] = useState(false);
  const [lastMessage, setLastMessage] = useState(null);

  useEffect(() => {
    if (!token) return;

    ws.current = new WebSocket(`wss://api.planpal.com/ws?token=${token}`);

    ws.current.onopen = () => {
      setConnected(true);
      console.log('WebSocket connected');
    };

    ws.current.onmessage = (event) => {
      const message = JSON.parse(event.data);
      setLastMessage(message);
    };

    ws.current.onclose = () => {
      setConnected(false);
      console.log('WebSocket disconnected');
    };

    return () => {
      ws.current?.close();
    };
  }, [token]);

  const subscribe = (type, id) => {
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({
        type: `subscribe_${type}`,
        [`${type}_id`]: id,
      }));
    }
  };

  const unsubscribe = (type, id) => {
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({
        type: `unsubscribe_${type}`,
        [`${type}_id`]: id,
      }));
    }
  };

  const startTyping = (taskId) => {
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({
        type: 'typing_start',
        task_id: taskId,
      }));
    }
  };

  const stopTyping = (taskId) => {
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({
        type: 'typing_stop',
        task_id: taskId,
      }));
    }
  };

  return {
    connected,
    lastMessage,
    subscribe,
    unsubscribe,
    startTyping,
    stopTyping,
  };
}
```

### Usage

```javascript
function TaskDetails({ taskId, token }) {
  const { connected, lastMessage, subscribe, unsubscribe } = useWebSocket(token);

  useEffect(() => {
    if (connected) {
      subscribe('task', taskId);
      return () => unsubscribe('task', taskId);
    }
  }, [connected, taskId]);

  useEffect(() => {
    if (lastMessage) {
      switch (lastMessage.type) {
        case 'task_updated':
          // Update task in state
          break;
        case 'comment_added':
          // Add comment to list
          break;
        case 'user_typing':
          // Show typing indicator
          break;
      }
    }
  }, [lastMessage]);

  return (
    <div>
      {!connected && <div>Connecting...</div>}
      {/* Task content */}
    </div>
  );
}
```

---

## Security

- **Authentication:** JWT token required for all connections
- **Authorization:** Subscriptions verified against workspace membership
- **Rate Limiting:** Message rate limited per connection
- **Input Validation:** All client messages validated
- **Connection Limits:** Max connections per user enforced

---

## Monitoring

WebSocket metrics logged:
- Active connections count
- Messages per second
- Subscription counts
- Error rates
- Reconnection attempts

---

## Troubleshooting

### Connection Refused
- Check token is valid and not expired
- Verify WebSocket URL is correct
- Check firewall/proxy settings

### Messages Not Received
- Verify subscription to correct entity
- Check workspace/task access permissions
- Confirm connection is still open

### High Latency
- Check network connection
- Monitor ping/pong times
- Consider geographic proximity to server

---

## Changelog

### Version 1.0 (Stage 15 - Task 3)
- Initial WebSocket server implementation
- User presence tracking
- Task viewer tracking
- Typing indicators
- Real-time updates for tasks, comments, mentions, activities
- Automatic reconnection support
- Heartbeat mechanism
