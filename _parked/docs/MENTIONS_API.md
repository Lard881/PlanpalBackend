# Mentions API Documentation

## Overview
The Mentions API enables users to tag/mention other team members in tasks and comments. Mentions create notifications and activity entries for mentioned users.

**Base URL:** `/api/v1/mentions`

**Authentication:** Required for all endpoints

---

## Endpoints

### 1. Get User's Mentions

Retrieve all mentions for the authenticated user.

**Endpoint:** `GET /api/v1/mentions`

**Query Parameters:**
- `is_read` (boolean, optional): Filter by read status
  - `true`: Only read mentions
  - `false`: Only unread mentions
  - Omit: All mentions
- `limit` (integer, optional): Number of mentions to return (default: 50, max: 100)
- `offset` (integer, optional): Number of mentions to skip (default: 0)

**Response:** `200 OK`
```json
{
  "mentions": [
    {
      "id": "uuid",
      "mention_type": "task|comment",
      "task_id": "uuid",
      "comment_id": "uuid|null",
      "mentioned_by_user_id": "uuid",
      "mentioned_by_user_name": "John Doe",
      "mentioned_by_user_email": "john@example.com",
      "mentioned_user_id": "uuid",
      "is_read": false,
      "created_at": "2024-01-01T12:00:00Z"
    }
  ],
  "total": 150,
  "limit": 50,
  "offset": 0
}
```

**Example:**
```bash
curl -X GET "https://api.planpal.com/api/v1/mentions?is_read=false&limit=20" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

---

### 2. Create Mention

Create a new mention (typically handled automatically by comment/task creation triggers, but can be called manually).

**Endpoint:** `POST /api/v1/mentions`

**Request Body:**
```json
{
  "mention_type": "task|comment",
  "task_id": "uuid",
  "comment_id": "uuid|null",
  "mentioned_user_id": "uuid"
}
```

**Response:** `201 Created`
```json
{
  "mention": {
    "id": "uuid",
    "mention_type": "comment",
    "task_id": "uuid",
    "comment_id": "uuid",
    "mentioned_by_user_id": "uuid",
    "mentioned_by_user_name": "John Doe",
    "mentioned_by_user_email": "john@example.com",
    "mentioned_user_id": "uuid",
    "is_read": false,
    "created_at": "2024-01-01T12:00:00Z"
  }
}
```

**Validation:**
- `mention_type`: Required, must be 'task' or 'comment'
- `task_id`: Required, must be valid UUID and exist
- `comment_id`: Required if mention_type is 'comment'
- `mentioned_user_id`: Required, must be valid UUID and exist

**Errors:**
- `400 BAD_REQUEST`: Invalid or missing required fields
- `403 FORBIDDEN`: User doesn't have access to the task
- `404 NOT_FOUND`: Task or comment not found

**Example:**
```bash
curl -X POST "https://api.planpal.com/api/v1/mentions" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "mention_type": "comment",
    "task_id": "abc-123",
    "comment_id": "def-456",
    "mentioned_user_id": "ghi-789"
  }'
```

---

### 3. Mark Mention as Read

Mark a specific mention as read.

**Endpoint:** `PUT /api/v1/mentions/:id/read`

**URL Parameters:**
- `id`: Mention UUID

**Response:** `200 OK`
```json
{
  "mention": {
    "id": "uuid",
    "mention_type": "comment",
    "task_id": "uuid",
    "comment_id": "uuid",
    "mentioned_by_user_id": "uuid",
    "mentioned_by_user_name": "John Doe",
    "mentioned_by_user_email": "john@example.com",
    "mentioned_user_id": "uuid",
    "is_read": true,
    "created_at": "2024-01-01T12:00:00Z"
  }
}
```

**Errors:**
- `403 FORBIDDEN`: User doesn't have access to this mention
- `404 NOT_FOUND`: Mention not found

**Example:**
```bash
curl -X PUT "https://api.planpal.com/api/v1/mentions/abc-123/read" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

---

### 4. Mark All Mentions as Read

Mark all unread mentions for the authenticated user as read.

**Endpoint:** `PUT /api/v1/mentions/read-all`

**Response:** `200 OK`
```json
{
  "updated_count": 15
}
```

**Example:**
```bash
curl -X PUT "https://api.planpal.com/api/v1/mentions/read-all" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

---

### 5. Delete Mention

Delete a specific mention.

**Endpoint:** `DELETE /api/v1/mentions/:id`

**URL Parameters:**
- `id`: Mention UUID

**Response:** `204 No Content`

**Errors:**
- `403 FORBIDDEN`: User doesn't have access to this mention
- `404 NOT_FOUND`: Mention not found

**Example:**
```bash
curl -X DELETE "https://api.planpal.com/api/v1/mentions/abc-123" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

---

### 6. Search Users for Mentions

Search for users to mention (by name or email).

**Endpoint:** `GET /api/v1/mentions/users/search`

**Query Parameters:**
- `q` (string, required): Search query (min 2 characters)
- `workspace_id` (uuid, optional): Filter to workspace members
- `limit` (integer, optional): Number of users to return (default: 10, max: 50)

**Response:** `200 OK`
```json
{
  "users": [
    {
      "id": "uuid",
      "full_name": "John Doe",
      "email": "john@example.com",
      "avatar_url": "https://example.com/avatar.jpg"
    }
  ]
}
```

**Validation:**
- `q`: Minimum 2 characters required

**Errors:**
- `400 BAD_REQUEST`: Query too short

**Example:**
```bash
curl -X GET "https://api.planpal.com/api/v1/mentions/users/search?q=john&workspace_id=abc-123" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

---

## Automatic Mention Detection

Mentions are automatically detected and created when:

1. **Creating/Updating Tasks**: Task description is scanned for @mentions
2. **Creating/Updating Comments**: Comment content is scanned for @mentions

**Mention Format:** `@[user_id]` or `@[email]`

**Trigger Behavior:**
- Database triggers call `extract_mentions_from_text()` function
- Function extracts all @mentions using regex
- Creates mention records for each unique mentioned user
- Generates notifications and activity entries

**Example Text with Mentions:**
```
Hey @[john@example.com], can you review this task? 
Also cc @[abc-123-user-id] for visibility.
```

---

## Database Schema

### mentions Table
```sql
CREATE TABLE mentions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  mention_type VARCHAR(20) NOT NULL CHECK (mention_type IN ('task', 'comment')),
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  comment_id UUID REFERENCES comments(id) ON DELETE CASCADE,
  mentioned_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mentioned_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  is_read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Constraint: comment_id required if mention_type is 'comment'
  CHECK (
    (mention_type = 'task' AND comment_id IS NULL) OR
    (mention_type = 'comment' AND comment_id IS NOT NULL)
  ),
  
  -- Prevent duplicate mentions
  UNIQUE (mention_type, task_id, comment_id, mentioned_user_id)
);
```

**Indexes:**
- `idx_mentions_mentioned_user` on `mentioned_user_id, is_read, created_at DESC`
- `idx_mentions_task` on `task_id`
- `idx_mentions_comment` on `comment_id`

---

## Security & Permissions

**Row-Level Security (RLS):** Enabled

**Policies:**
1. **Select**: Users can see mentions where they are the mentioned user OR they have access to the task
2. **Insert**: Users can create mentions for tasks they have access to
3. **Update**: Users can update only their own mentions (where they are mentioned_user_id)
4. **Delete**: Users can delete only their own mentions

**Workspace Boundaries:**
- Mentions are scoped to tasks
- Users can only mention other users who have access to the task's workspace
- Search endpoint filters results to workspace members when workspace_id is provided

---

## Integration with Other Features

### Notifications
When a mention is created:
- Notification record is created for mentioned user
- Type: `mention_task` or `mention_comment`
- Push notification sent if user has device tokens

### Activity Feed
Mention creation generates activity entry:
- Action: `mentioned`
- Entity: task or comment
- Visible to all task collaborators

### Real-time Updates
- WebSocket events sent when mention is created/updated
- Event type: `mention.created`, `mention.read`

---

## Best Practices

1. **Mention Detection**: Use the automatic triggers when possible instead of manual API calls
2. **User Search**: Implement debounced search to avoid excessive API calls
3. **Read Status**: Mark mentions as read when user views the referenced task/comment
4. **Pagination**: Use limit/offset for large mention lists
5. **Workspace Context**: Always provide workspace_id in user search for better filtering

---

## Examples

### Complete Flow: Creating a Comment with Mentions

1. User types comment with mentions:
```
"@[john@example.com] can you review this? cc @[jane@example.com]"
```

2. Frontend creates comment:
```bash
curl -X POST "https://api.planpal.com/api/v1/comments" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "task_id": "task-uuid",
    "content": "@[john@example.com] can you review this? cc @[jane@example.com]"
  }'
```

3. Database trigger automatically:
   - Extracts @mentions
   - Creates 2 mention records
   - Creates 2 notifications
   - Creates 2 activity entries

4. Frontend receives WebSocket events:
   - `mention.created` for John
   - `mention.created` for Jane

5. John and Jane see new mentions:
```bash
curl -X GET "https://api.planpal.com/api/v1/mentions?is_read=false" \
  -H "Authorization: Bearer JOHN_TOKEN"
```

6. John marks mention as read:
```bash
curl -X PUT "https://api.planpal.com/api/v1/mentions/mention-uuid/read" \
  -H "Authorization: Bearer JOHN_TOKEN"
```

---

## Error Codes

- `400 BAD_REQUEST`: Invalid request body or parameters
- `401 UNAUTHORIZED`: Missing or invalid authentication token
- `403 FORBIDDEN`: User doesn't have permission for this resource
- `404 NOT_FOUND`: Mention, task, or comment not found
- `429 TOO_MANY_REQUESTS`: Rate limit exceeded
- `500 INTERNAL_SERVER_ERROR`: Server error

---

## Rate Limiting

- General API limit: 100 requests per minute per user
- Search endpoint: 30 requests per minute per user
- Burst allowance: 10 requests

---

## Changelog

### Version 1.0 (Stage 15)
- Initial mentions API implementation
- Automatic mention detection in tasks and comments
- User search for mentions
- Read/unread status tracking
- Integration with notifications and activity feed
