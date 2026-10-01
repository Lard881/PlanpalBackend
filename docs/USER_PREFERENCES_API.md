# User Preferences API Documentation

## Overview
The User Preferences API provides comprehensive customization options for users including language selection, theme preferences, notification settings, task display options, and accessibility features.

**Base URL:** `/api/v1/preferences`

**Authentication:** Required for all endpoints

---

## Table of Contents
1. [Preference Categories](#preference-categories)
2. [API Endpoints](#api-endpoints)
3. [Default Values](#default-values)
4. [Initialization](#initialization)
5. [Best Practices](#best-practices)
6. [Examples](#examples)

---

## Preference Categories

### 1. Localization
- **language**: Language code (e.g., 'en', 'es', 'fr')
- **locale**: Full locale string (e.g., 'en-US', 'es-MX')
- **timezone**: Timezone identifier (e.g., 'America/New_York')
- **date_format**: Date formatting pattern
- **time_format**: 12h or 24h time display
- **first_day_of_week**: 0 (Sunday) to 6 (Saturday)

### 2. Theme
- **theme**: 'light', 'dark', or 'system'
- **accent_color**: Hex color code (e.g., '#FF5733')

### 3. Notifications
- **email_notifications_enabled**: Master toggle for email notifications
- **push_notifications_enabled**: Master toggle for push notifications
- **desktop_notifications_enabled**: Master toggle for desktop notifications
- **notify_task_assigned**: Notify when task is assigned
- **notify_task_due_soon**: Notify when task is due soon
- **notify_task_overdue**: Notify when task becomes overdue
- **notify_task_completed**: Notify when task is completed
- **notify_task_commented**: Notify when someone comments
- **notify_mentioned**: Notify when mentioned in task/comment
- **notify_workspace_invite**: Notify for workspace invitations
- **notify_project_updates**: Notify for project changes

### 4. Quiet Hours
- **quiet_hours_enabled**: Enable do-not-disturb mode
- **quiet_hours_start**: Start time (HH:MM:SS format)
- **quiet_hours_end**: End time (HH:MM:SS format)

### 5. Email Digest
- **email_digest_frequency**: 'none', 'instant', 'hourly', 'daily', 'weekly'
- **email_digest_time**: Preferred delivery time (HH:MM:SS)

### 6. Task Display
- **default_task_view**: 'list', 'board', 'calendar', 'timeline'
- **default_task_sort**: 'due_date', 'priority', 'created_at', 'title', 'status'
- **default_task_filter**: 'all', 'active', 'completed', 'assigned_to_me'
- **show_completed_tasks**: Show/hide completed tasks
- **group_tasks_by**: 'none', 'project', 'priority', 'due_date', 'assignee'

### 7. Workspace
- **default_workspace_id**: Default workspace on app launch
- **auto_archive_completed_tasks**: Automatically archive completed tasks
- **auto_archive_days**: Days after completion to archive (1-365)

### 8. Accessibility
- **reduce_motion**: Reduce animations for motion sensitivity
- **high_contrast**: Enable high contrast mode
- **font_size**: 'small', 'medium', 'large', 'extra-large'

### 9. Privacy
- **show_online_status**: Show online/offline status to others
- **show_profile_to_workspace_members**: Show profile details
- **allow_mentions**: Allow others to @mention you

### 10. Advanced
- **enable_shortcuts**: Enable keyboard shortcuts
- **enable_sounds**: Enable notification sounds
- **enable_animations**: Enable UI animations

---

## API Endpoints

### 1. Get User Preferences

Get current user's preferences (creates with defaults if not exist).

**Endpoint:** `GET /api/v1/preferences`

**Response:** `200 OK`
```json
{
  "preferences": {
    "id": "uuid",
    "user_id": "uuid",
    "language": "en",
    "locale": "en-US",
    "timezone": "UTC",
    "theme": "system",
    "email_notifications_enabled": true,
    "push_notifications_enabled": true,
    "default_task_view": "list",
    ...
  }
}
```

**Example:**
```bash
curl -X GET "https://api.planpal.com/api/v1/preferences" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

---

### 2. Update Preferences (Bulk)

Update multiple preferences at once.

**Endpoint:** `PUT /api/v1/preferences`

**Request Body:** (all fields optional)
```json
{
  "language": "es",
  "theme": "dark",
  "accent_color": "#FF5733",
  "email_notifications_enabled": true,
  "default_task_view": "board",
  "timezone": "America/Los_Angeles"
}
```

**Validation:**
- At least one field must be provided
- Color must be valid hex code (#RRGGBB)
- Time formats must be HH:MM:SS
- default_workspace_id must be a workspace user belongs to
- language must be a supported and enabled language

**Response:** `200 OK`
```json
{
  "preferences": {
    // Updated preferences object
  }
}
```

**Example:**
```bash
curl -X PUT "https://api.planpal.com/api/v1/preferences" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "theme": "dark",
    "language": "es",
    "default_task_view": "board"
  }'
```

---

### 3. Update Single Preference

Update one preference with audit trail.

**Endpoint:** `PATCH /api/v1/preferences/:key`

**URL Parameters:**
- `key`: Preference key name

**Request Body:**
```json
{
  "preference_value": "dark"
}
```

**Response:** `200 OK`
```json
{
  "preferences": {
    // Full preferences object
  },
  "updated_key": "theme"
}
```

**Example:**
```bash
curl -X PATCH "https://api.planpal.com/api/v1/preferences/theme" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "preference_value": "dark"
  }'
```

---

### 4. Reset to Defaults

Reset all preferences to system defaults.

**Endpoint:** `POST /api/v1/preferences/reset`

**Response:** `200 OK`
```json
{
  "preferences": {
    // Default preferences
  },
  "message": "Preferences reset to defaults"
}
```

**Example:**
```bash
curl -X POST "https://api.planpal.com/api/v1/preferences/reset" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

---

### 5. Get Preference History

View history of preference changes.

**Endpoint:** `GET /api/v1/preferences/history`

**Query Parameters:**
- `limit` (integer, optional): Results per page (default: 50, max: 100)
- `offset` (integer, optional): Skip N results (default: 0)

**Response:** `200 OK`
```json
{
  "history": [
    {
      "id": "uuid",
      "user_id": "uuid",
      "preference_key": "theme",
      "old_value": "light",
      "new_value": "dark",
      "changed_at": "2024-01-15T10:30:00Z",
      "ip_address": "192.168.1.1",
      "user_agent": "Mozilla/5.0..."
    }
  ],
  "pagination": {
    "limit": 50,
    "offset": 0,
    "total": 25
  }
}
```

---

### 6. Export Preferences

Export preferences as JSON for backup.

**Endpoint:** `GET /api/v1/preferences/export`

**Response:** `200 OK`
```json
{
  "version": "1.0",
  "exported_at": "2024-01-15T10:30:00Z",
  "preferences": {
    "language": "en",
    "theme": "dark",
    ...
  }
}
```

**Use Case:** Backup preferences before reset or migration

---

### 7. Import Preferences

Import preferences from backup.

**Endpoint:** `POST /api/v1/preferences/import`

**Request Body:**
```json
{
  "preferences": {
    "language": "en",
    "theme": "dark",
    "timezone": "UTC",
    ...
  }
}
```

**Response:** `200 OK`
```json
{
  "preferences": {
    // Imported preferences
  },
  "message": "Preferences imported successfully"
}
```

---

### 8. Get Supported Languages

List all supported languages.

**Endpoint:** `GET /api/v1/preferences/languages`

**Query Parameters:**
- `enabled_only` (boolean, optional): Only enabled languages (default: true)

**Response:** `200 OK`
```json
{
  "languages": [
    {
      "code": "en",
      "name": "English",
      "native_name": "English",
      "rtl": false,
      "enabled": true,
      "completion_percentage": 100,
      "flag_emoji": "🇺🇸"
    },
    {
      "code": "es",
      "name": "Spanish",
      "native_name": "Español",
      "rtl": false,
      "enabled": true,
      "completion_percentage": 0,
      "flag_emoji": "🇪🇸"
    }
  ],
  "count": 15
}
```

---

### 9. Get Language Details

Get details for a specific language.

**Endpoint:** `GET /api/v1/preferences/languages/:code`

**Response:** `200 OK`
```json
{
  "language": {
    "code": "en",
    "name": "English",
    "native_name": "English",
    "rtl": false,
    "enabled": true,
    "completion_percentage": 100,
    "flag_emoji": "🇺🇸",
    "created_at": "2024-01-01T00:00:00Z"
  }
}
```

---

### 10. Get Timezones

Get list of common timezones.

**Endpoint:** `GET /api/v1/preferences/timezones`

**Response:** `200 OK`
```json
{
  "timezones": [
    {
      "value": "UTC",
      "label": "UTC (Coordinated Universal Time)",
      "offset": "+00:00"
    },
    {
      "value": "America/New_York",
      "label": "Eastern Time (US & Canada)",
      "offset": "-05:00"
    }
  ]
}
```

---

### 11. Get Date Formats

Get list of available date formats.

**Endpoint:** `GET /api/v1/preferences/date-formats`

**Response:** `200 OK`
```json
{
  "date_formats": [
    {
      "value": "MM/DD/YYYY",
      "label": "12/31/2024 (US)",
      "example": "12/31/2024"
    },
    {
      "value": "DD/MM/YYYY",
      "label": "31/12/2024 (UK)",
      "example": "31/12/2024"
    }
  ]
}
```

---

## Default Values

All preferences have sensible defaults:

```javascript
{
  // Localization
  language: 'en',
  locale: 'en-US',
  timezone: 'UTC',
  date_format: 'MM/DD/YYYY',
  time_format: '12h',
  first_day_of_week: 0, // Sunday
  
  // Theme
  theme: 'system',
  accent_color: null,
  
  // Notifications (all enabled by default)
  email_notifications_enabled: true,
  push_notifications_enabled: true,
  desktop_notifications_enabled: true,
  notify_task_assigned: true,
  notify_task_due_soon: true,
  notify_task_overdue: true,
  notify_task_completed: true,
  notify_task_commented: true,
  notify_mentioned: true,
  notify_workspace_invite: true,
  notify_project_updates: false,
  
  // Quiet Hours
  quiet_hours_enabled: false,
  quiet_hours_start: null,
  quiet_hours_end: null,
  
  // Email Digest
  email_digest_frequency: 'daily',
  email_digest_time: '09:00:00',
  
  // Task Display
  default_task_view: 'list',
  default_task_sort: 'due_date',
  default_task_filter: 'active',
  show_completed_tasks: false,
  group_tasks_by: 'none',
  
  // Workspace
  default_workspace_id: null,
  auto_archive_completed_tasks: false,
  auto_archive_days: 30,
  
  // Accessibility
  reduce_motion: false,
  high_contrast: false,
  font_size: 'medium',
  
  // Privacy
  show_online_status: true,
  show_profile_to_workspace_members: true,
  allow_mentions: true,
  
  // Advanced
  enable_shortcuts: true,
  enable_sounds: true,
  enable_animations: true,
}
```

---

## Initialization

### Automatic Creation

Preferences are automatically created with defaults when:
1. User first accesses `/api/v1/preferences`
2. Any preference update is attempted
3. Via database trigger on user creation (if configured)

### Manual Creation

Can also be created via database function:
```sql
SELECT * FROM get_or_create_user_preferences('user-uuid');
```

### First-Time User Experience

Recommended flow for new users:
1. After signup, redirect to preferences setup
2. Ask for essential preferences:
   - Language
   - Timezone
   - Theme preference
3. Other preferences use defaults
4. User can customize later via settings screen

---

## Best Practices

### Client-Side

1. **Cache Preferences:** Store preferences locally for offline access
2. **Lazy Load:** Load preferences after authentication
3. **Optimistic Updates:** Update UI immediately, sync with API
4. **Sync on Change:** Update backend when user changes preferences
5. **Validate Before Send:** Use same validation as backend

### Backend Integration

1. **Use Preferences in Queries:** Respect user's sort/filter preferences
2. **Localization:** Use language preference for email templates
3. **Timezone Conversion:** Convert all timestamps to user's timezone
4. **Notification Filtering:** Check preferences before sending notifications
5. **Quiet Hours:** Suppress notifications during quiet hours

### Security

1. **Rate Limiting:** Limit preference update frequency
2. **Audit Trail:** Log all changes with IP and user agent
3. **Validation:** Always validate workspace/language existence
4. **XSS Prevention:** Sanitize accent_color input

---

## Examples

### Complete Onboarding Flow

```javascript
// 1. After signup, get or create preferences
const { data: prefs } = await fetch('/api/v1/preferences', {
  headers: { Authorization: `Bearer ${token}` }
});

// 2. Show setup wizard
const setupData = {
  language: userSelectedLanguage,
  timezone: detectedTimezone,
  theme: systemTheme,
};

// 3. Update preferences
await fetch('/api/v1/preferences', {
  method: 'PUT',
  headers: {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify(setupData)
});

// 4. Proceed to app
```

### Theme Switcher

```javascript
async function switchTheme(newTheme) {
  // Update UI immediately
  document.body.className = newTheme;
  
  // Sync with backend
  await fetch('/api/v1/preferences/theme', {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ preference_value: newTheme })
  });
}
```

### Notification Settings Panel

```javascript
async function updateNotificationSettings(settings) {
  const updates = {
    email_notifications_enabled: settings.emailEnabled,
    push_notifications_enabled: settings.pushEnabled,
    notify_task_assigned: settings.taskAssigned,
    notify_mentioned: settings.mentions,
    quiet_hours_enabled: settings.quietHours,
    quiet_hours_start: settings.quietStart,
    quiet_hours_end: settings.quietEnd,
  };
  
  const response = await fetch('/api/v1/preferences', {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(updates)
  });
  
  return response.json();
}
```

---

## Error Codes

- `400 BAD_REQUEST`: Invalid preference value, format, or validation error
- `401 UNAUTHORIZED`: Missing or invalid authentication token
- `404 NOT_FOUND`: Language code not found
- `429 TOO_MANY_REQUESTS`: Rate limit exceeded
- `500 INTERNAL_SERVER_ERROR`: Server error

---

## Supported Languages

### Currently Available (v1.0)
- 🇺🇸 English (en) - 100% complete
- 🇪🇸 Spanish (es) - Translation pending
- 🇫🇷 French (fr) - Translation pending
- 🇩🇪 German (de) - Translation pending
- 🇮🇹 Italian (it) - Translation pending
- 🇵🇹 Portuguese (pt) - Translation pending
- 🇯🇵 Japanese (ja) - Translation pending
- 🇰🇷 Korean (ko) - Translation pending
- 🇨🇳 Chinese (zh) - Translation pending
- 🇸🇦 Arabic (ar) - Translation pending + RTL support
- 🇮🇳 Hindi (hi) - Translation pending
- 🇷🇺 Russian (ru) - Translation pending
- 🇳🇱 Dutch (nl) - Translation pending
- 🇵🇱 Polish (pl) - Translation pending
- 🇹🇷 Turkish (tr) - Translation pending

### Adding New Languages

New languages can be added to the `supported_languages` table:
```sql
INSERT INTO supported_languages (code, name, native_name, rtl, enabled)
VALUES ('pt-BR', 'Brazilian Portuguese', 'Português Brasileiro', FALSE, TRUE);
```

---

## Changelog

### Version 1.0 (Stage 16)
- Initial preferences system
- 40+ customizable preferences
- 15 supported languages
- Audit trail for changes
- Export/import functionality
- Timezone and date format selection
