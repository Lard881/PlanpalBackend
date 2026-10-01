# Team Dashboard API Documentation

## Overview
The Team Dashboard API provides comprehensive collaboration metrics, member statistics, task trends, and project health indicators for workspace management and team performance monitoring.

**Base URL:** `/api/v1/team-dashboard`

**Authentication:** Required for all endpoints

---

## Endpoints

### 1. Get Dashboard Overview

Get high-level workspace metrics and team statistics.

**Endpoint:** `GET /api/v1/team-dashboard/:workspace_id/overview`

**URL Parameters:**
- `workspace_id`: Workspace UUID

**Query Parameters:**
- `period` (string, optional): Time period for metrics (default: `30d`)
  - Options: `7d`, `14d`, `30d`, `90d`

**Response:** `200 OK`
```json
{
  "workspace_id": "uuid",
  "period": "30d",
  "overview": {
    "members": {
      "total": 15,
      "online": 8
    },
    "tasks": {
      "total": 245,
      "active": 89,
      "completed": 156,
      "overdue": 12,
      "completion_rate": 64
    },
    "engagement": {
      "activities": 1247,
      "comments": 532,
      "mentions": 89
    }
  }
}
```

**Use Case:** Dashboard homepage summary widget

**Example:**
```bash
curl -X GET "https://api.planpal.com/api/v1/team-dashboard/abc-123/overview?period=30d" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

---

### 2. Get Member Statistics

Get detailed statistics for each team member.

**Endpoint:** `GET /api/v1/team-dashboard/:workspace_id/members`

**URL Parameters:**
- `workspace_id`: Workspace UUID

**Query Parameters:**
- `period` (string, optional): Time period (default: `30d`)
  - Options: `7d`, `14d`, `30d`, `90d`
- `sort_by` (string, optional): Sort field (default: `tasks_completed`)
  - Options: `tasks_completed`, `comments`, `activity_count`

**Response:** `200 OK`
```json
{
  "workspace_id": "uuid",
  "period": "30d",
  "members": [
    {
      "user_id": "uuid",
      "name": "John Doe",
      "email": "john@example.com",
      "avatar_url": "https://...",
      "role": "admin",
      "joined_at": "2024-01-01T00:00:00Z",
      "is_online": true,
      "stats": {
        "tasks_assigned": 23,
        "tasks_completed": 18,
        "tasks_created": 5,
        "comments": 47,
        "activity_count": 152,
        "mentions_received": 12
      }
    }
  ]
}
```

**Use Case:** Team leaderboard, member performance tracking

**Example:**
```bash
curl -X GET "https://api.planpal.com/api/v1/team-dashboard/abc-123/members?period=7d&sort_by=comments" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

---

### 3. Get Task Completion Trends

Get task creation and completion trends over time.

**Endpoint:** `GET /api/v1/team-dashboard/:workspace_id/task-trends`

**URL Parameters:**
- `workspace_id`: Workspace UUID

**Query Parameters:**
- `period` (string, optional): Time period (default: `30d`)
  - Options: `7d`, `14d`, `30d`, `90d`
- `granularity` (string, optional): Data granularity (default: `day`)
  - Options: `day`, `week`

**Response:** `200 OK`
```json
{
  "workspace_id": "uuid",
  "period": "30d",
  "granularity": "day",
  "trends": [
    {
      "date": "2024-01-01",
      "completed": 15,
      "created": 8
    },
    {
      "date": "2024-01-02",
      "completed": 12,
      "created": 10
    }
  ]
}
```

**Use Case:** Line/bar charts showing task velocity

**Example:**
```bash
curl -X GET "https://api.planpal.com/api/v1/team-dashboard/abc-123/task-trends?period=14d&granularity=day" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

---

### 4. Get Project Health Metrics

Get health scores and metrics for all projects.

**Endpoint:** `GET /api/v1/team-dashboard/:workspace_id/project-health`

**URL Parameters:**
- `workspace_id`: Workspace UUID

**Response:** `200 OK`
```json
{
  "workspace_id": "uuid",
  "projects": [
    {
      "project_id": "uuid",
      "project_name": "Website Redesign",
      "project_color": "#FF5733",
      "created_at": "2024-01-01T00:00:00Z",
      "metrics": {
        "total_tasks": 45,
        "completed_tasks": 28,
        "active_tasks": 17,
        "overdue_tasks": 3,
        "completion_rate": 62,
        "overdue_rate": 7,
        "recent_activity": 34
      },
      "health": {
        "score": 78,
        "status": "good"
      }
    }
  ]
}
```

**Health Status Values:**
- `excellent`: Score 80-100
- `good`: Score 60-79
- `poor`: Score 40-59
- `critical`: Score 0-39

**Health Score Calculation:**
- Starts at 100
- Penalty: 50% of overdue rate
- Penalty: 30% of (100 - completion rate)
- Clamped between 0-100

**Use Case:** Project health dashboard, risk identification

**Example:**
```bash
curl -X GET "https://api.planpal.com/api/v1/team-dashboard/abc-123/project-health" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

---

### 5. Get Activity Heatmap

Get activity distribution by day of week and hour of day.

**Endpoint:** `GET /api/v1/team-dashboard/:workspace_id/activity-heatmap`

**URL Parameters:**
- `workspace_id`: Workspace UUID

**Query Parameters:**
- `period` (string, optional): Time period (default: `30d`)
  - Options: `7d`, `14d`, `30d`, `90d`

**Response:** `200 OK`
```json
{
  "workspace_id": "uuid",
  "period": "30d",
  "heatmap": [
    {
      "day": "Mon",
      "hours": [
        { "hour": 0, "count": 2 },
        { "hour": 1, "count": 0 },
        { "hour": 9, "count": 45 },
        { "hour": 10, "count": 67 }
      ]
    },
    {
      "day": "Tue",
      "hours": [...]
    }
  ]
}
```

**Days:** Sun, Mon, Tue, Wed, Thu, Fri, Sat  
**Hours:** 0-23 (24-hour format)

**Use Case:** Heatmap visualization showing peak activity times

**Example:**
```bash
curl -X GET "https://api.planpal.com/api/v1/team-dashboard/abc-123/activity-heatmap?period=30d" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

---

### 6. Get Top Contributors

Get top contributors ranked by activity.

**Endpoint:** `GET /api/v1/team-dashboard/:workspace_id/top-contributors`

**URL Parameters:**
- `workspace_id`: Workspace UUID

**Query Parameters:**
- `period` (string, optional): Time period (default: `30d`)
  - Options: `7d`, `14d`, `30d`, `90d`

**Response:** `200 OK`
```json
{
  "workspace_id": "uuid",
  "period": "30d",
  "contributors": [
    {
      "user_id": "uuid",
      "name": "John Doe",
      "email": "john@example.com",
      "avatar_url": "https://...",
      "activity_count": 245
    }
  ]
}
```

**Note:** Returns top 10 contributors

**Use Case:** Contributor leaderboard, recognition

**Example:**
```bash
curl -X GET "https://api.planpal.com/api/v1/team-dashboard/abc-123/top-contributors?period=7d" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

---

## Metrics Definitions

### Member Statistics

- **tasks_assigned**: Total tasks currently assigned to the member
- **tasks_completed**: Tasks completed in the selected period
- **tasks_created**: Tasks created by the member in the period
- **comments**: Comments posted in the period
- **activity_count**: All activities (creates, updates, comments, etc.) in the period
- **mentions_received**: Times the member was mentioned in the period

### Task Metrics

- **total**: All tasks in workspace (any status)
- **active**: Tasks not marked as completed
- **completed**: Tasks with status "completed"
- **overdue**: Active tasks with due_date in the past
- **completion_rate**: (completed / total) × 100

### Engagement Metrics

- **activities**: All logged activities in the period
- **comments**: All comments posted in the period
- **mentions**: All @mentions created in the period

### Project Health Metrics

- **completion_rate**: Percentage of tasks completed
- **overdue_rate**: Percentage of tasks overdue
- **recent_activity**: Activity count in last 7 days
- **health_score**: Calculated score 0-100 based on multiple factors
- **health_status**: Categorical assessment (excellent, good, poor, critical)

---

## Use Cases

### Executive Dashboard

Combine multiple endpoints for comprehensive overview:

1. **Overview Widget**: `/overview` - Key metrics at a glance
2. **Team Performance**: `/members` - Who's doing what
3. **Task Velocity**: `/task-trends` - Are we on track?
4. **Project Status**: `/project-health` - What needs attention?

### Team Leaderboard

Display top performers using `/members` or `/top-contributors`:

```javascript
// Get top 5 by tasks completed
const response = await fetch('/team-dashboard/abc-123/members?period=7d&sort_by=tasks_completed');
const topPerformers = response.data.members.slice(0, 5);
```

### Capacity Planning

Use `/activity-heatmap` to identify:
- Peak activity hours
- Underutilized time slots
- Team timezone distribution

### Risk Management

Use `/project-health` to identify at-risk projects:

```javascript
const response = await fetch('/team-dashboard/abc-123/project-health');
const atRisk = response.data.projects.filter(p => 
  p.health.status === 'poor' || p.health.status === 'critical'
);
```

---

## Performance Considerations

### Caching Strategy

Dashboard metrics can be cached:
- **Overview**: Cache for 5 minutes
- **Member Stats**: Cache for 10 minutes
- **Task Trends**: Cache for 15 minutes
- **Project Health**: Cache for 10 minutes
- **Activity Heatmap**: Cache for 30 minutes
- **Top Contributors**: Cache for 15 minutes

### Optimization Tips

1. **Parallel Requests**: Fetch multiple endpoints simultaneously
2. **Period Selection**: Use shorter periods (7d) for faster responses
3. **Progressive Loading**: Load overview first, then details
4. **Background Refresh**: Update data in background, show cached version

---

## Error Handling

### Common Errors

**403 Forbidden**
- User not a member of the workspace
- Insufficient permissions

**404 Not Found**
- Workspace doesn't exist

**400 Bad Request**
- Invalid period value
- Invalid sort_by field
- Invalid granularity

**500 Internal Server Error**
- Database query timeout
- Unexpected error

---

## Example Dashboard Implementation

### React Component

```javascript
import { useState, useEffect } from 'react';

function TeamDashboard({ workspaceId, token }) {
  const [overview, setOverview] = useState(null);
  const [members, setMembers] = useState([]);
  const [trends, setTrends] = useState([]);
  const [period, setPeriod] = useState('30d');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadDashboardData();
  }, [workspaceId, period]);

  const loadDashboardData = async () => {
    setLoading(true);
    
    try {
      // Fetch all data in parallel
      const [overviewRes, membersRes, trendsRes] = await Promise.all([
        fetch(`/api/v1/team-dashboard/${workspaceId}/overview?period=${period}`, {
          headers: { Authorization: `Bearer ${token}` }
        }),
        fetch(`/api/v1/team-dashboard/${workspaceId}/members?period=${period}`, {
          headers: { Authorization: `Bearer ${token}` }
        }),
        fetch(`/api/v1/team-dashboard/${workspaceId}/task-trends?period=${period}`, {
          headers: { Authorization: `Bearer ${token}` }
        }),
      ]);

      const [overviewData, membersData, trendsData] = await Promise.all([
        overviewRes.json(),
        membersRes.json(),
        trendsRes.json(),
      ]);

      setOverview(overviewData.overview);
      setMembers(membersData.members);
      setTrends(trendsData.trends);
    } catch (error) {
      console.error('Error loading dashboard:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <LoadingSpinner />;

  return (
    <div className="dashboard">
      <PeriodSelector period={period} onChange={setPeriod} />
      
      <div className="dashboard-grid">
        <OverviewCards overview={overview} />
        <TaskTrendsChart trends={trends} />
        <MemberLeaderboard members={members} />
        <OnlineMembers members={members.filter(m => m.is_online)} />
      </div>
    </div>
  );
}
```

### Flutter Implementation

```dart
class TeamDashboardScreen extends StatefulWidget {
  final String workspaceId;
  
  @override
  _TeamDashboardScreenState createState() => _TeamDashboardScreenState();
}

class _TeamDashboardScreenState extends State<TeamDashboardScreen> {
  String period = '30d';
  DashboardOverview? overview;
  List<MemberStats> members = [];
  List<TaskTrend> trends = [];
  bool loading = true;

  @override
  void initState() {
    super.initState();
    loadDashboard();
  }

  Future<void> loadDashboard() async {
    setState(() => loading = true);
    
    try {
      final results = await Future.wait([
        _fetchOverview(),
        _fetchMembers(),
        _fetchTrends(),
      ]);
      
      setState(() {
        overview = results[0] as DashboardOverview;
        members = results[1] as List<MemberStats>;
        trends = results[2] as List<TaskTrend>;
        loading = false;
      });
    } catch (e) {
      print('Error loading dashboard: $e');
      setState(() => loading = false);
    }
  }

  Future<DashboardOverview> _fetchOverview() async {
    final response = await http.get(
      Uri.parse('$baseUrl/team-dashboard/${widget.workspaceId}/overview?period=$period'),
      headers: {'Authorization': 'Bearer $token'},
    );
    return DashboardOverview.fromJson(jsonDecode(response.body)['overview']);
  }

  @override
  Widget build(BuildContext context) {
    if (loading) return LoadingIndicator();
    
    return Scaffold(
      appBar: AppBar(
        title: Text('Team Dashboard'),
        actions: [PeriodDropdown(period: period, onChanged: _onPeriodChanged)],
      ),
      body: RefreshIndicator(
        onRefresh: loadDashboard,
        child: ListView(
          children: [
            OverviewCards(overview: overview!),
            TaskTrendsChart(trends: trends),
            MemberList(members: members),
          ],
        ),
      ),
    );
  }
}
```

---

## Best Practices

1. **Refresh Strategy**: Auto-refresh dashboard every 5 minutes
2. **Loading States**: Show skeleton loaders while fetching
3. **Error Handling**: Display friendly error messages
4. **Responsive Design**: Adapt layout for mobile/tablet/desktop
5. **Data Visualization**: Use charts/graphs for trends and metrics
6. **Real-time Updates**: Integrate with WebSocket for live data
7. **Export Capability**: Allow exporting metrics to CSV/PDF

---

## Security

- **Authorization**: Only workspace members can access dashboard
- **Rate Limiting**: Standard API rate limits apply
- **Data Privacy**: Members can only see workspace-level data
- **Audit Logging**: Dashboard access is logged

---

## Changelog

### Version 1.0 (Stage 15 - Task 4)
- Initial team dashboard implementation
- Overview metrics endpoint
- Member statistics endpoint
- Task trends endpoint
- Project health metrics
- Activity heatmap
- Top contributors endpoint
