# Deferred Flutter UI Tasks - Complete List

This document contains **ALL** Flutter UI components and features that were deferred during backend-first development (Stages 10-17).

---

## Overview

**Total Deferred Components:** 80+  
**Affected Stages:** 10, 11, 12, 13, 14, 15, 16, 17  
**Strategy:** Complete all Flutter UI after Stage 18 backend completion

---

## Stage 10: Notifications System UI

### 1. Firebase Cloud Messaging Setup ⚠️ Partial
**File:** `app/lib/features/notifications/data/firebase_messaging_service.dart`
**Status:** Skeleton exists, needs completion

**Tasks:**
- [ ] Complete FCM initialization in main.dart
- [ ] Implement token registration with backend
- [ ] Handle foreground notifications
- [ ] Handle background notifications
- [ ] Handle notification tap actions
- [ ] Request notification permissions (iOS)
- [ ] Test on Android and iOS devices

### 2. Notification List Screen
**Tasks:**
- [ ] Create notifications list screen
- [ ] Display notification items with icons
- [ ] Show read/unread status
- [ ] Implement mark as read functionality
- [ ] Add pull-to-refresh
- [ ] Implement infinite scroll pagination
- [ ] Navigate to related task on tap
- [ ] Show relative timestamps ("2 hours ago")
- [ ] Group notifications by date

### 3. Notification Settings Screen
**Tasks:**
- [ ] Create settings screen
- [ ] Toggle for push notifications (master)
- [ ] Toggle for task assignments
- [ ] Toggle for task completions
- [ ] Toggle for comments/mentions
- [ ] Toggle for project updates
- [ ] Toggle for due date reminders
- [ ] Save preferences to backend
- [ ] Test settings sync

### 4. Notification Badge Indicator
**Tasks:**
- [ ] Create badge widget
- [ ] Show unread count
- [ ] Position on navigation bar
- [ ] Update in real-time
- [ ] Clear on notification read

### 5. In-App Notification Banner
**Tasks:**
- [ ] Create banner widget
- [ ] Show at top of screen
- [ ] Auto-dismiss after 3 seconds
- [ ] Swipe to dismiss
- [ ] Tap to navigate
- [ ] Queue multiple notifications

---

## Stage 11: File Attachments & Links UI

### 1. File Picker Integration
**Tasks:**
- [ ] Add `file_picker` package
- [ ] Implement file selection
- [ ] Support multiple file selection
- [ ] Filter by file type
- [ ] Show file size before upload
- [ ] Validate file size limits
- [ ] Handle permission requests

### 2. File Upload Progress
**Tasks:**
- [ ] Create upload progress indicator
- [ ] Show percentage progress
- [ ] Support cancel upload
- [ ] Handle upload failures
- [ ] Retry failed uploads
- [ ] Queue multiple uploads

### 3. Attachment List Widget
**Tasks:**
- [ ] Display attachments in list
- [ ] Show file icon by type
- [ ] Display file name and size
- [ ] Show upload status
- [ ] Thumbnail preview for images
- [ ] Delete attachment option
- [ ] Download attachment option

### 4. Attachment Viewer
**Tasks:**
- [ ] Image viewer (pinch to zoom)
- [ ] PDF viewer
- [ ] Video player (optional)
- [ ] Document preview (if supported)
- [ ] Share attachment option
- [ ] Download to device

### 5. Link Management UI
**Tasks:**
- [ ] Add link dialog
- [ ] URL input with validation
- [ ] Fetch URL metadata
- [ ] Display link preview
- [ ] Edit link
- [ ] Delete link
- [ ] Open link in browser

### 6. File Management Screen
**Tasks:**
- [ ] View all task attachments
- [ ] Sort by name, date, size
- [ ] Filter by file type
- [ ] Bulk delete
- [ ] Storage usage indicator

---

## Stage 12: Global Search UI

### 1. Search Bar Component
**Tasks:**
- [ ] Create search bar widget
- [ ] Add to app bar
- [ ] Implement debounced search
- [ ] Show search history
- [ ] Clear search button
- [ ] Search suggestions/autocomplete
- [ ] Voice search (optional)

### 2. Search Results Screen
**Tasks:**
- [ ] Display grouped results (tasks, projects, comments)
- [ ] Show result count per category
- [ ] Highlight search terms
- [ ] Show result snippets
- [ ] Navigate to result on tap
- [ ] Empty state for no results
- [ ] Loading state

### 3. Search Filters UI
**Tasks:**
- [ ] Entity type filter (tasks, projects, comments)
- [ ] Workspace filter
- [ ] Date range picker
- [ ] Project filter
- [ ] Status filter
- [ ] Apply filters button
- [ ] Clear all filters
- [ ] Show active filter chips

### 4. Search History
**Tasks:**
- [ ] Store recent searches locally
- [ ] Display recent searches
- [ ] Clear individual search
- [ ] Clear all history
- [ ] Tap to search again

### 5. Advanced Search Screen
**Tasks:**
- [ ] Build complex query UI
- [ ] Multiple filter combination
- [ ] Save search as view
- [ ] Boolean operators (AND/OR)

---

## Stage 13: Analytics & Insights UI

### 1. Dashboard Charts
**Tasks:**
- [ ] Add `fl_chart` package
- [ ] Task completion chart (line)
- [ ] Tasks by status (pie chart)
- [ ] Tasks by priority (bar chart)
- [ ] Project progress (bar chart)
- [ ] Time spent chart (line)
- [ ] Activity heatmap
- [ ] Custom date range selector

### 2. Analytics Dashboard Screen
**Tasks:**
- [ ] Overview cards (total tasks, completed, overdue)
- [ ] Charts grid layout
- [ ] Refresh data
- [ ] Export chart as image
- [ ] Responsive layout for tablet
- [ ] Dark mode support for charts

### 3. Time Range Selector
**Tasks:**
- [ ] Today/Week/Month/Year tabs
- [ ] Custom date range picker
- [ ] Compare with previous period
- [ ] Save preferred time range

### 4. Export Functionality
**Tasks:**
- [ ] Export chart as PNG
- [ ] Export data as CSV
- [ ] Share analytics report
- [ ] Email report (optional)

### 5. User Productivity Insights
**Tasks:**
- [ ] Tasks completed per day
- [ ] Average completion time
- [ ] Most productive hours
- [ ] Streak tracking
- [ ] Goal achievement progress

### 6. Team Analytics (Optional)
**Tasks:**
- [ ] Team member performance
- [ ] Workload distribution
- [ ] Collaboration metrics
- [ ] Project health indicators

---

## Stage 14: Offline Mode & Sync UI

### 1. Sync Status Indicator
**Tasks:**
- [ ] Create sync status widget
- [ ] Show online/offline status
- [ ] Show syncing animation
- [ ] Display sync errors
- [ ] Show last sync time
- [ ] Color-coded status (green/yellow/red)

### 2. Connectivity Badge
**Tasks:**
- [ ] Small badge widget
- [ ] Position in app bar
- [ ] Offline icon
- [ ] Syncing spinner
- [ ] Error indicator

### 3. Offline Banner
**Tasks:**
- [ ] Banner at top when offline
- [ ] "You're offline" message
- [ ] Dismissible
- [ ] Auto-hide when back online
- [ ] Show pending changes count

### 4. Pending Operations Badge
**Tasks:**
- [ ] Show count of pending sync operations
- [ ] Display on bottom navigation
- [ ] Tap to view queue
- [ ] Clear indication when synced

### 5. Sync Button Widget
**Tasks:**
- [ ] Manual sync trigger button
- [ ] Disable when offline
- [ ] Show loading state
- [ ] Success/error feedback
- [ ] Pull-to-refresh alternative

### 6. Sync Status Card
**Tasks:**
- [ ] Detailed sync status in drawer
- [ ] Show pending operations
- [ ] Show failed operations
- [ ] Retry failed syncs
- [ ] Clear sync queue option

### 7. Sync Progress Overlay
**Tasks:**
- [ ] Full-screen overlay during sync
- [ ] Progress bar
- [ ] Item count (X of Y synced)
- [ ] Cancel sync option
- [ ] Blocking/non-blocking modes

### 8. Sync Details Bottom Sheet
**Tasks:**
- [ ] List all pending operations
- [ ] Show operation type (create/update/delete)
- [ ] Show entity (task, project, etc.)
- [ ] Timestamp
- [ ] Retry individual operation
- [ ] Delete from queue

### 9. Conflict Resolution UI
**Tasks:**
- [ ] Conflict dialog
- [ ] Show local vs server changes
- [ ] Side-by-side comparison
- [ ] Choose local/server/merge
- [ ] Preview merge result
- [ ] Apply to all conflicts option

### 10. WiFi-Only Mode Setting
**Tasks:**
- [ ] Toggle in settings
- [ ] Respect data saver mode
- [ ] Show warning when on mobile data
- [ ] Queue syncs for WiFi

---

## Stage 15: Collaboration Features UI

### 1. Mention Input Widget
**Tasks:**
- [ ] Custom text field for mentions
- [ ] @ character trigger
- [ ] User autocomplete overlay
- [ ] Display user avatars in dropdown
- [ ] Filter users by name
- [ ] Highlight mentions in text
- [ ] Support multiple mentions

### 2. User Search Overlay
**Tasks:**
- [ ] Floating overlay above keyboard
- [ ] Search user by name/email
- [ ] Show user avatars
- [ ] Display user role
- [ ] Handle no results
- [ ] Close on selection or escape

### 3. Mention Text Display
**Tasks:**
- [ ] Rich text widget
- [ ] Highlight @mentions in blue
- [ ] Clickable mentions
- [ ] Navigate to user profile on tap
- [ ] Different color for current user

### 4. Mentions List Screen
**Tasks:**
- [ ] Screen to show all mentions
- [ ] Filter by read/unread
- [ ] Group by task/comment
- [ ] Mark as read
- [ ] Navigate to source
- [ ] Badge count on tab

### 5. Mention Badge Widget
**Tasks:**
- [ ] Unread mention count
- [ ] Position on navigation bar
- [ ] Update in real-time
- [ ] Different color from notification badge

### 6. Activity Feed Screen
**Tasks:**
- [ ] Timeline view of activities
- [ ] Group by date
- [ ] Infinite scroll pagination
- [ ] Pull-to-refresh
- [ ] Filter by activity type
- [ ] User avatars for actions
- [ ] Relative timestamps
- [ ] Navigate to referenced items

### 7. Activity Item Widget
**Tasks:**
- [ ] Icon per activity type
- [ ] User avatar
- [ ] Activity description
- [ ] Timestamp
- [ ] Attached entity preview
- [ ] Tap to expand details

### 8. Activity Preferences Screen
**Tasks:**
- [ ] Toggle activity types
- [ ] Toggle per project
- [ ] Toggle per user
- [ ] Save preferences
- [ ] Reset to defaults

### 9. Unread Activity Badge
**Tasks:**
- [ ] Count unread activities
- [ ] Position on activity feed tab
- [ ] Update in real-time
- [ ] Clear on read

### 10. Real-Time Updates (WebSocket)
**Tasks:**
- [ ] Add `web_socket_channel` package
- [ ] WebSocket connection manager
- [ ] Auto-reconnect on disconnect
- [ ] Handle incoming messages
- [ ] Update UI in real-time
- [ ] Show typing indicators
- [ ] Show user presence
- [ ] Handle connection errors

### 11. Team Dashboard Screen
**Tasks:**
- [ ] Overview metrics cards
- [ ] Active members list
- [ ] Recent activity timeline
- [ ] Project health indicators
- [ ] Workload distribution chart
- [ ] Top contributors

---

## Stage 16: User Preferences & i18n UI

### 1. Preferences Management Screen
**Tasks:**
- [ ] Settings screen layout
- [ ] Section headers (Localization, Theme, etc.)
- [ ] Save button
- [ ] Reset to defaults
- [ ] Show unsaved changes indicator

### 2. Language Selector
**Tasks:**
- [ ] Dropdown with 15 languages
- [ ] Show language names in native script
- [ ] Flag icons (optional)
- [ ] Apply immediately on selection
- [ ] RTL layout support for Arabic
- [ ] Restart prompt if needed

### 3. Theme Selector
**Tasks:**
- [ ] Light/Dark/System options
- [ ] Radio buttons or segmented control
- [ ] Preview theme change
- [ ] Apply immediately
- [ ] Accent color picker

### 4. Notification Preferences UI
**Tasks:**
- [ ] 11 notification toggles
- [ ] Group by category
- [ ] Master switch
- [ ] Test notification button
- [ ] Save preferences

### 5. Task Display Preferences
**Tasks:**
- [ ] Default view selector
- [ ] Default sort order
- [ ] Default filter
- [ ] Show/hide completed toggle
- [ ] Group by selector

### 6. Workspace Preferences
**Tasks:**
- [ ] Default workspace selector
- [ ] Auto-archive settings
- [ ] Default project

### 7. Accessibility Preferences
**Tasks:**
- [ ] Reduce motion toggle
- [ ] High contrast toggle
- [ ] Font size slider
- [ ] Screen reader support

### 8. Privacy Preferences
**Tasks:**
- [ ] Show online status toggle
- [ ] Profile visibility options
- [ ] Allow mentions toggle

### 9. Advanced Settings
**Tasks:**
- [ ] Enable shortcuts toggle
- [ ] Enable sounds toggle
- [ ] Enable animations toggle

### 10. Timezone & Date Format
**Tasks:**
- [ ] Timezone dropdown (18 options)
- [ ] Date format dropdown (6 options)
- [ ] Time format toggle (12h/24h)
- [ ] First day of week selector
- [ ] Preview current date/time

### 11. Localization Setup (Flutter)
**Tasks:**
- [ ] Add `flutter_localizations` package
- [ ] Add `intl` package
- [ ] Create `l10n.yaml` configuration
- [ ] Generate ARB files for 15 languages
- [ ] Translate all UI strings
- [ ] Add language constants
- [ ] Implement locale switching
- [ ] Handle RTL layouts
- [ ] Format dates per locale
- [ ] Format numbers per locale

### 12. Import/Export Preferences
**Tasks:**
- [ ] Export preferences to JSON
- [ ] Import preferences from JSON
- [ ] File picker for import
- [ ] Validation on import
- [ ] Confirmation dialog

---

## Stage 17: Advanced Features UI

### A. Custom Fields UI

#### 1. Custom Field Definition Form
**Tasks:**
- [ ] Field name input
- [ ] Field type dropdown (9 types)
- [ ] Description input
- [ ] Required toggle
- [ ] Default value input
- [ ] Icon picker
- [ ] Color picker
- [ ] Applies to tasks/projects checkboxes
- [ ] Configuration per field type

#### 2. Field Type-Specific Configs
**Tasks:**
- [ ] **Text:** Max length input, multiline toggle
- [ ] **Number:** Min/max inputs, decimal places, prefix/suffix
- [ ] **Dropdown:** Options list editor, allow multiple toggle
- [ ] **Date:** Min/max date pickers, include time toggle
- [ ] **URL:** Validation message
- [ ] **Email:** Validation message
- [ ] **Phone:** Format selector

#### 3. Custom Field Value Editors (9 types)
**Tasks:**
- [ ] **Text:** TextField widget
- [ ] **Number:** NumberField with steppers
- [ ] **Date:** DatePicker
- [ ] **Datetime:** DateTimePicker
- [ ] **Dropdown:** Dropdown or MultiSelect
- [ ] **Checkbox:** Switch widget
- [ ] **URL:** TextField with validation
- [ ] **Email:** TextField with validation
- [ ] **Phone:** TextField with formatting

#### 4. Custom Fields Management Screen
**Tasks:**
- [ ] List all workspace fields
- [ ] Create new field button
- [ ] Edit field
- [ ] Delete field (with confirmation)
- [ ] Reorder fields (drag & drop)
- [ ] Show usage count per field
- [ ] Filter by active/inactive
- [ ] Search fields

#### 5. Custom Field Display in Task/Project
**Tasks:**
- [ ] Show custom fields section
- [ ] Display values with labels
- [ ] Edit inline
- [ ] Show validation errors
- [ ] Responsive layout

#### 6. Value History Viewer
**Tasks:**
- [ ] Show change history
- [ ] Display old and new values
- [ ] Show who changed and when
- [ ] Timeline view

### B. Task Templates UI

#### 1. Template Browser/Gallery
**Tasks:**
- [ ] Grid or list view
- [ ] Template cards with preview
- [ ] Category filter
- [ ] Search templates
- [ ] Sort by popularity/recent
- [ ] Public/private filter
- [ ] Template details on tap

#### 2. Template Editor
**Tasks:**
- [ ] Template name input
- [ ] Description input
- [ ] Category selector
- [ ] Task title template
- [ ] Task description template
- [ ] Priority selector
- [ ] Estimated hours input
- [ ] Default assignee picker
- [ ] Label selector
- [ ] Custom field defaults
- [ ] Public/private toggle
- [ ] Icon and color picker

#### 3. Subtask Editor
**Tasks:**
- [ ] Add subtask button
- [ ] Subtask list with reordering
- [ ] Subtask title input
- [ ] Due date offset input
- [ ] Priority selector
- [ ] Delete subtask

#### 4. Checklist Editor
**Tasks:**
- [ ] Add checklist item button
- [ ] Checklist items with reordering
- [ ] Item title input
- [ ] Delete item

#### 5. Template Instantiation Dialog
**Tasks:**
- [ ] Show template preview
- [ ] Override fields (title, assignee, due date)
- [ ] Select project
- [ ] Create task button
- [ ] Cancel button

#### 6. Template Usage Analytics
**Tasks:**
- [ ] Usage count display
- [ ] Last used timestamp
- [ ] Most popular templates

### C. Time Tracking UI

#### 1. Timer Widget (Start/Stop)
**Tasks:**
- [ ] Large play/stop button
- [ ] Current task display
- [ ] Elapsed time display (00:00:00)
- [ ] Description input
- [ ] Start timer action
- [ ] Stop timer action
- [ ] Update every second

#### 2. Running Timer Indicator
**Tasks:**
- [ ] Persistent indicator in app bar
- [ ] Show elapsed time
- [ ] Pulse animation
- [ ] Tap to view timer
- [ ] Stop from indicator

#### 3. Time Entry List
**Tasks:**
- [ ] List all time entries
- [ ] Group by date
- [ ] Show task, duration, description
- [ ] Edit entry option
- [ ] Delete entry option
- [ ] Filter by date range
- [ ] Filter by project
- [ ] Show total time

#### 4. Manual Time Entry Form
**Tasks:**
- [ ] Task selector
- [ ] Start date/time picker
- [ ] End date/time picker
- [ ] Duration display (auto-calculated)
- [ ] Description input
- [ ] Billable toggle
- [ ] Tags input
- [ ] Submit button

#### 5. Time Entry Edit Dialog
**Tasks:**
- [ ] Edit start/end times
- [ ] Edit description
- [ ] Toggle billable
- [ ] Edit reason input
- [ ] View edit history
- [ ] Save changes

#### 6. Time Reports Dashboard
**Tasks:**
- [ ] Date range selector
- [ ] Total hours display
- [ ] Billable hours display
- [ ] Hours breakdown chart
- [ ] Export report button
- [ ] Filter by project/user

#### 7. Time Edit Audit Trail
**Tasks:**
- [ ] Show all edits
- [ ] Display old vs new values
- [ ] Show who edited and when
- [ ] Show edit reason

#### 8. Workspace Time Settings
**Tasks:**
- [ ] Allow manual entries toggle
- [ ] Require description toggle
- [ ] Default hourly rate input
- [ ] Auto-stop hours input
- [ ] Rounding minutes selector
- [ ] Max daily hours input
- [ ] Save settings button

### D. Saved Views UI

#### 1. View Selector Dropdown
**Tasks:**
- [ ] Show all accessible views
- [ ] Group by personal/shared
- [ ] Show default view indicator
- [ ] Show favorite indicator
- [ ] Apply view on selection

#### 2. Filter Builder Interface
**Tasks:**
- [ ] Add filter button
- [ ] Filter type selector
- [ ] Operator selector (equals, contains, etc.)
- [ ] Value input (varies by field type)
- [ ] Multiple filter combination (AND/OR)
- [ ] Remove filter button
- [ ] Clear all filters

#### 3. View Editor
**Tasks:**
- [ ] View name input
- [ ] Description input
- [ ] View type selector (list/board/calendar/timeline/table)
- [ ] Entity type selector (tasks/projects)
- [ ] Filter configuration UI
- [ ] Sort field selector
- [ ] Sort order toggle (asc/desc)
- [ ] Group by selector
- [ ] Column visibility (for table view)
- [ ] Public/private toggle
- [ ] Icon and color picker
- [ ] Save as default toggle

#### 4. View Sharing Dialog
**Tasks:**
- [ ] Share with user selector
- [ ] Share with workspace toggle
- [ ] Edit permission toggle
- [ ] Remove share option
- [ ] View share list

#### 5. Favorites Management
**Tasks:**
- [ ] Add to favorites button
- [ ] Remove from favorites
- [ ] Reorder favorites
- [ ] Favorites section in view list

#### 6. View Management Screen
**Tasks:**
- [ ] List all views
- [ ] Create new view
- [ ] Edit view
- [ ] Duplicate view
- [ ] Delete view
- [ ] View usage stats

### E. Export UI

#### 1. Export Dialog
**Tasks:**
- [ ] Entity type selector (tasks/projects/time entries)
- [ ] Format selector (CSV/JSON)
- [ ] Filter options
- [ ] Date range picker
- [ ] Include options (subtasks, completed, etc.)
- [ ] Export button
- [ ] Cancel button

#### 2. Export Progress Indicator
**Tasks:**
- [ ] Show exporting state
- [ ] Progress bar (if applicable)
- [ ] Cancel export option

#### 3. Export Success Dialog
**Tasks:**
- [ ] Success message
- [ ] Downloaded file name
- [ ] Open file button
- [ ] Share file button
- [ ] Done button

#### 4. Export from View
**Tasks:**
- [ ] Export current view button
- [ ] Apply view filters to export
- [ ] Format selection
- [ ] Preview export

#### 5. Workspace Export (Admin Only)
**Tasks:**
- [ ] Export entire workspace button
- [ ] Confirmation dialog (large export)
- [ ] Show export size estimate
- [ ] Email delivery option (optional)

---

## Implementation Priority Recommendations

### Phase 1: Core Foundation (Weeks 1-2)
1. Fix existing models and mappers
2. Set up Riverpod providers
3. Implement API repositories
4. Basic navigation structure

### Phase 2: Stage 10-12 (Weeks 3-5)
1. Notifications UI (push notifications critical)
2. File attachments (common feature)
3. Search functionality (productivity boost)

### Phase 3: Stage 13-14 (Weeks 6-8)
1. Analytics dashboard (stakeholder visibility)
2. Offline sync UI (user experience)

### Phase 4: Stage 15 (Weeks 9-10)
1. Mentions and activity feed
2. Real-time collaboration (WebSocket)
3. Team dashboard

### Phase 5: Stage 16-17 (Weeks 11-14)
1. User preferences and i18n
2. Custom fields UI
3. Templates UI
4. Time tracking UI
5. Saved views UI
6. Export functionality

### Phase 6: Polish (Weeks 15-16)
1. UI/UX refinements
2. Animation polish
3. Error state improvements
4. Loading state improvements
5. Empty state designs
6. Comprehensive testing

---

## Estimated Effort

**Total Estimated Time:** 16-20 weeks (4-5 months) for complete UI implementation

**By Stage:**
- Stage 10: 1 week
- Stage 11: 1 week
- Stage 12: 1 week
- Stage 13: 1-2 weeks
- Stage 14: 2 weeks
- Stage 15: 2 weeks
- Stage 16: 1-2 weeks
- Stage 17: 3-4 weeks
- Polish: 2 weeks

---

## Dependencies Needed

```yaml
dependencies:
  # Already have
  flutter_riverpod: ^2.4.0
  dio: ^5.3.0
  drift: ^2.13.0
  
  # Need to add
  file_picker: ^6.0.0
  flutter_localizations:
    sdk: flutter
  intl: ^0.18.0
  web_socket_channel: ^2.4.0
  fl_chart: ^0.65.0
  firebase_messaging: ^14.6.0
  flutter_local_notifications: ^16.0.0
  image_picker: ^1.0.0
  share_plus: ^7.0.0
  url_launcher: ^6.2.0
  package_info_plus: ^5.0.0
  connectivity_plus: ^5.0.0
```

---

## Success Metrics

- [ ] All 80+ UI components implemented
- [ ] All deferred features functional
- [ ] End-to-end workflows tested
- [ ] Offline mode working
- [ ] Real-time updates working
- [ ] Multi-language support complete
- [ ] Performance targets met (60 FPS)
- [ ] App size < 50MB
- [ ] All integrations tested

---

**Status:** Ready to begin Flutter UI implementation after Stage 18 completion ✅
