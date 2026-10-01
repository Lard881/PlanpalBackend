# WebSocket Integration Examples

## Overview
This document provides practical examples for integrating WebSocket real-time features into your application.

---

## Backend Integration

### Broadcasting from API Routes

When you create/update entities via REST API, broadcast the changes via WebSocket:

#### Example: Task Update Route

```javascript
import { broadcastTaskUpdate } from '../lib/realtime-helpers.js';

router.put('/tasks/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    // Update task in database
    const { data: task, error } = await req.supabase
      .from('tasks')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    // Broadcast to WebSocket subscribers
    broadcastTaskUpdate(id, task, 'updated');

    res.json({ task });
  } catch (error) {
    next(error);
  }
});
```

#### Example: Comment Creation

```javascript
import { broadcastCommentAdded } from '../lib/realtime-helpers.js';

router.post('/comments', async (req, res, next) => {
  try {
    const { task_id, content } = req.body;

    // Create comment
    const { data: comment, error } = await req.supabase
      .from('comments')
      .insert({
        task_id,
        user_id: req.userId,
        content,
      })
      .select()
      .single();

    if (error) throw error;

    // Broadcast to task subscribers
    broadcastCommentAdded(task_id, comment);

    res.status(201).json({ comment });
  } catch (error) {
    next(error);
  }
});
```

#### Example: Mention Notification

```javascript
import { broadcastMention } from '../lib/realtime-helpers.js';

// After creating a mention
const { data: mention } = await supabase
  .from('mentions')
  .insert(mentionData)
  .select()
  .single();

// Notify mentioned user in real-time
broadcastMention(mention.mentioned_user_id, mention);
```

---

## Frontend Integration

### Flutter/Dart WebSocket Client

```dart
import 'package:web_socket_channel/web_socket_channel.dart';
import 'dart:convert';

class WebSocketService {
  WebSocketChannel? _channel;
  final String token;
  final String baseUrl;
  
  Stream<dynamic>? messageStream;
  bool _isConnected = false;
  
  WebSocketService({
    required this.token,
    required this.baseUrl,
  });
  
  Future<void> connect() async {
    try {
      final wsUrl = baseUrl.replaceFirst('https://', 'wss://').replaceFirst('http://', 'ws://');
      _channel = WebSocketChannel.connect(
        Uri.parse('$wsUrl/ws?token=$token'),
      );
      
      messageStream = _channel!.stream.map((data) {
        return jsonDecode(data);
      });
      
      _isConnected = true;
      print('WebSocket connected');
      
      // Listen for messages
      messageStream!.listen(
        _handleMessage,
        onError: (error) {
          print('WebSocket error: $error');
          _isConnected = false;
        },
        onDone: () {
          print('WebSocket disconnected');
          _isConnected = false;
          _reconnect();
        },
      );
    } catch (e) {
      print('Error connecting to WebSocket: $e');
      _reconnect();
    }
  }
  
  void _handleMessage(dynamic message) {
    final type = message['type'];
    
    switch (type) {
      case 'connected':
        print('Connected as user: ${message['userId']}');
        break;
        
      case 'task_updated':
        print('Task updated: ${message['task_id']}');
        // Handle task update
        break;
        
      case 'comment_added':
        print('New comment on task: ${message['task_id']}');
        // Handle new comment
        break;
        
      case 'mention':
        print('You were mentioned!');
        // Show notification
        break;
        
      case 'user_typing':
        print('User ${message['user_id']} is typing');
        // Show typing indicator
        break;
        
      default:
        print('Unknown message type: $type');
    }
  }
  
  void subscribeToWorkspace(String workspaceId) {
    if (_isConnected) {
      _send({
        'type': 'subscribe_workspace',
        'workspace_id': workspaceId,
      });
    }
  }
  
  void unsubscribeFromWorkspace(String workspaceId) {
    if (_isConnected) {
      _send({
        'type': 'unsubscribe_workspace',
        'workspace_id': workspaceId,
      });
    }
  }
  
  void subscribeToTask(String taskId) {
    if (_isConnected) {
      _send({
        'type': 'subscribe_task',
        'task_id': taskId,
      });
    }
  }
  
  void unsubscribeFromTask(String taskId) {
    if (_isConnected) {
      _send({
        'type': 'unsubscribe_task',
        'task_id': taskId,
      });
    }
  }
  
  void startTyping(String taskId) {
    if (_isConnected) {
      _send({
        'type': 'typing_start',
        'task_id': taskId,
      });
    }
  }
  
  void stopTyping(String taskId) {
    if (_isConnected) {
      _send({
        'type': 'typing_stop',
        'task_id': taskId,
      });
    }
  }
  
  void _send(Map<String, dynamic> message) {
    if (_channel != null && _isConnected) {
      _channel!.sink.add(jsonEncode(message));
    }
  }
  
  Future<void> _reconnect() async {
    await Future.delayed(Duration(seconds: 5));
    if (!_isConnected) {
      connect();
    }
  }
  
  void dispose() {
    _channel?.sink.close();
    _isConnected = false;
  }
}
```

### Flutter Provider Setup

```dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

final webSocketServiceProvider = Provider<WebSocketService>((ref) {
  final token = ref.watch(authTokenProvider);
  return WebSocketService(
    token: token,
    baseUrl: 'https://api.planpal.com',
  );
});

final webSocketConnectionProvider = StreamProvider<bool>((ref) async* {
  final ws = ref.watch(webSocketServiceProvider);
  await ws.connect();
  
  // Emit connection status
  yield* Stream.periodic(Duration(seconds: 1), (_) => ws._isConnected);
});

final webSocketMessagesProvider = StreamProvider<dynamic>((ref) {
  final ws = ref.watch(webSocketServiceProvider);
  return ws.messageStream ?? Stream.empty();
});
```

### Usage in Flutter Widget

```dart
class TaskDetailsScreen extends ConsumerStatefulWidget {
  final String taskId;
  
  const TaskDetailsScreen({required this.taskId});
  
  @override
  ConsumerState<TaskDetailsScreen> createState() => _TaskDetailsScreenState();
}

class _TaskDetailsScreenState extends ConsumerState<TaskDetailsScreen> {
  final TextEditingController _commentController = TextEditingController();
  Timer? _typingTimer;
  
  @override
  void initState() {
    super.initState();
    
    // Subscribe to task
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final ws = ref.read(webSocketServiceProvider);
      ws.subscribeToTask(widget.taskId);
    });
    
    // Listen for typing
    _commentController.addListener(_onTypingChanged);
  }
  
  void _onTypingChanged() {
    final ws = ref.read(webSocketServiceProvider);
    
    // Cancel previous timer
    _typingTimer?.cancel();
    
    // Start typing
    ws.startTyping(widget.taskId);
    
    // Stop typing after 2 seconds of no input
    _typingTimer = Timer(Duration(seconds: 2), () {
      ws.stopTyping(widget.taskId);
    });
  }
  
  @override
  void dispose() {
    final ws = ref.read(webSocketServiceProvider);
    ws.unsubscribeFromTask(widget.taskId);
    ws.stopTyping(widget.taskId);
    
    _typingTimer?.cancel();
    _commentController.dispose();
    super.dispose();
  }
  
  @override
  Widget build(BuildContext context) {
    // Listen to WebSocket messages
    ref.listen(webSocketMessagesProvider, (previous, next) {
      next.whenData((message) {
        if (message['type'] == 'task_updated' && 
            message['task_id'] == widget.taskId) {
          // Refresh task data
          ref.invalidate(taskProvider(widget.taskId));
        } else if (message['type'] == 'comment_added' && 
                   message['task_id'] == widget.taskId) {
          // Refresh comments
          ref.invalidate(taskCommentsProvider(widget.taskId));
        } else if (message['type'] == 'user_typing' && 
                   message['task_id'] == widget.taskId) {
          // Show typing indicator
          _showTypingIndicator(message['user_id'], message['status']);
        }
      });
    });
    
    final taskAsync = ref.watch(taskProvider(widget.taskId));
    final connected = ref.watch(webSocketConnectionProvider).value ?? false;
    
    return Scaffold(
      appBar: AppBar(
        title: Text('Task Details'),
        actions: [
          // Connection indicator
          Icon(
            Icons.circle,
            color: connected ? Colors.green : Colors.red,
            size: 12,
          ),
        ],
      ),
      body: taskAsync.when(
        data: (task) => _buildTaskDetails(task),
        loading: () => Center(child: CircularProgressIndicator()),
        error: (error, stack) => Text('Error: $error'),
      ),
    );
  }
  
  void _showTypingIndicator(String userId, String status) {
    // Implementation for showing/hiding typing indicator
  }
  
  Widget _buildTaskDetails(Task task) {
    // Build task UI
    return Column(
      children: [
        // Task details
        Expanded(child: TaskInfo(task: task)),
        
        // Comments section with typing indicators
        CommentsSection(taskId: widget.taskId),
        
        // Comment input
        CommentInput(
          controller: _commentController,
          onSubmit: _submitComment,
        ),
      ],
    );
  }
  
  void _submitComment(String content) async {
    final ws = ref.read(webSocketServiceProvider);
    ws.stopTyping(widget.taskId);
    
    // Submit comment via API
    // WebSocket will broadcast the new comment
    await ref.read(commentsRepositoryProvider).createComment(
      taskId: widget.taskId,
      content: content,
    );
    
    _commentController.clear();
  }
}
```

---

## React Native Example

```javascript
import { useEffect, useRef, useState } from 'react';

export function useWebSocket(token) {
  const ws = useRef(null);
  const [connected, setConnected] = useState(false);
  const [messages, setMessages] = useState([]);
  const reconnectTimeout = useRef(null);
  const reconnectDelay = useRef(1000);

  useEffect(() => {
    if (!token) return;

    connect();

    return () => {
      if (ws.current) {
        ws.current.close();
      }
      if (reconnectTimeout.current) {
        clearTimeout(reconnectTimeout.current);
      }
    };
  }, [token]);

  const connect = () => {
    const wsUrl = `wss://api.planpal.com/ws?token=${token}`;
    ws.current = new WebSocket(wsUrl);

    ws.current.onopen = () => {
      setConnected(true);
      reconnectDelay.current = 1000; // Reset delay
      console.log('WebSocket connected');
    };

    ws.current.onmessage = (event) => {
      const message = JSON.parse(event.data);
      setMessages(prev => [...prev, message]);
    };

    ws.current.onerror = (error) => {
      console.error('WebSocket error:', error);
    };

    ws.current.onclose = () => {
      setConnected(false);
      console.log('WebSocket disconnected');
      
      // Reconnect with exponential backoff
      reconnectTimeout.current = setTimeout(() => {
        reconnectDelay.current = Math.min(reconnectDelay.current * 2, 30000);
        connect();
      }, reconnectDelay.current);
    };
  };

  const send = (message) => {
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify(message));
    }
  };

  const subscribe = (type, id) => {
    send({
      type: `subscribe_${type}`,
      [`${type}_id`]: id,
    });
  };

  const unsubscribe = (type, id) => {
    send({
      type: `unsubscribe_${type}`,
      [`${type}_id`]: id,
    });
  };

  return {
    connected,
    messages,
    subscribe,
    unsubscribe,
    send,
  };
}

// Usage
function TaskScreen({ taskId, token }) {
  const { connected, messages, subscribe, unsubscribe, send } = useWebSocket(token);

  useEffect(() => {
    if (connected) {
      subscribe('task', taskId);
      return () => unsubscribe('task', taskId);
    }
  }, [connected, taskId]);

  useEffect(() => {
    const lastMessage = messages[messages.length - 1];
    if (lastMessage) {
      handleMessage(lastMessage);
    }
  }, [messages]);

  const handleMessage = (message) => {
    switch (message.type) {
      case 'task_updated':
        // Refresh task
        break;
      case 'comment_added':
        // Add comment to list
        break;
      case 'user_typing':
        // Show typing indicator
        break;
    }
  };

  const handleTyping = () => {
    send({ type: 'typing_start', task_id: taskId });
    
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
      send({ type: 'typing_stop', task_id: taskId });
    }, 2000);
  };

  return (
    <View>
      <StatusIndicator connected={connected} />
      {/* Task content */}
    </View>
  );
}
```

---

## Testing WebSocket Connection

### Using wscat (CLI tool)

```bash
# Install wscat
npm install -g wscat

# Connect to WebSocket
wscat -c "ws://localhost:3000/ws?token=YOUR_JWT_TOKEN"

# Send messages
> {"type":"subscribe_workspace","workspace_id":"abc-123"}
> {"type":"subscribe_task","task_id":"def-456"}
> {"type":"typing_start","task_id":"def-456"}
> {"type":"ping"}
```

### Using Browser Console

```javascript
const token = 'your-jwt-token';
const ws = new WebSocket(`ws://localhost:3000/ws?token=${token}`);

ws.onopen = () => console.log('Connected');
ws.onmessage = (e) => console.log('Message:', JSON.parse(e.data));

// Subscribe to workspace
ws.send(JSON.stringify({
  type: 'subscribe_workspace',
  workspace_id: 'your-workspace-id'
}));

// Subscribe to task
ws.send(JSON.stringify({
  type: 'subscribe_task',
  task_id: 'your-task-id'
}));

// Test typing
ws.send(JSON.stringify({
  type: 'typing_start',
  task_id: 'your-task-id'
}));
```

---

## Common Patterns

### Optimistic Updates with Confirmation

```dart
// Update UI immediately (optimistic)
setState(() {
  task = task.copyWith(status: 'completed');
});

// Send API request
final result = await tasksRepository.updateTask(task);

// If WebSocket confirms, do nothing
// If error or no confirmation in 5 seconds, revert
Timer(Duration(seconds: 5), () {
  if (!receivedWebSocketConfirmation) {
    setState(() {
      task = task.copyWith(status: previousStatus);
    });
  }
});
```

### Handling Conflicts

```dart
void _handleTaskUpdate(Map<String, dynamic> message) {
  final serverTask = Task.fromJson(message['task']);
  final localTask = ref.read(taskProvider(serverTask.id)).value;
  
  if (localTask != null) {
    // Check if local changes exist
    final hasLocalChanges = localTask.updatedAt.isAfter(serverTask.updatedAt);
    
    if (hasLocalChanges) {
      // Show conflict resolution dialog
      showConflictDialog(localTask, serverTask);
    } else {
      // Accept server version
      ref.read(taskProvider(serverTask.id).notifier).state = 
        AsyncValue.data(serverTask);
    }
  }
}
```

---

## Performance Tips

1. **Batch UI Updates**: Collect multiple WebSocket messages and update UI once
2. **Debounce Typing**: Only send typing indicator after user stops typing for 500ms
3. **Limit Subscriptions**: Only subscribe to currently visible entities
4. **Clean Up**: Always unsubscribe when leaving views
5. **Connection Pooling**: Reuse WebSocket connection across app

---

## Debugging

### Enable Logging

```javascript
// Backend
import { logger } from './lib/logger.js';
logger.level = 'debug'; // Log all WebSocket events

// Frontend
console.log('WS Message:', message);
console.log('WS State:', ws.readyState);
// 0 = CONNECTING, 1 = OPEN, 2 = CLOSING, 3 = CLOSED
```

### Monitor Traffic

- Use browser DevTools Network tab (WS filter)
- Check WebSocket frame inspector
- Monitor message timestamps for latency

---

## Security Checklist

- [ ] JWT token expires and refreshes properly
- [ ] WebSocket URL uses wss:// (TLS) in production
- [ ] Validate all incoming messages
- [ ] Rate limit message frequency
- [ ] Verify subscription permissions
- [ ] Close connections on token expiry
- [ ] Log suspicious activity
