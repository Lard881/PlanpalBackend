# Stage 15: Collaboration Features - Flutter UI Requirements

## Overview
This document outlines the Flutter UI components needed for Stage 15 collaboration features. These components will be implemented after completing all 18 stages, following the project's UI-deferred strategy.

---

## Task 5: Mention and Tagging UI Components

### 5.1 Mention Input Widget

**Component:** `MentionTextField`

**Purpose:** Rich text input with @mention autocomplete support

**Features:**
- Detects "@" character and shows user picker
- Real-time user search as typing continues
- Highlights mentions in different color
- Stores mention metadata with text
- Supports both user ID and email mentions

**API Integration:**
- `GET /api/v1/mentions/users/search?q={query}&workspace_id={id}`

**Implementation Notes:**
```dart
class MentionTextField extends StatefulWidget {
  final TextEditingController controller;
  final String workspaceId;
  final Function(List<Mention>) onMentionsChanged;
  final String? hintText;
  
  // Features:
  // - Listen for @ character
  // - Show UserSearchOverlay positioned near cursor
  // - Convert selected users to @[user_id] format
  // - Maintain list of mentions for submission
  // - Support editing and deleting mentions
}
```

**UI Elements:**
- Text field with mention highlighting
- Floating autocomplete overlay
- User avatar + name in suggestions
- Keyboard handling for selection
- Visual distinction for mentions vs regular text

---

### 5.2 User Search Overlay

**Component:** `UserSearchOverlay`

**Purpose:** Autocomplete dropdown for @mention selection

**Features:**
- Positioned near cursor/caret
- Real-time search results
- Keyboard navigation (up/down/enter)
- Shows user avatar, name, email
- Debounced API calls (300ms)

**API Integration:**
- `GET /api/v1/mentions/users/search?q={query}&workspace_id={id}&limit=10`

**Implementation Notes:**
```dart
class UserSearchOverlay extends StatelessWidget {
  final String query;
  final String workspaceId;
  final Function(User) onUserSelected;
  final Offset position;
  
  // Shows list of matching users
  // Positioned as overlay near text cursor
  // Max 10 results
  // Scrollable if needed
}
```

---

### 5.3 Mention Display Widget

**Component:** `MentionText`

**Purpose:** Display text with clickable mention highlights

**Features:**
- Parse text for @[user_id] patterns
- Highlight mentions with custom style
- Clickable mentions open user profile
- Tooltip on hover (web) showing full name
- Loading state for user data

**Implementation Notes:**
```dart
class MentionText extends StatelessWidget {
  final String text;
  final TextStyle? baseStyle;
  final TextStyle? mentionStyle;
  final Function(String userId)? onMentionTapped;
  
  // Parse text and build RichText with TextSpans
  // Fetch user names for user IDs
  // Cache user data to avoid repeated fetches
}
```

---

### 5.4 Mentions List Screen

**Component:** `MentionsScreen`

**Purpose:** List all mentions for the current user

**Features:**
- Grouped by read/unread status
- Pull-to-refresh
- Infinite scroll pagination
- Swipe to mark as read
- Tap to navigate to task/comment
- Filter by mention type (task/comment)
- Badge showing unread count

**API Integration:**
- `GET /api/v1/mentions?is_read=false&limit=50&offset=0`
- `PUT /api/v1/mentions/:id/read`
- `PUT /api/v1/mentions/read-all`

**Implementation Notes:**
```dart
class MentionsScreen extends ConsumerStatefulWidget {
  // Two tabs: Unread | All
  // ListView with MentionListItem widgets
  // Empty state when no mentions
  // Mark all as read button in app bar
}

class MentionListItem extends StatelessWidget {
  final Mention mention;
  final Function(String) onTap;
  final Function(String) onMarkRead;
  
  // Shows:
  // - Mentioner avatar and name
  // - Task/comment preview
  // - Timestamp
  // - Read/unread indicator
  // - Swipe actions
}
```

---

### 5.5 Mention Badge

**Component:** `MentionBadge`

**Purpose:** Display unread mention count

**Features:**
- Shows count if > 0
- Animates on count change
- Updates in real-time via WebSocket
- Tappable to open MentionsScreen

**API Integration:**
- `GET /api/v1/mentions?is_read=false` (count only)
- WebSocket: `mention` message type

**Implementation Notes:**
```dart
class MentionBadge extends ConsumerWidget {
  final String workspaceId;
  
  // Listens to WebSocket for real-time updates
  // Shows badge with number
  // Animated appearance/disappearance
  // Position in app bar or bottom nav
}
```

---

## Task 6: Activity Feed UI Components

### 6.1 Activity Feed Screen

**Component:** `ActivityFeedScreen`

**Purpose:** Display personalized activity feed

**Features:**
- Infinite scroll with pagination
- Pull-to-refresh
- Filter by entity type
- Filter by action type
- Mark as read on scroll
- Real-time updates via WebSocket
- Group similar activities

**API Integration:**
- `GET /api/v1/activity-feed/personalized?workspace_id={id}&limit=50&offset=0`
- `POST /api/v1/activity-feed/mark-read`
- `GET /api/v1/activity-feed/unread-count?workspace_id={id}`

**Implementation Notes:**
```dart
class ActivityFeedScreen extends ConsumerStatefulWidget {
  final String workspaceId;
  
  // Features:
  // - ScrollController to detect visible items
  // - Mark items as read when they scroll into view
  // - WebSocket listener for new activities
  // - FilterBar for entity/action filtering
  // - Grouped list view
}
```

---

### 6.2 Activity Item Widget

**Component:** `ActivityItem`

**Purpose:** Display single activity with context

**Features:**
- User avatar
- Activity description (templated)
- Entity preview (task title, comment text)
- Timestamp (relative)
- Read/unread indicator
- Tappable to navigate to entity
- Different icons per action type

**Implementation Notes:**
```dart
class ActivityItem extends StatelessWidget {
  final Activity activity;
  final bool isRead;
  final Function() onTap;
  
  // Template strings for different actions:
  // "John completed Task Name"
  // "Jane commented on Task Name"
  // "Mike mentioned you in Task Name"
  
  // Show appropriate icon for action
  // Format timestamp as "5m ago", "2h ago", "3d ago"
}
```

---

### 6.3 Activity Feed Preferences Screen

**Component:** `ActivityPreferencesScreen`

**Purpose:** Configure activity feed filters

**Features:**
- Toggle switches for activity types
- Email digest frequency selector
- Show own activities toggle
- Followed/excluded projects selectors
- Excluded actions multi-select
- Save preferences button

**API Integration:**
- `GET /api/v1/activity-feed/preferences/:workspace_id`
- `PUT /api/v1/activity-feed/preferences/:workspace_id`

**Implementation Notes:**
```dart
class ActivityPreferencesScreen extends ConsumerStatefulWidget {
  final String workspaceId;
  
  // Settings groups:
  // - Feed Filters (show mentions, assignments, etc.)
  // - Email Notifications (frequency, enabled)
  // - Project Preferences (follow/exclude)
  // - Advanced (excluded actions)
}
```

---

### 6.4 Activity Aggregation Widget

**Component:** `ActivityAggregationItem`

**Purpose:** Display grouped/aggregated activities

**Features:**
- Show count of similar activities
- Expandable to show individual items
- Time range indicator
- Multiple user avatars (stacked)

**API Integration:**
- `GET /api/v1/activity-feed/aggregated?workspace_id={id}&hours_back=24`

**Implementation Notes:**
```dart
class ActivityAggregationItem extends StatefulWidget {
  final AggregatedActivity activity;
  
  // Shows: "5 updates on Task Name (last hour)"
  // Tap to expand showing all 5 activities
  // Stack avatars of involved users
}
```

---

### 6.5 Unread Activity Badge

**Component:** `UnreadActivityBadge`

**Purpose:** Show unread activity count

**Features:**
- Real-time count via WebSocket
- Badge in navigation
- Animated updates
- Clears on feed view

**API Integration:**
- `GET /api/v1/activity-feed/unread-count?workspace_id={id}`
- WebSocket: `activity` message type

---

## Task 7: Collaboration Features Testing

### 7.1 Mention Widget Tests

**File:** `test/widgets/mention_text_field_test.dart`

**Test Cases:**
- Detect @ character and trigger search
- Display search overlay with results
- Select user from overlay
- Insert mention into text
- Parse existing mentions
- Handle mention deletion
- Validate mention format
- Test keyboard navigation

---

### 7.2 Mention Integration Tests

**File:** `test/integration/mentions_test.dart`

**Test Cases:**
- Create task with mentions
- Create comment with mentions
- Receive mention notification
- Mark mention as read
- Navigate from mention to task
- Search users for mentions
- Filter mentions by type
- Mark all mentions as read

---

### 7.3 Activity Feed Widget Tests

**File:** `test/widgets/activity_feed_test.dart`

**Test Cases:**
- Display activity list
- Infinite scroll pagination
- Pull to refresh
- Filter by entity type
- Filter by action type
- Mark as read on scroll
- Empty state display
- Loading state display

---

### 7.4 Activity Feed Integration Tests

**File:** `test/integration/activity_feed_test.dart`

**Test Cases:**
- Fetch personalized feed
- Update preferences
- Mark activities as read
- Receive real-time activity updates
- Navigate from activity to entity
- Test aggregated view
- Check unread count accuracy

---

### 7.5 Real-time Collaboration Tests

**File:** `test/integration/realtime_collaboration_test.dart`

**Test Cases:**
- WebSocket connection establishment
- Subscribe to workspace updates
- Subscribe to task updates
- Receive task update events
- Receive comment events
- Receive mention notifications
- User presence updates
- Typing indicators
- Connection recovery

---

### 7.6 Team Dashboard Tests

**File:** `test/widgets/team_dashboard_test.dart`

**Test Cases:**
- Display overview metrics
- Display member statistics
- Display task trends chart
- Display project health
- Display activity heatmap
- Period selector functionality
- Sort member list
- Navigate to project from health

---

## Implementation Priority

### Phase 1: Core Mention Features
1. MentionTextField
2. UserSearchOverlay
3. MentionText
4. Basic mention creation and display

### Phase 2: Mention Management
5. MentionsScreen
6. MentionBadge
7. Mark as read functionality
8. Navigation integration

### Phase 3: Activity Feed
9. ActivityFeedScreen
10. ActivityItem
11. Read/unread tracking
12. Real-time updates

### Phase 4: Advanced Features
13. ActivityPreferencesScreen
14. ActivityAggregationItem
15. Team Dashboard (covered separately)

### Phase 5: Testing
16. Widget tests for all components
17. Integration tests
18. Real-time collaboration tests
19. Performance tests

---

## Design Guidelines

### Colors
- Mention highlight: Primary color with 20% opacity background
- Unread badge: Error/warning color
- Online indicator: Success color (green)
- Activity icons: Action-specific colors

### Typography
- Mention text: SemiBold, same size as body
- Activity description: Regular, body size
- Timestamps: Caption size, muted color
- Counts/badges: Small, bold

### Spacing
- Activity items: 16px vertical padding
- Mention pills: 4px horizontal padding, 2px vertical
- Badge numbers: 8px diameter minimum
- Search overlay: 8px from cursor

### Animations
- Badge appearance: Scale + fade (200ms)
- Activity item read: Fade opacity (300ms)
- Overlay show/hide: Slide + fade (150ms)
- Typing indicator: Pulsing animation

---

## Data Models

### Mention Model
```dart
class Mention {
  final String id;
  final MentionType mentionType;
  final String taskId;
  final String? commentId;
  final String mentionedByUserId;
  final String mentionedByUserName;
  final String mentionedByUserEmail;
  final String mentionedUserId;
  final bool isRead;
  final DateTime createdAt;
}

enum MentionType { task, comment }
```

### Activity Model
```dart
class Activity {
  final String id;
  final EntityType entityType;
  final String entityId;
  final String action;
  final String userId;
  final String workspaceId;
  final Map<String, dynamic> changes;
  final Map<String, dynamic> metadata;
  final DateTime createdAt;
  final bool isRead;
  
  // Enriched data from API
  final User? user;
  final dynamic entityDetails; // Task, Project, Comment
}

enum EntityType { task, project, workspace, comment }
```

### ActivityPreferences Model
```dart
class ActivityPreferences {
  final String id;
  final String userId;
  final String workspaceId;
  final String emailDigestFrequency;
  final bool emailDigestEnabled;
  final bool showOwnActivities;
  final bool showMentions;
  final bool showAssignments;
  final bool showComments;
  final bool showTaskUpdates;
  final bool showProjectUpdates;
  final List<String> excludedActions;
  final List<String> followedProjects;
  final List<String> excludedProjects;
}
```

---

## Repository Layer

### Mentions Repository
```dart
class MentionsRepository {
  Future<List<Mention>> getMentions({
    bool? isRead,
    int limit = 50,
    int offset = 0,
  });
  
  Future<Mention> createMention(CreateMentionRequest request);
  
  Future<Mention> markMentionAsRead(String mentionId);
  
  Future<int> markAllMentionsAsRead(String workspaceId);
  
  Future<void> deleteMention(String mentionId);
  
  Future<List<User>> searchUsers({
    required String query,
    String? workspaceId,
    int limit = 10,
  });
}
```

### Activity Feed Repository
```dart
class ActivityFeedRepository {
  Future<PersonalizedFeedResponse> getPersonalizedFeed({
    required String workspaceId,
    int limit = 50,
    int offset = 0,
    bool? includeRead,
  });
  
  Future<AggregatedFeedResponse> getAggregatedFeed({
    required String workspaceId,
    EntityType? entityType,
    int hoursBack = 24,
    int limit = 50,
  });
  
  Future<int> markActivitiesAsRead(List<String> activityIds);
  
  Future<int> markAllActivitiesAsRead(String workspaceId);
  
  Future<int> getUnreadCount(String workspaceId);
  
  Future<ActivityPreferences> getPreferences(String workspaceId);
  
  Future<ActivityPreferences> updatePreferences(
    String workspaceId,
    UpdatePreferencesRequest request,
  );
  
  Future<WorkspaceActivitySummary> getWorkspaceSummary({
    required String workspaceId,
    int daysBack = 7,
  });
}
```

---

## State Management (Riverpod Providers)

### Mention Providers
```dart
final mentionsRepositoryProvider = Provider<MentionsRepository>(...);

final unreadMentionsProvider = StreamProvider.autoDispose
  .family<List<Mention>, String>((ref, workspaceId) {...});

final unreadMentionCountProvider = StreamProvider.autoDispose
  .family<int, String>((ref, workspaceId) {...});

final userSearchProvider = FutureProvider.autoDispose
  .family<List<User>, UserSearchParams>((ref, params) {...});
```

### Activity Feed Providers
```dart
final activityFeedRepositoryProvider = Provider<ActivityFeedRepository>(...);

final personalizedFeedProvider = StateNotifierProvider.autoDispose
  .family<PersonalizedFeedNotifier, AsyncValue<List<Activity>>, String>(
    (ref, workspaceId) {...}
  );

final unreadActivityCountProvider = StreamProvider.autoDispose
  .family<int, String>((ref, workspaceId) {...});

final activityPreferencesProvider = StateNotifierProvider.autoDispose
  .family<ActivityPreferencesNotifier, AsyncValue<ActivityPreferences>, String>(
    (ref, workspaceId) {...}
  );
```

---

## WebSocket Integration

### Real-time Mention Updates
```dart
// Listen for mention events
wsService.messageStream.listen((message) {
  if (message['type'] == 'mention') {
    final mention = Mention.fromJson(message['mention']);
    ref.read(mentionsProvider.notifier).addMention(mention);
    _showMentionNotification(mention);
  }
});
```

### Real-time Activity Updates
```dart
// Listen for activity events
wsService.messageStream.listen((message) {
  if (message['type'] == 'activity') {
    final activity = Activity.fromJson(message['activity']);
    ref.read(activityFeedProvider.notifier).prependActivity(activity);
  }
});
```

---

## Accessibility Requirements

- All interactive elements must have semantic labels
- Screen reader support for mention text
- Keyboard navigation for mention picker
- High contrast mode support
- Minimum touch target size: 48x48dp
- Focus indicators on all focusable elements
- Announce unread counts to screen readers

---

## Performance Considerations

- Virtualized lists for mentions and activities
- Debounced user search (300ms)
- Pagination for large datasets
- Cache user data to reduce API calls
- Lazy load activity entity details
- Optimize WebSocket message handling
- Background fetch for unread counts

---

## Notes for Implementation

1. **Dependencies to add:**
   - `flutter_mentions` or build custom
   - `web_socket_channel` for WebSocket
   - `fl_chart` for activity charts (dashboard)

2. **Follow existing patterns:**
   - Use Riverpod for state management
   - Repository pattern for API calls
   - Feature-first folder structure
   - Consistent error handling

3. **Integration points:**
   - Add mention input to comment forms
   - Add mention input to task description
   - Show mentions badge in app bar
   - Show activity feed in side drawer or dedicated tab

4. **Deferred until post-stage-18:**
   - All UI components
   - All integration tests
   - WebSocket client implementation
   - State management setup

---

## Summary

All Stage 15 backend APIs are complete. The Flutter UI implementation (Tasks 5-7) is documented above and will be implemented after completing all 18 stages, following the project's established pattern of completing backend infrastructure across all stages before implementing UI layers.
