# Stage 17: Advanced Features API Documentation

Complete API reference for custom fields, task templates, time tracking, saved views, and export functionality.

---

## Table of Contents

1. [Custom Fields API](#custom-fields-api)
2. [Task Templates API](#task-templates-api)
3. [Time Tracking API](#time-tracking-api)
4. [Saved Views API](#saved-views-api)
5. [Export API](#export-api)

---

## Custom Fields API

### Overview

Custom fields allow workspaces to define additional fields for tasks and projects with various data types and validation rules.

**Supported Field Types:**
- `text` - Text input (with optional max length)
- `number` - Numeric values (with min/max validation)
- `date` - Date only
- `datetime` - Date and time
- `dropdown` - Single or multi-select from options
- `checkbox` - Boolean value
- `url` - URL with validation
- `email` - Email with validation
- `phone` - Phone number

### Endpoints

#### 1. List Custom Fields for Workspace

```http
GET /api/v1/custom-fields/workspace/:workspaceId
```

**Query Parameters:**
- `include_inactive` (boolean, optional) - Include inactive fields. Default: false

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "workspace_id": "uuid",
      "name": "Budget",
      "description": "Project budget amount",
      "field_type": "number",
      "config": {
        "min": 0,
        "max": 1000000,
        "decimal_places": 2,
        "prefix": "$"
      },
      "is_required": false,
      "default_value": null,
      "icon": "💰",
      "color": "#4CAF50",
      "display_order": 0,
      "applies_to_projects": true,
      "applies_to_tasks": false,
      "is_active": true,
      "created_by": "uuid",
      "created_at": "2024-01-01T00:00:00Z",
      "updated_at": "2024-01-01T00:00:00Z"
    }
  ],
  "count": 1
}
```

#### 2. Get Custom Field by ID

```http
GET /api/v1/custom-fields/:id
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "name": "Budget",
    "field_type": "number",
    "value_count": {
      "task_value_count": 15,
      "project_value_count": 8
    },
    ...
  }
}
```

#### 3. Create Custom Field

```http
POST /api/v1/custom-fields
```

**Required Role:** Admin or Owner

**Request Body:**
```json
{
  "workspace_id": "uuid",
  "name": "Priority Score",
  "description": "Numeric priority score",
  "field_type": "number",
  "config": {
    "min": 1,
    "max": 10,
    "decimal_places": 0
  },
  "is_required": false,
  "default_value": "5",
  "icon": "🎯",
  "color": "#FF5722",
  "display_order": 0,
  "applies_to_projects": true,
  "applies_to_tasks": true
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "name": "Priority Score",
    ...
  }
}
```

#### 4. Update Custom Field

```http
PUT /api/v1/custom-fields/:id
```

**Required Role:** Admin or Owner

**Request Body:** (all fields optional)
```json
{
  "name": "Updated Name",
  "description": "Updated description",
  "config": {},
  "is_required": true,
  "is_active": false
}
```

#### 5. Delete Custom Field

```http
DELETE /api/v1/custom-fields/:id
```

**Query Parameters:**
- `hard_delete` (boolean, optional) - Permanently delete. Default: false (soft delete)

**Required Role:** Admin or Owner

#### 6. Reorder Custom Fields

```http
POST /api/v1/custom-fields/reorder
```

**Request Body:**
```json
{
  "workspace_id": "uuid",
  "field_order": ["field_id_1", "field_id_2", "field_id_3"]
}
```

#### 7. Get Custom Field Values for Entity

```http
GET /api/v1/custom-fields/values/:entityType/:entityId
```

**Path Parameters:**
- `entityType` - "task" or "project"
- `entityId` - UUID of the task or project

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "field_id": "uuid",
      "field_name": "Budget",
      "field_type": "number",
      "value": "50000",
      "value_numeric": 50000,
      "value_date": null,
      "value_boolean": null,
      "field_config": {},
      "is_required": false
    }
  ],
  "count": 1
}
```

#### 8. Set Custom Field Value

```http
POST /api/v1/custom-fields/values
```

**Request Body:**
```json
{
  "field_id": "uuid",
  "entity_type": "task",
  "entity_id": "uuid",
  "value": "50000"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "value_id": "uuid"
  },
  "message": "Custom field value set successfully"
}
```

#### 9. Bulk Set Custom Field Values

```http
POST /api/v1/custom-fields/values/bulk
```

**Request Body:**
```json
{
  "entity_type": "task",
  "entity_id": "uuid",
  "field_values": {
    "field_id_1": "value1",
    "field_id_2": "value2",
    "field_id_3": "value3"
  }
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "fields_updated": 3
  }
}
```

#### 10. Delete Custom Field Value

```http
DELETE /api/v1/custom-fields/values/:entityType/:entityId/:fieldId
```

#### 11. Get Value Change History

```http
GET /api/v1/custom-fields/history/:fieldId
```

**Query Parameters:**
- `entity_type` (string, optional)
- `entity_id` (string, optional)
- `limit` (number, optional) - Default: 50
- `offset` (number, optional) - Default: 0

#### 12. Validate Field Value

```http
POST /api/v1/custom-fields/validate
```

**Request Body:**
```json
{
  "field_id": "uuid",
  "value": "test@example.com"
}
```

**Response:**
```json
{
  "success": true,
  "valid": true
}
```

---

## Task Templates API

### Overview

Task templates allow users to create reusable task structures with subtasks, checklists, and default settings.

**Note:** Templates are stored in the database. To use templates, call the database function via RPC.

### Database Functions (via Supabase RPC)

#### 1. Create Task from Template

```javascript
const { data, error } = await supabase.rpc('create_task_from_template', {
  p_template_id: 'template-uuid',
  p_user_id: 'user-uuid',
  p_workspace_id: 'workspace-uuid',
  p_project_id: 'project-uuid', // optional
  p_assignee_id: 'user-uuid', // optional
  p_due_date: '2024-12-31T23:59:59Z', // optional
  p_overrides: {
    title: 'Custom Title',
    priority: 'high'
  }
});

// Returns: UUID of created task
```

#### 2. Save Task as Template

```javascript
const { data, error } = await supabase.rpc('save_task_as_template', {
  p_task_id: 'task-uuid',
  p_user_id: 'user-uuid',
  p_template_name: 'My Template',
  p_template_description: 'Description of template',
  p_category: 'Bug Report',
  p_is_public: false
});

// Returns: UUID of created template
```

#### 3. Get Template Details

```javascript
const { data, error } = await supabase.rpc('get_template_details', {
  p_template_id: 'template-uuid'
});

// Returns complete template with subtasks and checklist items
```

#### 4. Duplicate Template

```javascript
const { data, error } = await supabase.rpc('duplicate_template', {
  p_template_id: 'template-uuid',
  p_user_id: 'user-uuid',
  p_new_name: 'Copy of Template'
});

// Returns: UUID of new template
```

### Direct Table Access

You can also query templates directly:

```javascript
// List templates in workspace
const { data, error } = await supabase
  .from('task_templates')
  .select(`
    *,
    subtasks:template_subtasks(*),
    checklist:template_checklist_items(*)
  `)
  .eq('workspace_id', workspaceId)
  .eq('is_active', true);

// Get popular templates
const { data, error } = await supabase
  .from('popular_templates')
  .select('*')
  .eq('workspace_id', workspaceId)
  .limit(10);
```

---

## Time Tracking API

### Overview

Track time spent on tasks with timer functionality and manual entries. Supports billable hours, time reports, and workspace-level settings.

### Database Functions (via Supabase RPC)

#### 1. Start Timer

```javascript
const { data, error } = await supabase.rpc('start_timer', {
  p_task_id: 'task-uuid',
  p_user_id: 'user-uuid',
  p_description: 'Working on implementation',
  p_tags: ['development', 'feature-x']
});

// Returns: UUID of time entry
```

**Error Cases:**
- User already has a running timer (must stop first)
- Task not found

#### 2. Stop Timer

```javascript
const { data, error } = await supabase.rpc('stop_timer', {
  p_entry_id: 'entry-uuid',
  p_user_id: 'user-uuid'
});

// Returns: Complete time entry record with calculated duration
```

#### 3. Get Running Timer

```javascript
const { data, error } = await supabase.rpc('get_running_timer', {
  p_user_id: 'user-uuid'
});

// Returns: Current running timer with elapsed time
```

**Response:**
```json
{
  "entry_id": "uuid",
  "task_id": "uuid",
  "task_title": "Implement feature X",
  "start_time": "2024-01-15T10:00:00Z",
  "elapsed_seconds": 3600,
  "description": "Working on implementation"
}
```

#### 4. Add Manual Time Entry

```javascript
const { data, error } = await supabase.rpc('add_manual_time_entry', {
  p_task_id: 'task-uuid',
  p_user_id: 'user-uuid',
  p_start_time: '2024-01-15T09:00:00Z',
  p_end_time: '2024-01-15T11:00:00Z',
  p_description: 'Morning work session',
  p_is_billable: true,
  p_tags: ['development']
});

// Returns: UUID of time entry
```

**Validation:**
- Workspace settings checked (manual entries allowed?)
- End time must be after start time
- Future entries may be restricted
- Max daily hours enforced

#### 5. Update Time Entry

```javascript
const { data, error } = await supabase.rpc('update_time_entry', {
  p_entry_id: 'entry-uuid',
  p_user_id: 'user-uuid',
  p_updates: {
    start_time: '2024-01-15T09:30:00Z',
    description: 'Updated description',
    is_billable: true,
    hourly_rate: 75.00
  },
  p_edit_reason: 'Correcting start time',
  p_ip_address: '192.168.1.1',
  p_user_agent: 'Mozilla/5.0...'
});

// Creates audit trail entry automatically
```

#### 6. Get Task Time Summary

```javascript
const { data, error } = await supabase.rpc('get_task_time_summary', {
  p_task_id: 'task-uuid'
});
```

**Response:**
```json
{
  "total_seconds": 14400,
  "total_hours": 4.0,
  "billable_seconds": 7200,
  "billable_hours": 2.0,
  "entry_count": 5,
  "last_entry_at": "2024-01-15T15:00:00Z"
}
```

#### 7. Get Workspace Time Report

```javascript
const { data, error } = await supabase.rpc('get_workspace_time_report', {
  p_workspace_id: 'workspace-uuid',
  p_start_date: '2024-01-01T00:00:00Z',
  p_end_date: '2024-01-31T23:59:59Z',
  p_user_id: null, // optional filter
  p_project_id: null // optional filter
});
```

**Response:**
```json
[
  {
    "user_id": "uuid",
    "user_email": "user@example.com",
    "user_name": "John Doe",
    "total_seconds": 144000,
    "total_hours": 40.0,
    "billable_seconds": 72000,
    "billable_hours": 20.0,
    "billable_amount": 1500.00,
    "entry_count": 15
  }
]
```

### Direct Table Queries

```javascript
// List time entries for task
const { data, error } = await supabase
  .from('time_entries_detailed')
  .select('*')
  .eq('task_id', taskId)
  .order('start_time', { ascending: false });

// Get edit history
const { data, error } = await supabase
  .from('time_entry_edits')
  .select(`
    *,
    edited_by_user:edited_by(email, full_name)
  `)
  .eq('time_entry_id', entryId)
  .order('edited_at', { ascending: false });

// Get workspace time settings
const { data, error } = await supabase
  .from('workspace_time_settings')
  .select('*')
  .eq('workspace_id', workspaceId)
  .single();
```

---

## Saved Views API

### Overview

Save complex filter combinations and custom views for tasks/projects. Views can be shared within the workspace.

### Database Functions (via Supabase RPC)

#### 1. Set Default View

```javascript
const { data, error } = await supabase.rpc('set_default_view', {
  p_view_id: 'view-uuid',
  p_user_id: 'user-uuid'
});
```

#### 2. Duplicate View

```javascript
const { data, error } = await supabase.rpc('duplicate_view', {
  p_view_id: 'view-uuid',
  p_user_id: 'user-uuid',
  p_new_name: 'Copy of My View'
});
```

#### 3. Track View Usage

```javascript
const { data, error } = await supabase.rpc('track_view_usage', {
  p_view_id: 'view-uuid'
});
```

#### 4. Get User's Accessible Views

```javascript
const { data, error } = await supabase.rpc('get_user_views', {
  p_user_id: 'user-uuid',
  p_workspace_id: 'workspace-uuid',
  p_entity_type: 'tasks' // or 'projects', or null for all
});
```

**Response:**
```json
[
  {
    "view_id": "uuid",
    "view_name": "My Tasks - High Priority",
    "view_description": "All high priority tasks assigned to me",
    "view_type": "list",
    "entity_type": "tasks",
    "filters": {
      "priority": ["high", "urgent"],
      "assigned_to": ["user-uuid"],
      "status": ["todo", "in_progress"]
    },
    "sort_by": "due_date",
    "sort_order": "asc",
    "group_by": "project",
    "is_public": false,
    "is_default": true,
    "is_favorite": true,
    "is_owner": true,
    "can_edit": true,
    "use_count": 42,
    "last_used_at": "2024-01-15T10:00:00Z",
    "created_by": "uuid",
    "creator_name": "John Doe",
    "created_at": "2024-01-01T00:00:00Z"
  }
]
```

### Direct Table Operations

#### Create Saved View

```javascript
const { data, error } = await supabase
  .from('saved_views')
  .insert({
    workspace_id: 'workspace-uuid',
    name: 'My Custom View',
    description: 'Tasks due this week',
    view_type: 'list',
    entity_type: 'tasks',
    filters: {
      status: ['todo', 'in_progress'],
      due_date: {
        from: '2024-01-15',
        to: '2024-01-21'
      }
    },
    sort_by: 'due_date',
    sort_order: 'asc',
    group_by: 'priority',
    visible_columns: ['title', 'status', 'priority', 'due_date', 'assignee'],
    is_public: false,
    created_by: 'user-uuid'
  })
  .select()
  .single();
```

#### Share View

```javascript
// Share with specific user
const { data, error } = await supabase
  .from('view_shares')
  .insert({
    view_id: 'view-uuid',
    shared_with_user_id: 'user-uuid',
    can_edit: false,
    shared_by: 'owner-uuid'
  });

// Share with entire workspace
const { data, error } = await supabase
  .from('view_shares')
  .insert({
    view_id: 'view-uuid',
    shared_with_workspace: true,
    can_edit: false,
    shared_by: 'owner-uuid'
  });
```

#### Add to Favorites

```javascript
const { data, error } = await supabase
  .from('view_favorites')
  .insert({
    user_id: 'user-uuid',
    view_id: 'view-uuid',
    display_order: 0
  });
```

#### Query Public Views

```javascript
const { data, error } = await supabase
  .from('public_views_summary')
  .select('*')
  .eq('workspace_id', workspaceId)
  .order('use_count', { ascending: false })
  .limit(10);
```

---

## Export API

### Overview

Export tasks, projects, time entries, and entire workspaces to CSV or JSON formats.

### Endpoints

#### 1. Export Tasks

```http
GET /api/v1/export/tasks
```

**Query Parameters:**
- `workspace_id` (string, required) - Workspace UUID
- `project_id` (string, optional) - Filter by project
- `status` (string, optional) - Comma-separated statuses
- `priority` (string, optional) - Comma-separated priorities
- `assigned_to` (string, optional) - User UUID
- `format` (string, optional) - "csv" or "json". Default: "csv"
- `include_subtasks` (boolean, optional) - Default: "true"
- `include_completed` (boolean, optional) - Default: "true"
- `date_from` (string, optional) - ISO date
- `date_to` (string, optional) - ISO date

**Example:**
```http
GET /api/v1/export/tasks?workspace_id=uuid&format=json&status=todo,in_progress
```

**Response (JSON format):**
```json
{
  "success": true,
  "exported_at": "2024-01-15T10:00:00Z",
  "count": 42,
  "data": [
    {
      "id": "uuid",
      "title": "Task Title",
      "description": "Description",
      "status": "in_progress",
      "priority": "high",
      "project": "Project Name",
      "assigned_to": "user@example.com",
      "due_date": "2024-01-20",
      "created_at": "2024-01-01T00:00:00Z",
      "project_details": {},
      "assignee_details": {},
      "labels_details": [],
      "comments_count": 5,
      "attachments_count": 2
    }
  ]
}
```

**Response (CSV format):**
- Downloads as `tasks_[timestamp].csv`
- Columns: id, title, description, status, priority, project, workspace, assigned_to, created_by, due_date, completed_at, estimated_hours, labels, created_at, updated_at

#### 2. Export Projects

```http
GET /api/v1/export/projects
```

**Query Parameters:**
- `workspace_id` (string, required)
- `status` (string, optional)
- `format` (string, optional) - Default: "csv"
- `include_archived` (boolean, optional) - Default: "false"

**Response:** Similar structure to tasks export

#### 3. Export Time Entries

```http
GET /api/v1/export/time-entries
```

**Query Parameters:**
- `workspace_id` (string, required)
- `user_id` (string, optional)
- `project_id` (string, optional)
- `start_date` (string, optional)
- `end_date` (string, optional)
- `format` (string, optional) - Default: "csv"
- `billable_only` (boolean, optional) - Default: "false"

**CSV Columns:**
- id, task_id, task_title, project_name, user_name, start_time, end_time, duration_hours, entry_type, is_billable, hourly_rate, billable_amount, description

#### 4. Custom Export from Saved View

```http
POST /api/v1/export/custom
```

**Request Body:**
```json
{
  "view_id": "uuid",
  "format": "csv"
}
```

**Description:** Exports data based on a saved view's filters and configuration.

#### 5. Bulk Workspace Export

```http
GET /api/v1/export/workspace/:workspaceId
```

**Required Role:** Admin or Owner

**Query Parameters:**
- `format` (string, optional) - Only "json" supported. Default: "json"

**Response:**
```json
{
  "exported_at": "2024-01-15T10:00:00Z",
  "workspace": {
    "id": "uuid",
    "name": "My Workspace",
    ...
  },
  "statistics": {
    "projects_count": 10,
    "tasks_count": 150,
    "labels_count": 20,
    "members_count": 5,
    "custom_fields_count": 8
  },
  "data": {
    "projects": [],
    "tasks": [],
    "labels": [],
    "members": [],
    "custom_fields": []
  }
}
```

---

## Filter Configuration Format

When creating saved views or applying filters, use the following JSON structure:

```json
{
  "status": ["todo", "in_progress"],
  "priority": ["high", "urgent"],
  "assigned_to": ["user_id_1", "user_id_2"],
  "labels": ["label_id_1"],
  "project_id": "project_id",
  "due_date": {
    "from": "2024-01-01",
    "to": "2024-12-31"
  },
  "custom_fields": {
    "field_id_1": "exact_value",
    "field_id_2": {
      "operator": ">=",
      "value": 100
    }
  },
  "search": "keyword",
  "has_attachments": true,
  "is_completed": false,
  "created_by": "user_id",
  "updated_after": "2024-01-01T00:00:00Z"
}
```

**Supported Operators for Custom Fields:**
- `=` (equals)
- `!=` (not equals)
- `>` (greater than)
- `<` (less than)
- `>=` (greater than or equal)
- `<=` (less than or equal)
- `contains` (for text fields)
- `in` (for arrays)

---

## Error Responses

All endpoints follow a consistent error format:

```json
{
  "success": false,
  "error": "Error message description"
}
```

**Common HTTP Status Codes:**
- `400 Bad Request` - Invalid parameters or request body
- `403 Forbidden` - Insufficient permissions
- `404 Not Found` - Resource not found
- `409 Conflict` - Duplicate resource (e.g., field name already exists)
- `500 Internal Server Error` - Server-side error

---

## Rate Limiting

All API endpoints are subject to rate limiting. Current limits:
- General endpoints: 100 requests per minute per user
- Export endpoints: 10 requests per minute per user

---

## Authentication

All endpoints require authentication via Bearer token in the Authorization header:

```http
Authorization: Bearer <your-access-token>
```

Tokens are obtained through the Supabase authentication system.

---

## Best Practices

### Custom Fields

1. **Field Naming:** Use clear, descriptive names
2. **Required Fields:** Use sparingly to avoid blocking task creation
3. **Validation:** Configure appropriate validation rules in the `config` object
4. **Display Order:** Set logical ordering for better UX

### Task Templates

1. **Template Organization:** Use categories to group related templates
2. **Public Templates:** Share commonly used templates workspace-wide
3. **Subtask Offsets:** Use `due_date_offset_days` for time-based workflows
4. **Regular Updates:** Keep templates updated with current best practices

### Time Tracking

1. **Timer Management:** Always stop timers before starting new ones
2. **Descriptions:** Add clear descriptions for better reporting
3. **Billable Hours:** Mark entries as billable for accurate invoicing
4. **Regular Reviews:** Review time reports to identify patterns

### Saved Views

1. **View Naming:** Use descriptive names that explain the filter criteria
2. **Favorites:** Use favorites for frequently accessed views
3. **Sharing:** Share useful views with team members
4. **Default Views:** Set sensible default views per entity type

### Exports

1. **Format Selection:** Use JSON for full data, CSV for spreadsheets
2. **Date Ranges:** Apply date filters to limit export size
3. **Regular Backups:** Export workspace data regularly for backup
4. **Privacy:** Be mindful of sensitive data when exporting

---

## Migration Notes

**Database migrations required:**
- `011_create_custom_fields.sql`
- `012_create_task_templates.sql`
- `013_create_time_tracking.sql`
- `014_create_saved_views.sql`

Run migrations in order before using these APIs.

---

## Support

For additional help or to report issues, refer to the project documentation or contact the development team.

**Last Updated:** Stage 17 Complete
