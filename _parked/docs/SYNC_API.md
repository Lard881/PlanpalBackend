# Sync API Documentation

The Sync API enables offline-first functionality with bidirectional synchronization and conflict resolution.

## Overview

The sync system supports:
- **Incremental sync**: Only fetch changes since last sync
- **Bidirectional sync**: Pull from server and push local changes
- **Conflict resolution**: Three strategies (server_wins, client_wins, fail_on_conflict)
- **Offline queue**: Track pending changes while offline
- **Conflict logging**: Audit trail for debugging
- **Multi-device support**: Track sync state per device

## Architecture

### Sync Flow

```
1. Pull Phase:
   Client → GET /sync/pull → Server
   Server returns changes since last sync
   Client applies changes to local database

2. Push Phase:
   Client → POST /sync/push → Server
   Server applies changes with conflict resolution
   Server returns results and conflicts
   Client updates local state

3. Status Check:
   Client → GET /sync/status → Server
   Server returns sync metadata for device
```

### Conflict Resolution

When a conflict occurs (server and client both modified same entity):

**server_wins** (default):
- Server data takes precedence
- Client receives server version
- Conflict logged for audit

**client_wins**:
- Client data overwrites server
- Server applies client changes
- Conflict logged for audit

**fail_on_conflict**:
- Sync fails with 409 error
- Client must resolve manually
- No automatic resolution

## Endpoints

### GET /sync/pull

Pull changes from server since last sync.

**Query Parameters:**
- `workspace_id` (uuid, optional): Workspace ID (defaults to user's default workspace)
- `device_id` (string, required): Unique device identifier
- `entity_types` (string, optional): Comma-separated list (default: all types)
  - Valid: `task,project,label,task_label,comment,attachment,link`
- `since` (ISO datetime, optional): Override last sync timestamp

**Response:**
```json
{
  "changes": {
    "task": [
      {
        "id": "uuid",
        "data": { /* full task object */ },
        "operation": "update",
        "updated_at": "2024-01-15T10:30:00Z"
      }
    ],
    "project": [ /* ... */ ],
    "label": [ /* ... */ ]
  },
  "sync_timestamps": {
    "task": "2024-01-15T10:00:00Z",
    "project": "2024-01-15T09:45:00Z"
  },
  "server_timestamp": "2024-01-15T10:30:00Z"
}
```

**Example:**
```bash
curl -X GET "https://api.planpal.com/api/v1/sync/pull?device_id=device-123&entity_types=task,project" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

---

### POST /sync/push

Push local changes to server with conflict resolution.

**Request Body:**
```json
{
  "workspace_id": "uuid",
  "device_id": "device-123",
  "conflict_resolution": "server_wins",
  "changes": [
    {
      "entity_type": "task",
      "entity_id": "uuid",
      "operation": "update",
      "data": {
        "title": "Updated task title",
        "status": "completed"
      },
      "client_updated_at": "2024-01-15T10:25:00Z",
      "version": 5
    },
    {
      "entity_type": "project",
      "entity_id": "uuid",
      "operation": "insert",
      "data": {
        "name": "New Project",
        "color": "#FF5733"
      },
      "client_updated_at": "2024-01-15T10:26:00Z"
    }
  ]
}
```

**Parameters:**
- `workspace_id` (uuid, optional): Workspace ID
- `device_id` (string, required): Unique device identifier
- `conflict_resolution` (enum): `server_wins`, `client_wins`, `fail_on_conflict`
- `changes` (array, max 500): Array of changes to apply
  - `entity_type`: `task`, `project`, `label`, `task_label`, `comment`, `attachment`, `link`
  - `entity_id`: UUID of entity
  - `operation`: `insert`, `update`, `delete`
  - `data`: Entity data (required for insert/update)
  - `client_updated_at`: ISO timestamp when client made the change
  - `version` (optional): Version number for optimistic locking

**Response:**
```json
{
  "success": true,
  "processed": 2,
  "successful": 2,
  "failed": 0,
  "conflicts": 1,
  "results": [
    {
      "entity_type": "task",
      "entity_id": "uuid",
      "operation": "update",
      "success": true,
      "conflict": true,
      "resolution": "server_wins",
      "data": { /* resolved data */ }
    },
    {
      "entity_type": "project",
      "entity_id": "uuid",
      "operation": "insert",
      "success": true,
      "conflict": false,
      "data": { /* inserted data */ }
    }
  ],
  "server_timestamp": "2024-01-15T10:30:00Z"
}
```

**Example:**
```bash
curl -X POST "https://api.planpal.com/api/v1/sync/push" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "device_id": "device-123",
    "conflict_resolution": "server_wins",
    "changes": [...]
  }'
```

---

### GET /sync/status

Get sync status and metadata for a device.

**Query Parameters:**
- `workspace_id` (uuid, optional): Workspace ID
- `device_id` (string, required): Unique device identifier
- `entity_type` (string, optional): Filter by entity type

**Response:**
```json
{
  "device_id": "device-123",
  "workspace_id": "uuid",
  "sync_metadata": [
    {
      "id": "uuid",
      "user_id": "uuid",
      "workspace_id": "uuid",
      "device_id": "device-123",
      "entity_type": "task",
      "last_sync_at": "2024-01-15T10:30:00Z",
      "last_sync_version": 42,
      "sync_status": "success",
      "metadata": {},
      "created_at": "2024-01-01T00:00:00Z",
      "updated_at": "2024-01-15T10:30:00Z"
    }
  ],
  "server_timestamp": "2024-01-15T10:30:00Z"
}
```

---

### GET /sync/conflicts

Get recent sync conflicts for debugging.

**Query Parameters:**
- `workspace_id` (uuid, optional): Workspace ID
- `device_id` (string, optional): Filter by device
- `limit` (number, default: 50): Max conflicts to return

**Response:**
```json
{
  "conflicts": [
    {
      "id": "uuid",
      "user_id": "uuid",
      "workspace_id": "uuid",
      "device_id": "device-123",
      "entity_type": "task",
      "entity_id": "uuid",
      "conflict_type": "update_conflict",
      "resolution_strategy": "server_wins",
      "server_data": { /* server version */ },
      "client_data": { /* client version */ },
      "resolved_data": { /* final version */ },
      "resolved_at": "2024-01-15T10:30:00Z",
      "metadata": {
        "client_updated_at": "2024-01-15T10:25:00Z"
      },
      "created_at": "2024-01-15T10:30:00Z"
    }
  ],
  "count": 1
}
```

---

### POST /sync/reset

Reset sync metadata for a device (testing/troubleshooting).

**Request Body:**
```json
{
  "workspace_id": "uuid",
  "device_id": "device-123",
  "entity_type": "task"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Sync metadata reset successfully"
}
```

---

## Entity Types

Supported entity types for synchronization:

| Entity Type | Table Name | Soft Delete | Description |
|-------------|------------|-------------|-------------|
| `task` | `tasks` | Yes | Tasks |
| `project` | `projects` | Yes | Projects |
| `label` | `labels` | Yes | Labels |
| `task_label` | `task_labels` | No | Task-Label relationships |
| `comment` | `comments` | No | Task comments |
| `attachment` | `attachments` | No | File attachments |
| `link` | `links` | No | External links |

---

## Sync Strategies

### Full Sync

Initial sync or after reset - fetches all data:

```javascript
// Pull all data (no since timestamp)
GET /sync/pull?device_id=device-123

// Returns all entities in workspace
```

### Incremental Sync

Fetch only changes since last sync:

```javascript
// Pull changes since last sync
GET /sync/pull?device_id=device-123&since=2024-01-15T10:00:00Z

// Or let server track last sync automatically
GET /sync/pull?device_id=device-123
```

### Bidirectional Sync

1. Pull changes from server
2. Apply to local database
3. Push local changes to server
4. Handle conflicts
5. Update local state with resolved data

```javascript
// 1. Pull
const pullResponse = await fetch('/sync/pull?device_id=device-123');
const { changes } = await pullResponse.json();

// 2. Apply to local DB
await applyChangesToLocalDB(changes);

// 3. Push pending changes
const pushResponse = await fetch('/sync/push', {
  method: 'POST',
  body: JSON.stringify({
    device_id: 'device-123',
    changes: pendingChanges,
    conflict_resolution: 'server_wins'
  })
});

// 4. Handle results
const { results } = await pushResponse.json();
await handleSyncResults(results);
```

---

## Conflict Resolution Examples

### Example 1: Update Conflict - Server Wins

**Scenario:**
- Server: Task title = "Server version"
- Client: Task title = "Client version"
- Both modified after client's last sync

**Resolution (server_wins):**
```json
{
  "entity_id": "task-uuid",
  "success": true,
  "conflict": true,
  "resolution": "server_wins",
  "data": {
    "title": "Server version"
  }
}
```

### Example 2: Update Conflict - Client Wins

**Scenario:** Same as above

**Resolution (client_wins):**
```json
{
  "entity_id": "task-uuid",
  "success": true,
  "conflict": true,
  "resolution": "client_wins",
  "data": {
    "title": "Client version"
  }
}
```

### Example 3: No Conflict

**Scenario:**
- Server hasn't changed since client's last sync
- Client makes update

**Resolution:**
```json
{
  "entity_id": "task-uuid",
  "success": true,
  "conflict": false,
  "resolution": "no_conflict",
  "data": {
    "title": "Client version"
  }
}
```

---

## Error Handling

### Common Error Codes

| Code | Status | Description |
|------|--------|-------------|
| `SYNC_CONFLICT` | 409 | Conflict detected (fail_on_conflict mode) |
| `INVALID_OPERATION` | 400 | Invalid operation type |
| `VALIDATION_ERROR` | 400 | Invalid request data |
| `UNAUTHORIZED` | 401 | Missing or invalid auth token |
| `FORBIDDEN` | 403 | No access to workspace |
| `NOT_FOUND` | 404 | Entity not found |
| `RATE_LIMIT_EXCEEDED` | 429 | Too many requests |

### Error Response Format

```json
{
  "error": {
    "code": "SYNC_CONFLICT",
    "message": "Conflict detected for task uuid",
    "details": {
      "serverData": { /* ... */ },
      "clientData": { /* ... */ }
    }
  }
}
```

---

## Best Practices

### Device ID Generation

Generate a unique, persistent device ID:

```javascript
// Generate once and store in local storage
const deviceId = uuid.v4();
await AsyncStorage.setItem('device_id', deviceId);
```

### Sync Frequency

- **Real-time sync**: After each user action (if online)
- **Periodic sync**: Every 5-10 minutes (background)
- **On reconnect**: Immediate sync when network restored
- **Manual sync**: Pull-to-refresh gesture

### Conflict Strategy Selection

- **server_wins**: Default, safest option for most apps
- **client_wins**: Use when user's local changes should always take precedence
- **fail_on_conflict**: Use when conflicts need manual resolution

### Batch Size

- Limit push changes to 500 per request
- Split large sync operations into multiple batches
- Process results incrementally

### Error Recovery

```javascript
try {
  await syncWithServer();
} catch (error) {
  if (error.status === 409) {
    // Conflict - retry with different strategy
    await syncWithServer('client_wins');
  } else if (error.status === 429) {
    // Rate limited - wait and retry
    await delay(5000);
    await syncWithServer();
  } else {
    // Other errors - queue for later
    await queueFailedSync();
  }
}
```

---

## Testing

### Test Scenarios

1. **Full Sync**
   - Fresh device pulls all data
   - Verify all entities synced

2. **Incremental Sync**
   - Make changes on server
   - Device pulls only new changes
   - Verify last_sync_at updated

3. **Push Changes**
   - Create/update/delete locally
   - Push to server
   - Verify changes applied

4. **Conflict Resolution**
   - Modify same entity on server and client
   - Test all three strategies
   - Verify conflicts logged

5. **Network Failure**
   - Simulate offline mode
   - Queue changes locally
   - Sync when back online

6. **Multi-Device Sync**
   - Two devices, same user
   - Changes on device A
   - Device B pulls changes
   - Verify consistency

### Sample Test

```javascript
describe('Sync API', () => {
  it('should resolve update conflicts with server_wins', async () => {
    // Setup: Task exists on both server and client
    const taskId = 'test-task-uuid';
    
    // Server updates task
    await serverUpdateTask(taskId, { title: 'Server version' });
    
    // Client updates task (conflict!)
    const pushResult = await pushChanges([{
      entity_type: 'task',
      entity_id: taskId,
      operation: 'update',
      data: { title: 'Client version' },
      client_updated_at: new Date().toISOString()
    }], 'server_wins');
    
    // Verify server won
    expect(pushResult.results[0].conflict).toBe(true);
    expect(pushResult.results[0].resolution).toBe('server_wins');
    expect(pushResult.results[0].data.title).toBe('Server version');
    
    // Verify conflict logged
    const conflicts = await getConflicts();
    expect(conflicts.length).toBe(1);
  });
});
```

---

## Database Schema

### sync_metadata Table

Tracks sync state per device and entity type.

```sql
CREATE TABLE sync_metadata (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  workspace_id UUID NOT NULL,
  device_id VARCHAR(255) NOT NULL,
  entity_type VARCHAR(50) NOT NULL,
  last_sync_at TIMESTAMPTZ NOT NULL,
  last_sync_version BIGINT DEFAULT 0,
  sync_status VARCHAR(20) DEFAULT 'success',
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(user_id, workspace_id, device_id, entity_type)
);
```

### sync_conflicts Table

Logs conflicts for audit trail.

```sql
CREATE TABLE sync_conflicts (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  workspace_id UUID NOT NULL,
  device_id VARCHAR(255) NOT NULL,
  entity_type VARCHAR(50) NOT NULL,
  entity_id UUID NOT NULL,
  conflict_type VARCHAR(50) NOT NULL,
  resolution_strategy VARCHAR(50) NOT NULL,
  server_data JSONB,
  client_data JSONB,
  resolved_data JSONB,
  resolved_at TIMESTAMPTZ DEFAULT NOW(),
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## Migration

Apply the sync infrastructure migration:

```bash
# Run migration
psql -d your_database -f migrations/007_create_sync_infrastructure.sql
```

This creates:
- `sync_metadata` and `sync_conflicts` tables
- `updated_at` columns on all entity tables
- Automatic `updated_at` triggers
- RLS policies
- Helper functions

---

## Security

- All endpoints require authentication
- RLS policies enforce workspace access
- Users can only access their own sync metadata
- Sync conflicts are read-only for users
- Rate limiting prevents abuse

---

## Performance

- Indexes on `updated_at` for efficient change queries
- Composite indexes for sync metadata lookups
- Batch operations limited to 500 items
- Incremental sync reduces data transfer
- Connection pooling for concurrent requests
