# Analytics API Documentation

## Overview
The Analytics API enables tracking of user behavior and provides aggregated metrics for tasks, workspaces, and user activity.

## Base URL
```
/api/v1/analytics
```

## Authentication
All analytics endpoints require authentication via Bearer token in the Authorization header.

## Endpoints

### 1. Log Single Event
**Endpoint**: `POST /api/v1/analytics/events`

**Description**: Log a single analytics event.

**Request Body**:
```json
{
  "event_type": "task_completed",
  "workspace_id": "uuid-here",
  "event_data": {
    "task_id": "uuid-here",
    "created_at": "2024-01-01T00:00:00Z",
    "completion_time_hours": 24
  }
}
```

**Valid Event Types**:
- `task_created`
- `task_completed`
- `task_updated`
- `task_deleted`
- `search_performed`
- `attachment_uploaded`
- `comment_added`
- `label_applied`
- `project_created`
- `workspace_joined`
- `reminder_set`
- `filter_applied`
- `export_performed`
- `notification_clicked`
- `page_viewed`

**Response** (201 Created):
```json
{
  "success": true,
  "event": {
    "id": "uuid",
    "user_id": "uuid",
    "workspace_id": "uuid",
    "event_type": "task_completed",
    "event_data": { ... },
    "created_at": "2024-01-15T10:30:00Z"
  }
}
```

**Error Response** (400 Bad Request):
```json
{
  "error": "Invalid event_type",
  "valid_types": ["task_created", "task_completed", ...]
}
```

---

### 2. Log Batch Events
**Endpoint**: `POST /api/v1/analytics/events/batch`

**Description**: Log multiple analytics events in a single request (max 100 events).

**Request Body**:
```json
{
  "events": [
    {
      "event_type": "task_created",
      "workspace_id": "uuid-here",
      "event_data": { "task_id": "uuid-1" }
    },
    {
      "event_type": "search_performed",
      "workspace_id": "uuid-here",
      "event_data": { "query": "project", "results_count": 5 }
    }
  ]
}
```

**Response** (201 Created):
```json
{
  "success": true,
  "count": 2,
  "events": [ ... ]
}
```

**Error Response** (400 Bad Request):
```json
{
  "error": "Maximum 100 events per batch"
}
```

---

### 3. Get Analytics Dashboard
**Endpoint**: `GET /api/v1/analytics/dashboard`

**Description**: Get aggregated analytics dashboard data for the authenticated user.

**Query Parameters**:
- `workspace_id` (optional): Filter by specific workspace
- `start_date` (optional): Start date (ISO 8601), default: 30 days ago
- `end_date` (optional): End date (ISO 8601), default: now

**Example Request**:
```
GET /api/v1/analytics/dashboard?workspace_id=uuid&start_date=2024-01-01T00:00:00Z&end_date=2024-01-31T23:59:59Z
```

**Response** (200 OK):
```json
{
  "period": {
    "start_date": "2024-01-01T00:00:00Z",
    "end_date": "2024-01-31T23:59:59Z"
  },
  "task_metrics": {
    "total_created": 45,
    "total_completed": 38,
    "completion_rate": 84.44,
    "avg_completion_time_hours": 12.5
  },
  "event_counts": [
    { "event_type": "task_created", "event_count": 45 },
    { "event_type": "task_completed", "event_count": 38 },
    { "event_type": "search_performed", "event_count": 120 },
    { "event_type": "comment_added", "event_count": 15 }
  ],
  "daily_activity": [
    { "activity_date": "2024-01-01", "event_count": 12 },
    { "activity_date": "2024-01-02", "event_count": 18 },
    { "activity_date": "2024-01-03", "event_count": 25 }
  ],
  "workspace_id": "uuid-or-null"
}
```

**Error Response** (400 Bad Request):
```json
{
  "error": "start_date must be before end_date"
}
```

---

### 4. Get Workspace Analytics
**Endpoint**: `GET /api/v1/analytics/workspace/:workspaceId`

**Description**: Get workspace-level analytics. Requires workspace admin or owner role.

**Query Parameters**:
- `start_date` (optional): Start date (ISO 8601), default: 30 days ago
- `end_date` (optional): End date (ISO 8601), default: now

**Example Request**:
```
GET /api/v1/analytics/workspace/uuid?start_date=2024-01-01T00:00:00Z
```

**Response** (200 OK):
```json
{
  "workspace_id": "uuid",
  "period": {
    "start_date": "2024-01-01T00:00:00Z",
    "end_date": "2024-01-31T23:59:59Z"
  },
  "total_events": 450,
  "total_members": 8,
  "top_contributors": [
    {
      "user_id": "uuid-1",
      "full_name": "John Doe",
      "event_count": 125
    },
    {
      "user_id": "uuid-2",
      "full_name": "Jane Smith",
      "event_count": 98
    }
  ]
}
```

**Error Response** (403 Forbidden):
```json
{
  "error": "Access denied. Workspace admin required."
}
```

---

## Database Functions

### get_task_completion_metrics
Calculate task completion rate and average completion time.

**Parameters**:
- `p_user_id` (UUID): User ID
- `p_workspace_id` (UUID, optional): Workspace ID filter
- `p_start_date` (TIMESTAMP): Start date
- `p_end_date` (TIMESTAMP): End date

**Returns**:
```sql
TABLE (
  total_created INTEGER,
  total_completed INTEGER,
  completion_rate NUMERIC,
  avg_completion_time_hours NUMERIC
)
```

---

### get_event_counts_by_type
Get event counts grouped by event type.

**Parameters**:
- `p_user_id` (UUID): User ID
- `p_workspace_id` (UUID, optional): Workspace ID filter
- `p_start_date` (TIMESTAMP): Start date
- `p_end_date` (TIMESTAMP): End date

**Returns**:
```sql
TABLE (
  event_type VARCHAR,
  event_count BIGINT
)
```

---

### get_daily_activity
Get daily event counts for activity visualization.

**Parameters**:
- `p_user_id` (UUID): User ID
- `p_workspace_id` (UUID, optional): Workspace ID filter
- `p_start_date` (TIMESTAMP): Start date
- `p_end_date` (TIMESTAMP): End date

**Returns**:
```sql
TABLE (
  activity_date DATE,
  event_count BIGINT
)
```

---

## Security

### Row Level Security (RLS)
- Users can only **insert** their own events
- Users can **view** their own events
- Workspace **admins/owners** can view workspace events
- Events are **immutable** (no updates or deletes)

### Rate Limiting
Standard rate limiting applies (configured in middleware).

### Data Privacy
- Users only see their own analytics by default
- Workspace analytics require admin role
- Event data is stored securely with RLS

---

## Best Practices

### Event Logging
1. **Log events asynchronously** - Don't block user actions
2. **Use batch endpoint** for multiple events (more efficient)
3. **Include relevant metadata** in `event_data` field
4. **Handle failures gracefully** - Queue events if offline

### Event Data Structure
```json
{
  "event_type": "task_completed",
  "event_data": {
    "task_id": "uuid",
    "created_at": "2024-01-01T00:00:00Z",
    "completion_time_hours": 24,
    "priority": "high",
    "project_id": "uuid"
  }
}
```

Include enough context for meaningful analytics, but avoid PII or sensitive data.

### Date Ranges
- Use ISO 8601 format: `2024-01-15T10:30:00Z`
- Keep ranges reasonable (max 1 year recommended)
- Consider time zones when analyzing data

---

## Usage Examples

### JavaScript (Fetch API)
```javascript
// Log single event
const response = await fetch('/api/v1/analytics/events', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  },
  body: JSON.stringify({
    event_type: 'task_completed',
    workspace_id: workspaceId,
    event_data: {
      task_id: taskId,
      created_at: task.createdAt,
      completion_time_hours: 24
    }
  })
});

// Get dashboard
const dashboard = await fetch(
  `/api/v1/analytics/dashboard?workspace_id=${workspaceId}&start_date=${startDate}&end_date=${endDate}`,
  {
    headers: { 'Authorization': `Bearer ${token}` }
  }
).then(r => r.json());

console.log('Completion Rate:', dashboard.task_metrics.completion_rate);
```

### Dart (Flutter)
```dart
// Log event
final response = await dio.post('/analytics/events', data: {
  'event_type': 'task_completed',
  'workspace_id': workspaceId,
  'event_data': {
    'task_id': taskId,
    'created_at': task.createdAt.toIso8601String(),
  }
});

// Get dashboard
final dashboard = await dio.get('/analytics/dashboard', queryParameters: {
  'workspace_id': workspaceId,
  'start_date': startDate.toIso8601String(),
  'end_date': endDate.toIso8601String(),
});
```

---

## Error Codes

| Status Code | Description |
|-------------|-------------|
| 200 | Success |
| 201 | Event(s) created |
| 400 | Invalid request (bad event_type, invalid dates, etc.) |
| 401 | Unauthorized (missing or invalid token) |
| 403 | Forbidden (insufficient permissions) |
| 500 | Internal server error |

---

## Changelog

### Version 1.0.0 (2024-01-15)
- Initial analytics API implementation
- Event logging (single and batch)
- Dashboard endpoint
- Workspace analytics
- Database functions for aggregations
