import request from 'supertest';
import { createApp } from '../src/app.js';
import { supabase } from '../src/config/supabase.js';

const app = createApp();

// Mock user IDs
const USER_ID = '123e4567-e89b-12d3-a456-426614174000';
const USER2_ID = '223e4567-e89b-12d3-a456-426614174000';
const WORKSPACE_ID = '323e4567-e89b-12d3-a456-426614174000';

// Mock auth token
const mockToken = 'mock-jwt-token';

// Mock Supabase auth
jest.mock('../src/config/supabase.js', () => ({
  supabase: {
    from: jest.fn(),
    rpc: jest.fn(),
    auth: {
      getUser: jest.fn(),
    },
  },
}));

// Mock JWT verification
jest.mock('jsonwebtoken', () => ({
  verify: jest.fn(() => ({
    sub: USER_ID,
    email: 'test@example.com',
  })),
}));

describe('Analytics API Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /api/v1/analytics/events', () => {
    test('should log a single analytics event successfully', async () => {
      const mockEvent = {
        id: 'event-1',
        user_id: USER_ID,
        workspace_id: WORKSPACE_ID,
        event_type: 'task_created',
        event_data: { task_id: 'task-1' },
        created_at: new Date().toISOString()
      };

      supabase.from.mockReturnValue({
        insert: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({
              data: mockEvent,
              error: null
            })
          })
        })
      });

      const response = await request(app)
        .post('/api/v1/analytics/events')
        .set('Authorization', `Bearer ${mockToken}`)
        .send({
          event_type: 'task_created',
          workspace_id: WORKSPACE_ID,
          event_data: { task_id: 'task-1' }
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.event).toMatchObject({
        event_type: 'task_created',
        workspace_id: WORKSPACE_ID
      });
    });

    test('should reject invalid event_type', async () => {
      const response = await request(app)
        .post('/api/v1/analytics/events')
        .set('Authorization', `Bearer ${mockToken}`)
        .send({
          event_type: 'invalid_event',
          workspace_id: WORKSPACE_ID
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Invalid event_type');
    });

    test('should require authentication', async () => {
      const response = await request(app)
        .post('/api/v1/analytics/events')
        .send({
          event_type: 'task_created',
          workspace_id: WORKSPACE_ID
        });

      expect(response.status).toBe(401);
    });

    test('should handle missing event_type', async () => {
      const response = await request(app)
        .post('/api/v1/analytics/events')
        .set('Authorization', `Bearer ${mockToken}`)
        .send({
          workspace_id: WORKSPACE_ID
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBeDefined();
    });

    test('should allow null workspace_id', async () => {
      const mockEvent = {
        id: 'event-1',
        user_id: USER_ID,
        workspace_id: null,
        event_type: 'page_viewed',
        event_data: { page: '/dashboard' },
        created_at: new Date().toISOString()
      };

      supabase.from.mockReturnValue({
        insert: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({
              data: mockEvent,
              error: null
            })
          })
        })
      });

      const response = await request(app)
        .post('/api/v1/analytics/events')
        .set('Authorization', `Bearer ${mockToken}`)
        .send({
          event_type: 'page_viewed',
          event_data: { page: '/dashboard' }
        });

      expect(response.status).toBe(201);
      expect(response.body.event.workspace_id).toBeNull();
    });
  });

  describe('POST /api/v1/analytics/events/batch', () => {
    test('should log multiple events in batch', async () => {
      const mockEvents = [
        {
          id: 'event-1',
          user_id: USER_ID,
          workspace_id: WORKSPACE_ID,
          event_type: 'task_created',
          event_data: { task_id: 'task-1' },
          created_at: new Date().toISOString()
        },
        {
          id: 'event-2',
          user_id: USER_ID,
          workspace_id: WORKSPACE_ID,
          event_type: 'search_performed',
          event_data: { query: 'test' },
          created_at: new Date().toISOString()
        }
      ];

      supabase.from.mockReturnValue({
        insert: jest.fn().mockReturnValue({
          select: jest.fn().mockResolvedValue({
            data: mockEvents,
            error: null
          })
        })
      });

      const response = await request(app)
        .post('/api/v1/analytics/events/batch')
        .set('Authorization', `Bearer ${mockToken}`)
        .send({
          events: [
            {
              event_type: 'task_created',
              workspace_id: WORKSPACE_ID,
              event_data: { task_id: 'task-1' }
            },
            {
              event_type: 'search_performed',
              workspace_id: WORKSPACE_ID,
              event_data: { query: 'test' }
            }
          ]
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.count).toBe(2);
      expect(response.body.events).toHaveLength(2);
    });

    test('should reject empty events array', async () => {
      const response = await request(app)
        .post('/api/v1/analytics/events/batch')
        .set('Authorization', `Bearer ${mockToken}`)
        .send({
          events: []
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('non-empty array');
    });

    test('should reject more than 100 events', async () => {
      const events = Array(101).fill({
        event_type: 'task_created',
        workspace_id: WORKSPACE_ID
      });

      const response = await request(app)
        .post('/api/v1/analytics/events/batch')
        .set('Authorization', `Bearer ${mockToken}`)
        .send({ events });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Maximum 100 events');
    });

    test('should reject batch with invalid event_type', async () => {
      const response = await request(app)
        .post('/api/v1/analytics/events/batch')
        .set('Authorization', `Bearer ${mockToken}`)
        .send({
          events: [
            { event_type: 'task_created', workspace_id: WORKSPACE_ID },
            { event_type: 'invalid_type', workspace_id: WORKSPACE_ID }
          ]
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Invalid event_type');
    });
  });

  describe('GET /api/v1/analytics/dashboard', () => {
    test('should return dashboard data with default date range', async () => {
      const mockMetrics = [{
        total_created: 45,
        total_completed: 38,
        completion_rate: 84.44,
        avg_completion_time_hours: 12.5
      }];

      const mockEventCounts = [
        { event_type: 'task_created', event_count: 45 },
        { event_type: 'task_completed', event_count: 38 }
      ];

      const mockDailyActivity = [
        { activity_date: '2024-01-01', event_count: 12 },
        { activity_date: '2024-01-02', event_count: 18 }
      ];

      supabase.rpc
        .mockResolvedValueOnce({ data: mockMetrics, error: null })
        .mockResolvedValueOnce({ data: mockEventCounts, error: null })
        .mockResolvedValueOnce({ data: mockDailyActivity, error: null });

      const response = await request(app)
        .get('/api/v1/analytics/dashboard')
        .set('Authorization', `Bearer ${mockToken}`);

      expect(response.status).toBe(200);
      expect(response.body.task_metrics).toEqual(mockMetrics[0]);
      expect(response.body.event_counts).toEqual(mockEventCounts);
      expect(response.body.daily_activity).toEqual(mockDailyActivity);
      expect(response.body.period).toBeDefined();
    });

    test('should support workspace filtering', async () => {
      supabase.rpc
        .mockResolvedValueOnce({ data: [{}], error: null })
        .mockResolvedValueOnce({ data: [], error: null })
        .mockResolvedValueOnce({ data: [], error: null });

      const response = await request(app)
        .get('/api/v1/analytics/dashboard')
        .query({ workspace_id: WORKSPACE_ID })
        .set('Authorization', `Bearer ${mockToken}`);

      expect(response.status).toBe(200);
      expect(response.body.workspace_id).toBe(WORKSPACE_ID);
    });

    test('should support custom date range', async () => {
      const startDate = '2024-01-01T00:00:00Z';
      const endDate = '2024-01-31T23:59:59Z';

      supabase.rpc
        .mockResolvedValueOnce({ data: [{}], error: null })
        .mockResolvedValueOnce({ data: [], error: null })
        .mockResolvedValueOnce({ data: [], error: null });

      const response = await request(app)
        .get('/api/v1/analytics/dashboard')
        .query({ start_date: startDate, end_date: endDate })
        .set('Authorization', `Bearer ${mockToken}`);

      expect(response.status).toBe(200);
      expect(response.body.period.start_date).toBe(startDate);
      expect(response.body.period.end_date).toBe(endDate);
    });

    test('should reject invalid date format', async () => {
      const response = await request(app)
        .get('/api/v1/analytics/dashboard')
        .query({ start_date: 'invalid-date' })
        .set('Authorization', `Bearer ${mockToken}`);

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Invalid date format');
    });

    test('should reject start_date after end_date', async () => {
      const response = await request(app)
        .get('/api/v1/analytics/dashboard')
        .query({
          start_date: '2024-12-31T00:00:00Z',
          end_date: '2024-01-01T00:00:00Z'
        })
        .set('Authorization', `Bearer ${mockToken}`);

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('start_date must be before end_date');
    });
  });

  describe('GET /api/v1/analytics/workspace/:workspaceId', () => {
    test('should return workspace analytics for admin', async () => {
      const mockMembership = { role: 'admin' };
      const mockMembers = [
        { user_id: USER_ID, profiles: { full_name: 'User 1', email: 'user1@test.com' } },
        { user_id: USER2_ID, profiles: { full_name: 'User 2', email: 'user2@test.com' } }
      ];

      supabase.from.mockImplementation((table) => {
        if (table === 'workspace_members') {
          return {
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                eq: jest.fn().mockReturnValue({
                  single: jest.fn().mockResolvedValue({
                    data: mockMembership,
                    error: null
                  })
                })
              }),
              single: undefined
            })
          };
        }
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockResolvedValue({
              data: mockMembers,
              error: null
            })
          })
        };
      });

      supabase.from.mockReturnValueOnce({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({
                data: mockMembership,
                error: null
              })
            })
          })
        })
      }).mockReturnValueOnce({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockResolvedValue({
            data: mockMembers,
            error: null
          })
        })
      }).mockReturnValueOnce({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            gte: jest.fn().mockReturnValue({
              lte: jest.fn().mockResolvedValue({
                count: 450,
                error: null
              })
            })
          })
        })
      }).mockReturnValueOnce({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            gte: jest.fn().mockReturnValue({
              lte: jest.fn().mockResolvedValue({
                data: [],
                error: null
              })
            })
          })
        })
      });

      const response = await request(app)
        .get(`/api/v1/analytics/workspace/${WORKSPACE_ID}`)
        .set('Authorization', `Bearer ${mockToken}`);

      expect(response.status).toBe(200);
      expect(response.body.workspace_id).toBe(WORKSPACE_ID);
      expect(response.body.total_members).toBe(2);
    });

    test('should deny access for non-admin', async () => {
      supabase.from.mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({
                data: { role: 'member' },
                error: null
              })
            })
          })
        })
      });

      const response = await request(app)
        .get(`/api/v1/analytics/workspace/${WORKSPACE_ID}`)
        .set('Authorization', `Bearer ${mockToken}`);

      expect(response.status).toBe(403);
      expect(response.body.error).toContain('admin required');
    });

    test('should deny access for non-members', async () => {
      supabase.from.mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({
                data: null,
                error: { code: 'PGRST116' }
              })
            })
          })
        })
      });

      const response = await request(app)
        .get(`/api/v1/analytics/workspace/${WORKSPACE_ID}`)
        .set('Authorization', `Bearer ${mockToken}`);

      expect(response.status).toBe(403);
    });
  });

  describe('GET /api/v1/analytics/insights', () => {
    test('should return comprehensive insights', async () => {
      const mockProductivityTrends = [
        { week_start: '2024-01-01', tasks_created: 10, tasks_completed: 8, completion_rate: 80, total_events: 50 }
      ];

      const mockStatusDistribution = [
        { status: 'todo', task_count: 15, percentage: 50 },
        { status: 'completed', task_count: 10, percentage: 33.33 }
      ];

      const mockPriorityDistribution = [
        { priority: 'high', task_count: 8, percentage: 40 },
        { priority: 'medium', task_count: 7, percentage: 35 }
      ];

      const mockActiveHours = [
        { hour_of_day: 9, event_count: 120, percentage: 25 }
      ];

      const mockActiveDays = [
        { day_of_week: 1, day_name: 'Monday', event_count: 200, percentage: 30 }
      ];

      const mockOverdueTasks = [
        { overdue_count: 5, overdue_high_priority: 2, total_active_tasks: 20 }
      ];

      const mockAvgTasks = [
        { avg_created_per_day: 3.5, avg_completed_per_day: 2.8, total_days: 30 }
      ];

      const mockStreak = [
        { current_streak: 5, longest_streak: 12, last_completion_date: '2024-01-15' }
      ];

      supabase.rpc
        .mockResolvedValueOnce({ data: mockProductivityTrends, error: null })
        .mockResolvedValueOnce({ data: mockStatusDistribution, error: null })
        .mockResolvedValueOnce({ data: mockPriorityDistribution, error: null })
        .mockResolvedValueOnce({ data: mockActiveHours, error: null })
        .mockResolvedValueOnce({ data: mockActiveDays, error: null })
        .mockResolvedValueOnce({ data: mockOverdueTasks, error: null })
        .mockResolvedValueOnce({ data: mockAvgTasks, error: null })
        .mockResolvedValueOnce({ data: mockStreak, error: null });

      const response = await request(app)
        .get('/api/v1/analytics/insights')
        .set('Authorization', `Bearer ${mockToken}`);

      expect(response.status).toBe(200);
      expect(response.body.productivity_trends).toEqual(mockProductivityTrends);
      expect(response.body.status_distribution).toEqual(mockStatusDistribution);
      expect(response.body.priority_distribution).toEqual(mockPriorityDistribution);
      expect(response.body.active_hours).toEqual(mockActiveHours);
      expect(response.body.active_days).toEqual(mockActiveDays);
      expect(response.body.insights).toBeDefined();
      expect(Array.isArray(response.body.insights)).toBe(true);
    });

    test('should generate insights from data', async () => {
      const mockActiveDays = [
        { day_of_week: 1, day_name: 'Monday', event_count: 200, percentage: 40 }
      ];

      const mockActiveHours = [
        { hour_of_day: 14, event_count: 120, percentage: 30 }
      ];

      supabase.rpc
        .mockResolvedValueOnce({ data: [], error: null })
        .mockResolvedValueOnce({ data: [], error: null })
        .mockResolvedValueOnce({ data: [], error: null })
        .mockResolvedValueOnce({ data: mockActiveHours, error: null })
        .mockResolvedValueOnce({ data: mockActiveDays, error: null })
        .mockResolvedValueOnce({ data: [{ overdue_count: 0 }], error: null })
        .mockResolvedValueOnce({ data: [{ avg_completed_per_day: 3.2 }], error: null })
        .mockResolvedValueOnce({ data: [], error: null });

      const response = await request(app)
        .get('/api/v1/analytics/insights')
        .set('Authorization', `Bearer ${mockToken}`);

      expect(response.status).toBe(200);
      const insights = response.body.insights;
      expect(insights.some(i => i.type === 'most_productive_day')).toBe(true);
      expect(insights.some(i => i.type === 'most_active_hour')).toBe(true);
    });
  });

  describe('GET /api/v1/analytics/workspace/:workspaceId/team', () => {
    test('should return team activity for admin', async () => {
      const mockMembership = { role: 'admin' };
      const mockTeamActivity = [
        {
          user_id: USER_ID,
          full_name: 'User 1',
          total_events: 125,
          tasks_created: 45,
          tasks_completed: 38,
          comments_added: 15,
          last_active: '2024-01-15T10:00:00Z'
        }
      ];

      supabase.from.mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({
                data: mockMembership,
                error: null
              })
            })
          })
        })
      });

      supabase.rpc.mockResolvedValue({
        data: mockTeamActivity,
        error: null
      });

      const response = await request(app)
        .get(`/api/v1/analytics/workspace/${WORKSPACE_ID}/team`)
        .set('Authorization', `Bearer ${mockToken}`);

      expect(response.status).toBe(200);
      expect(response.body.team_activity).toEqual(mockTeamActivity);
      expect(response.body.workspace_id).toBe(WORKSPACE_ID);
    });

    test('should deny access for non-admin', async () => {
      supabase.from.mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({
                data: { role: 'member' },
                error: null
              })
            })
          })
        })
      });

      const response = await request(app)
        .get(`/api/v1/analytics/workspace/${WORKSPACE_ID}/team`)
        .set('Authorization', `Bearer ${mockToken}`);

      expect(response.status).toBe(403);
    });
  });

  describe('Valid Event Types', () => {
    const validEventTypes = [
      'task_created',
      'task_completed',
      'task_updated',
      'task_deleted',
      'search_performed',
      'attachment_uploaded',
      'comment_added',
      'label_applied',
      'project_created',
      'workspace_joined',
      'reminder_set',
      'filter_applied',
      'export_performed',
      'notification_clicked',
      'page_viewed'
    ];

    validEventTypes.forEach(eventType => {
      test(`should accept event_type: ${eventType}`, async () => {
        supabase.from.mockReturnValue({
          insert: jest.fn().mockReturnValue({
            select: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({
                data: { event_type: eventType },
                error: null
              })
            })
          })
        });

        const response = await request(app)
          .post('/api/v1/analytics/events')
          .set('Authorization', `Bearer ${mockToken}`)
          .send({ event_type: eventType });

        expect(response.status).toBe(201);
      });
    });
  });
});
