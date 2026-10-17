import { describe, expect, test } from '@jest/globals';
import {
  decodeSyncCursor,
  paginateSyncRows,
  prepareSyncQuery,
} from '../src/lib/sync-pagination.js';

const workspaceId = '11111111-1111-4111-8111-111111111111';
const timestamp = '2026-10-17T08:00:00.123456Z';

describe('sync pagination', () => {
  test('uses a stable timestamp, collection, and key tie-break across pages', () => {
    const data = {
      tasks: [
        { id: '00000000-0000-4000-8000-000000000002', updated_at: timestamp },
        { id: '00000000-0000-4000-8000-000000000001', updated_at: timestamp },
        { id: '00000000-0000-4000-8000-000000000003', updated_at: timestamp },
      ],
      labels: [
        { id: '00000000-0000-4000-8000-000000000001', updated_at: timestamp },
      ],
    };
    const rowsSeen = [];
    let cursor = null;
    let hasMore = true;

    while (hasMore) {
      const page = paginateSyncRows(data, 2, cursor, workspaceId);
      rowsSeen.push(...page.rows.tasks.map(row => `tasks:${row.id}`));
      rowsSeen.push(...page.rows.labels.map(row => `labels:${row.id}`));
      hasMore = page.hasMore;
      cursor = page.nextCursor ? decodeSyncCursor(page.nextCursor, workspaceId) : null;
      if (hasMore) expect(cursor).not.toBeNull();
    }

    expect(rowsSeen).toEqual([
      'tasks:00000000-0000-4000-8000-000000000001',
      'tasks:00000000-0000-4000-8000-000000000002',
      'tasks:00000000-0000-4000-8000-000000000003',
      'labels:00000000-0000-4000-8000-000000000001',
    ]);
    expect(new Set(rowsSeen).size).toBe(rowsSeen.length);
  });

  test('does not collapse distinct microsecond timestamps to the same page position', () => {
    const data = {
      tasks: [
        { id: '00000000-0000-4000-8000-000000000002', updated_at: '2026-10-17T08:00:00.123457Z' },
        { id: '00000000-0000-4000-8000-000000000001', updated_at: '2026-10-17T08:00:00.123456Z' },
      ],
    };
    const firstPage = paginateSyncRows(data, 1, null, workspaceId);
    const cursor = decodeSyncCursor(firstPage.nextCursor, workspaceId);
    const secondPage = paginateSyncRows(data, 1, cursor, workspaceId);

    expect(firstPage.rows.tasks.map(row => row.id)).toEqual(['00000000-0000-4000-8000-000000000001']);
    expect(secondPage.rows.tasks.map(row => row.id)).toEqual(['00000000-0000-4000-8000-000000000002']);
    expect(secondPage.hasMore).toBe(false);
  });

  test('rejects a cursor created for a different workspace', () => {
    const page = paginateSyncRows({
      tasks: [
        { id: '00000000-0000-4000-8000-000000000001', updated_at: timestamp },
        { id: '00000000-0000-4000-8000-000000000002', updated_at: timestamp },
      ],
    }, 1, null, workspaceId);
    expect(decodeSyncCursor(page.nextCursor, '22222222-2222-4222-8222-222222222222')).toBeNull();
  });

  test('builds a composite primary-key tie-break filter for database paging', () => {
    const calls = [];
    const query = Object.fromEntries(
      ['gte', 'gt', 'or', 'order', 'limit'].map(method => [
        method,
        (...args) => {
          calls.push([method, ...args]);
          return query;
        },
      ]),
    );
    const cursor = {
      collection: 'taskAttachments',
      key: '00000000-0000-4000-8000-000000000001:00000000-0000-4000-8000-000000000002',
      updatedAt: timestamp,
    };

    prepareSyncQuery(query, 'taskAttachments', timestamp, cursor, 10);

    expect(calls.find(([method]) => method === 'or')[1]).toContain(
      'and(updated_at.eq.2026-10-17T08:00:00.123456Z,task_id.eq.00000000-0000-4000-8000-000000000001,file_id.gt.00000000-0000-4000-8000-000000000002)',
    );
    expect(calls.filter(([method]) => method === 'order').map(([, field]) => field))
      .toEqual(['updated_at', 'task_id', 'file_id']);
    expect(calls.at(-1)).toEqual(['limit', 10]);
  });
});
