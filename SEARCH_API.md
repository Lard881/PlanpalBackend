# Search API Documentation

## Overview

The Search API provides global search functionality across tasks, documents, and people within PlanPal. It respects workspace permissions and Row-Level Security (RLS) policies.

## Endpoint

```
GET /api/v1/search
```

## Authentication

Requires valid JWT token in Authorization header:
```
Authorization: Bearer <token>
```

## Query Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `query` | string | ✅ Yes | - | Search term (min 2, max 100 characters) |
| `type` | enum | No | `all` | Filter by type: `all`, `tasks`, `documents`, `people` |
| `workspaceId` | uuid | No | null | Limit search to specific workspace |
| `limit` | integer | No | `20` | Max results per type (1-100) |
| `offset` | integer | No | `0` | Pagination offset |

## Request Examples

### Basic Search (All Types)

```bash
GET /api/v1/search?query=project
```

### Search Tasks Only

```bash
GET /api/v1/search?query=urgent&type=tasks
```

### Search in Specific Workspace

```bash
GET /api/v1/search?query=meeting&workspaceId=550e8400-e29b-41d4-a716-446655440000
```

### Paginated Search

```bash
GET /api/v1/search?query=report&limit=10&offset=10
```

### Combined Filters

```bash
GET /api/v1/search?query=design&type=documents&workspaceId=550e8400-e29b-41d4-a716-446655440000&limit=5
```

## Response Format

### Success Response (200 OK)

```json
{
  "query": "project",
  "type": "all",
  "workspaceId": null,
  "totalCount": 15,
  "tasks": {
    "items": [
      {
        "id": "task-uuid",
        "type": "task",
        "title": "Project Planning",
        "description": "Plan the new project timeline",
        "status": "in_progress",
        "priority": "high",
        "dueDate": "2024-12-31T23:59:59Z",
        "workspaceId": "workspace-uuid",
        "workspaceName": "Engineering",
        "projectId": "project-uuid",
        "assignedTo": "user-uuid",
        "createdAt": "2024-11-01T10:00:00Z",
        "matchScore": 100
      }
    ],
    "count": 8
  },
  "documents": {
    "items": [
      {
        "id": "doc-uuid",
        "type": "document",
        "title": "Project Specification",
        "content": "This document outlines the project requirements...",
        "workspaceId": "workspace-uuid",
        "workspaceName": "Engineering",
        "folderId": "folder-uuid",
        "createdBy": "user-uuid",
        "createdAt": "2024-11-02T14:30:00Z",
        "updatedAt": "2024-11-15T09:20:00Z",
        "matchScore": 80
      }
    ],
    "count": 5
  },
  "people": {
    "items": [
      {
        "id": "user-uuid",
        "type": "person",
        "fullName": "John Doe",
        "email": "john@example.com",
        "avatarUrl": "https://...",
        "workspaces": [
          {
            "id": "workspace-uuid",
            "name": "Engineering",
            "role": "member"
          }
        ],
        "matchScore": 50
      }
    ],
    "count": 2
  }
}
```

### Error Response (400 Bad Request)

```json
{
  "error": "Validation failed",
  "details": [
    {
      "field": "query",
      "message": "Search query must be at least 2 characters"
    }
  ]
}
```

### Error Response (500 Internal Server Error)

```json
{
  "error": "Search failed"
}
```

## Search Behavior

### Match Scoring

Results are ranked by relevance using a simple scoring algorithm (0-100):

- **100 points**: Exact match with search term
- **80 points**: Field starts with search term
- **50 points**: Field contains search term
- **30 points**: Word in field starts with search term
- **0 points**: No match

Results are sorted by `matchScore` in descending order within each type.

### Search Fields

**Tasks:**
- `title` (weighted higher)
- `description`

**Documents:**
- `title` (weighted higher)
- `content` (first 200 characters in results)

**People:**
- `full_name`
- `email`

### Case Sensitivity

All searches are **case-insensitive**.

### Minimum Query Length

Search queries must be at least **2 characters** long to prevent performance issues.

### People Deduplication

When searching people:
- Results are deduplicated by `user_id`
- If a person is in multiple workspaces, all their workspaces are included
- Each person appears only once in results
- Without `workspaceId` filter: returns people from all user's workspaces
- With `workspaceId` filter: returns only people in that workspace

### Privacy & Security

**Row-Level Security (RLS):**
- Users can only search content in workspaces they have access to
- RLS policies are enforced at the database level
- No cross-workspace data leakage

**Workspace Filtering:**
- Without `workspaceId`: searches all user's workspaces
- With `workspaceId`: searches only that workspace
- Invalid workspace IDs return empty results (not an error)

**Guest User Limits:**
- Guest users follow the same RLS rules
- Can only search workspaces they're invited to
- Cannot see workspace members beyond their access

## Performance Considerations

### Query Optimization

- Search uses database indexes on `title`, `description`, `content`, `full_name`, `email`
- Results are paginated to prevent large result sets
- Content is truncated to 200 characters for documents

### Rate Limiting

Search endpoint is subject to general API rate limits:
- 100 requests per 15 minutes per user

### Caching

Currently no caching implemented. Consider adding:
- Redis cache for popular search terms
- Cache invalidation on content updates

## Usage Examples

### Frontend Integration

```javascript
// Search function
async function searchGlobal(query, filters = {}) {
  const params = new URLSearchParams({
    query,
    ...filters
  });
  
  const response = await fetch(`/api/v1/search?${params}`, {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
  
  return await response.json();
}

// Search all types
const results = await searchGlobal('project');

// Search tasks only in specific workspace
const taskResults = await searchGlobal('urgent', {
  type: 'tasks',
  workspaceId: 'workspace-uuid'
});

// Paginated search
const page2 = await searchGlobal('design', {
  limit: 20,
  offset: 20
});
```

### cURL Examples

**Search everything:**
```bash
curl -X GET \
  'http://localhost:3000/api/v1/search?query=project' \
  -H 'Authorization: Bearer eyJhbGc...'
```

**Search tasks with workspace filter:**
```bash
curl -X GET \
  'http://localhost:3000/api/v1/search?query=urgent&type=tasks&workspaceId=550e8400-e29b-41d4-a716-446655440000' \
  -H 'Authorization: Bearer eyJhbGc...'
```

**Search people:**
```bash
curl -X GET \
  'http://localhost:3000/api/v1/search?query=john&type=people' \
  -H 'Authorization: Bearer eyJhbGc...'
```

## Testing

### Test Cases

1. **Minimum Query Length**: Query < 2 chars should return 400
2. **Privacy Enforcement**: User A cannot see User B's workspace content
3. **People Deduplication**: Same person in multiple workspaces appears once
4. **Workspace Filtering**: `workspaceId` filter correctly scopes results
5. **Type Filtering**: `type` parameter correctly filters result types
6. **Match Scoring**: Results are ordered by relevance
7. **Pagination**: `limit` and `offset` work correctly
8. **Case Insensitivity**: "Project", "project", "PROJECT" return same results
9. **Special Characters**: Search handles special characters safely
10. **Empty Results**: Returns empty arrays (not errors) when no matches

### Manual Testing Script

```bash
#!/bin/bash

TOKEN="your-jwt-token"
BASE_URL="http://localhost:3000/api/v1"

# Test 1: Basic search
echo "Test 1: Basic search"
curl -s -X GET "$BASE_URL/search?query=test" \
  -H "Authorization: Bearer $TOKEN" | jq

# Test 2: Minimum length validation
echo "Test 2: Minimum length (should fail)"
curl -s -X GET "$BASE_URL/search?query=a" \
  -H "Authorization: Bearer $TOKEN" | jq

# Test 3: Type filter
echo "Test 3: Tasks only"
curl -s -X GET "$BASE_URL/search?query=test&type=tasks" \
  -H "Authorization: Bearer $TOKEN" | jq '.tasks'

# Test 4: Workspace filter
echo "Test 4: Workspace scope"
curl -s -X GET "$BASE_URL/search?query=test&workspaceId=WORKSPACE_UUID" \
  -H "Authorization: Bearer $TOKEN" | jq

# Test 5: Pagination
echo "Test 5: Pagination"
curl -s -X GET "$BASE_URL/search?query=test&limit=5&offset=0" \
  -H "Authorization: Bearer $TOKEN" | jq '.totalCount'
```

## Future Enhancements

- [ ] Full-text search with PostgreSQL `tsvector`
- [ ] Fuzzy matching for typos
- [ ] Search suggestions/autocomplete
- [ ] Recent searches history
- [ ] Search analytics
- [ ] Faceted search (filter by date, priority, status, etc.)
- [ ] Advanced query syntax (AND, OR, NOT, quotes)
- [ ] Search within specific projects
- [ ] Elasticsearch integration for better performance
- [ ] Search result highlights (show matching text snippets)
- [ ] Saved searches

## Troubleshooting

**Issue: No results returned**
- Check user has access to workspaces
- Verify search term is at least 2 characters
- Check if `workspaceId` filter is too restrictive

**Issue: Slow search performance**
- Verify database indexes exist
- Consider reducing `limit` parameter
- Check for long search queries (>50 chars)
- Monitor database query performance

**Issue: People appear multiple times**
- This is a bug - people should be deduplicated
- Check `searchPeople()` deduplication logic

**Issue: Search returns other users' private data**
- CRITICAL SECURITY ISSUE
- Verify RLS policies are enabled
- Check workspace membership queries
