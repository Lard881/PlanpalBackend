# Activity Feed API Documentation

## Overview
The Activity Feed API provides enhanced activity tracking, personalized feeds, read/unread status, user preferences, and workspace activity summaries.

**Base URL:** `/api/v1/activity-feed`

**Authentication:** Required for all endpoints

---

## Key Features

- **Personalized Feeds**: Filter activities based on user preferences
- **Read/Unread Tracking**: Track which activities have been seen
- **Activity Aggregation**: Group similar activities for cleaner display
- **User Preferences**: Customize feed filtering and email digest settings
- **Activity Summaries**: Pre-computed statistics for workspace activity
- **Flexible Filtering**: Filter by entity type, action, user, date range

---

## Endpoints

### 1. Get Personalized Activity Feed

Get a personalized activity feed based on user preferences and read status.

**Endpoint:** `GET /api/v1/activity-feed/personalized`

**Query Parameters:**
- `workspace_id` (uuid, required): Workspace ID
- `limit` (integer, optional): Number of activities to return (default: 50, max: 100)
- `offset` (integer, optional): Number of activities to skip (default: 0)
- `include_read` (boolean, optional): Include read activities (default: true)

**Response:** `200 OK`
```json
{
  "activities": [
    {
      "activity_id": "uuid",
      "entity_type": "task",
      "entity_id": "uuid",
      "action": "completed",
      "user_id": "uuid",
      "workspace_id": "uuid",
      "changes": {},
      "metadata": {},
      "created_at": "2024-01-01T12:00:00Z",
      "is_read": false,
      "user": {
        "id": "uuid",
        "name": "John Doe",
        "email": "john@example.com",
        "avatar_url": "https://..."
      },
      "entity_details": {
        "id": "uuid",
        "title": "Complete homepage design",
        "status": "completed",
        "project_id": "uuid"
      }
    }
  ],
  "pagination": {
    "limit": 50,
    "offset": 0,
    "has_more": true
  }
}
```

**Example:**
```bash
curl -X GET "https://api.planpal.com/api/v1/activity-feed/personalized?workspace_id=abc-123&limit=20&include_read=false" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

---

### 2. Get Aggregated Activity Feed

Get activities grouped by entity and action within time windows.

**Endpoint:** `GET /api/v1/activity-feed/aggregated`

**Query Parameters:**
- `workspace_id` (uuid, required): Workspace ID
- `entity_type` (string, optional): Filter by entity type (task, project, workspace, comment)
- `hours_back` (integer, optional): Hours to look back (default: 24, max: 720 = 30 days)
- `limit` (integer, optional): Number of groups to return (default: 50, max: 100)

**Response:** `200 OK`
```json
{
  "activities": [
    {
      "workspace_id": "uuid",
      "entity_type": "task",
      "entity_id": "uuid",
      "action": "updated",
      "user_id": "uuid",
      "activity_hour": "2024-01-01T12:00:00Z",
      "first_activity_at": "2024-01-01T12:05:00Z",
      "last_activity_at": "2024-01-01T12:45:00Z",
      "activity_count": 5,
      "activity_ids": ["uuid1", "uuid2", "uuid3", "uuid4", "uuid5"],
      "user_ids": ["uuid"],
      "all_metadata": {}
    }
  ],
  "aggregation_window_hours": 24,
  "limit": 50
}
```

**Use Case:** Display activity summaries like "John updated Task A 5 times in the last hour"

**Example:**
```bash
curl -X GET "https://api.planpal.com/api/v1/activity-feed/aggregated?workspace_id=abc-123&entity_type=task&hours_back=48" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

---

### 3. Mark Activities as Read

Mark specific activities as read.

**Endpoint:** `POST /api/v1/activity-feed/mark-read`

**Request Body:**
```json
{
  "activity_ids": ["uuid1", "uuid2", "uuid3"]
}
```

**Validation:**
- `activity_ids`: Required, array of 1-100 UUIDs

**Response:** `200 OK`
```json
{
  "marked_count": 3,
  "activity_ids": ["uuid1", "uuid2", "uuid3"]
}
```

**Example:**
```bash
curl -X POST "https://api.planpal.com/api/v1/activity-feed/mark-read" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "activity_ids": ["abc-123", "def-456"]
  }'
```

---

### 4. Mark All Activities as Read

Mark all unread activities in a workspace as read.

**Endpoint:** `POST /api/v1/activity-feed/mark-all-read`

**Query Parameters:**
- `workspace_id` (uuid, required): Workspace ID

**Response:** `200 OK`
```json
{
  "marked_count": 42
}
```

**Example:**
```bash
curl -X POST "https://api.planpal.com/api/v1/activity-feed/mark-all-read?workspace_id=abc-123" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

---

### 5. Get Unread Activity Count

Get the count of unread activities for a workspace.

**Endpoint:** `GET /api/v1/activity-feed/unread-count`

**Query Parameters:**
- `workspace_id` (uuid, required): Workspace ID

**Response:** `200 OK`
```json
{
  "workspace_id": "uuid",
  "unread_count": 15
}
```

**Example:**
```bash
curl -X GET "https://api.planpal.com/api/v1/activity-feed/unread-count?workspace_id=abc-123" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

---

### 6. Get Activity Preferences

Get user's activity feed preferences for a workspace.

**Endpoint:** `GET /api/v1/activity-feed/preferences/:workspace_id`

**URL Parameters:**
- `workspace_id`: Workspace UUID

**Response:** `200 OK`
```json
{
  "preferences": {
    "id": "uuid",
    "user_id": "uuid",
    "workspace_id": "uuid",
    "email_digest_frequency": "daily",
    "email_digest_enabled": true,
    "show_own_activities": false,
    "show_mentions": true,
    "show_assignments": true,
    "show_comments": true,
    "show_task_updates": true,
    "show_project_updates": true,
    "excluded_actions": ["deleted"],
    "followed_projects": ["uuid1", "uuid2"],
    "excluded_projects": [],
    "created_at": "2024-01-01T12:00:00Z",
    "updated_at": "2024-01-01T12:00:00Z"
  }
}
```

**Note:** If preferences don't exist, default preferences are automatically created.

**Example:**
```bash
curl -X GET "https://api.planpal.com/api/v1/activity-feed/preferences/abc-123" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

---

### 7. Update Activity Preferences

Update user's activity feed preferences for a workspace.

**Endpoint:** `PUT /api/v1/activity-feed/preferences/:workspace_id`

**URL Parameters:**
- `workspace_id`: Workspace UUID

**Request Body:** (all fields optional)
```json
{
  "email_digest_frequency": "daily",
  "email_digest_enabled": true,
  "show_own_activities": false,
  "show_mentions": true,
  "show_assignments": true,
  "show_comments": true,
  "show_task_updates": true,
  "show_project_updates": true,
  "excluded_actions": ["deleted", "moved"],
  "followed_projects": ["uuid1", "uuid2"],
  "excluded_projects": ["uuid3"]
}
```

**Field Descriptions:**
- `email_digest_frequency`: How often to send email digests (none, hourly, daily, weekly)
- `email_digest_enabled`: Enable/disable email digests
- `show_own_activities`: Show activities created by the user
- `show_mentions`: Show when user is mentioned
- `show_assignments`: Show task assignments
- `show_comments`: Show comment activities
- `show_task_updates`: Show task update activities
- `show_project_updates`: Show project update activities
- `excluded_actions`: Array of action types to hide
- `followed_projects`: Array of project IDs to always show
- `excluded_projects`: Array of project IDs to hide

**Response:** `200 OK`
```json
{
  "preferences": {
    "id": "uuid",
    "user_id": "uuid",
    "workspace_id": "uuid",
    "email_digest_frequency": "daily",
    ...
  }
}
```

**Example:**
```bash
curl -X PUT "https://api.planpal.com/api/v1/activity-feed/preferences/abc-123" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "email_digest_frequency": "weekly",
    "show_own_activities": true,
    "excluded_actions": ["deleted"]
  }'
```

---

### 8. Get Workspace Activity Summary

Get pre-computed activity statistics for a workspace.

**Endpoint:** `GET /api/v1/activity-feed/summary/:workspace_id`

**URL Parameters:**
- `workspace_id`: Workspace UUID

**Query Parameters:**
- `days_back` (integer, optional): Days to look back (default: 7, max: 90)

**Response:** `200 OK`
```json
{
  "workspace_id": "uuid",
  "period": {
    "days_back": 7,
    "start_date": "2024-01-01",
    "end_date": "2024-01-08"
  },
  "summary": {
    "total_activities": 142,
    "by_action": {
      "created": 25,
      "updated": 68,
      "completed": 15,
      "commented": 34
    },
    "by_day": {
      "2024-01-01": 18,
      "2024-01-02": 22,
      "2024-01-03": 20,
      "2024-01-04": 25,
      "2024-01-05": 19,
      "2024-01-06": 21,
      "2024-01-07": 17
    }
  },
  "raw_data": [...]
}
```

**Use Case:** Display workspace activity charts and statistics

**Example:**
```bash
curl -X GET "https://api.planpal.com/api/v1/activity-feed/summary/abc-123?days_back=30" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

---

### 9. Refresh Activity Summary

Manually refresh the activity summary materialized view.

**Endpoint:** `POST /api/v1/activity-feed/refresh-summary`

**Response:** `200 OK`
```json
{
  "message": "Activity summary refreshed successfully",
  "refreshed_at": "2024-01-01T12:00:00Z"
}
```

**Note:** This operation can be expensive. In production, should be called via cron or restricted to admins.

**Example:**
```bash
curl -X POST "https://api.planpal.com/api/v1/activity-feed/refresh-summary" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

---

## Database Schema

### activity_preferences Table
```sql
CREATE TABLE activity_preferences (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id),
  workspace_id UUID REFERENCES workspaces(id),
  email_digest_frequency VARCHAR(20),
  email_digest_enabled BOOLEAN,
  show_own_activities BOOLEAN,
  show_mentions BOOLEAN,
  show_assignments BOOLEAN,
  show_comments BOOLEAN,
  show_task_updates BOOLEAN,
  show_project_updates BOOLEAN,
  excluded_actions JSONB,
  followed_projects JSONB,
  excluded_projects JSONB,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  UNIQUE(user_id, workspace_id)
);
```

### activity_read_status Table
```sql
CREATE TABLE activity_read_status (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id),
  activity_id UUID REFERENCES activities(id),
  read_at TIMESTAMPTZ,
  UNIQUE(user_id, activity_id)
);
```

### activity_feed_aggregated View
Groups similar activities within hourly windows for cleaner display.

### workspace_activity_summary Materialized View
Pre-computed daily activity statistics per workspace (last 90 days).

---

## Database Functions

### get_personalized_activity_feed
Returns activities filtered by user preferences.

**Parameters:**
- `p_user_id`: User UUID
- `p_workspace_id`: Workspace UUID
- `p_limit`: Result limit
- `p_offset`: Result offset

### mark_activities_read
Marks multiple activities as read for a user.

**Parameters:**
- `p_user_id`: User UUID
- `p_activity_ids`: Array of activity UUIDs

**Returns:** Count of newly marked activities

### get_unread_activity_count
Returns count of unread activities for a user in a workspace.

**Parameters:**
- `p_user_id`: User UUID
- `p_workspace_id`: Workspace UUID

**Returns:** Integer count

### refresh_activity_summary
Refreshes the workspace_activity_summary materialized view.

---

## Activity Action Types

Supported activity actions:
- `created` - Entity was created
- `updated` - Entity was updated
- `deleted` - Entity was deleted
- `completed` - Task was completed
- `reopened` - Task was reopened
- `assigned` - Task was assigned to someone
- `unassigned` - Task assignment was removed
- `status_changed` - Task status changed
- `priority_changed` - Task priority changed
- `due_date_changed` - Task due date changed
- `moved` - Task moved to different project
- `commented` - Comment was added
- `mentioned` - User was mentioned

---

## Entity Types

- `task` - Task entity
- `project` - Project entity
- `workspace` - Workspace entity
- `comment` - Comment entity

---

## Integration with Other Features

### Mentions
When a mention is created, an activity with action `mentioned` is logged.

### Notifications
Activities can trigger notifications based on user preferences.

### Real-time Updates
Activities are broadcasted via WebSocket when created.

### Sync
Activity feed supports incremental sync via `updated_since` parameter.

---

## Best Practices

1. **Pagination**: Use offset-based pagination for large feeds
2. **Read Status**: Mark activities as read when user scrolls past them
3. **Preferences**: Allow users to customize their feed early in onboarding
4. **Aggregation**: Use aggregated feed for "grouped" display (e.g., "5 updates")
5. **Summary Refresh**: Refresh summary materialized view via cron job daily
6. **Filtering**: Use personalized feed endpoint for most use cases
7. **Unread Badge**: Poll unread-count endpoint or use WebSocket updates

---

## Performance Considerations

- **Materialized View**: Summary data is pre-computed; refresh periodically
- **Read Tracking**: Only tracks last 90 days to limit table size
- **Activity Retention**: Consider archiving activities older than 90 days
- **Indexes**: All key tables have appropriate indexes for performance
- **RLS**: All tables use Row Level Security for data isolation

---

## Example Workflows

### Display Activity Feed

1. Get user preferences:
```bash
GET /api/v1/activity-feed/preferences/{workspace_id}
```

2. Get personalized feed:
```bash
GET /api/v1/activity-feed/personalized?workspace_id={id}&limit=50
```

3. Mark visible activities as read:
```bash
POST /api/v1/activity-feed/mark-read
{
  "activity_ids": ["id1", "id2", "id3"]
}
```

### Configure Feed Preferences

1. Get current preferences:
```bash
GET /api/v1/activity-feed/preferences/{workspace_id}
```

2. Update preferences:
```bash
PUT /api/v1/activity-feed/preferences/{workspace_id}
{
  "show_own_activities": false,
  "excluded_actions": ["deleted"],
  "email_digest_frequency": "daily"
}
```

### Show Activity Statistics

1. Get workspace summary:
```bash
GET /api/v1/activity-feed/summary/{workspace_id}?days_back=30
```

2. Display charts using `by_action` and `by_day` data

---

## Error Codes

- `400 BAD_REQUEST`: Invalid request parameters
- `401 UNAUTHORIZED`: Missing or invalid authentication
- `403 FORBIDDEN`: User doesn't have access to workspace
- `404 NOT_FOUND`: Resource not found
- `429 TOO_MANY_REQUESTS`: Rate limit exceeded
- `500 INTERNAL_SERVER_ERROR`: Server error

---

## Rate Limiting

- Standard API limit: 100 requests per minute per user
- Summary refresh: Should be called via cron, not per-user requests

---

## Changelog

### Version 1.0 (Stage 15 - Task 2)
- Enhanced activity feed system
- Added personalized feed with user preferences
- Added read/unread tracking
- Added activity aggregation
- Added workspace activity summaries
- Added customizable email digest settings
- Added project follow/exclude functionality
