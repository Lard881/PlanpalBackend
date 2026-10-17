import { describe, expect, test } from '@jest/globals';
import { createFolderSchema, updateFolderSchema } from '../src/routes/documents.js';
import { createEventSchema } from '../src/routes/events.js';
import { createLabelSchema, updateLabelSchema } from '../src/routes/labels.js';
import {
  createCommentSchema,
  createSubtaskSchema,
  createTaskSchema,
  updateSubtaskSchema,
  updateTaskSchema,
} from '../src/routes/tasks.js';
import { createWorkspaceSchema, updateWorkspaceSchema } from '../src/routes/workspaces.js';

const acceptsLength = (schema, field, value, length) =>
  schema.safeParse({ ...value, [field]: 'x'.repeat(length) }).success;

describe('API input limits match database constraints', () => {
  test('workspace names allow up to 80 characters for create and update', () => {
    expect(acceptsLength(createWorkspaceSchema, 'name', {}, 80)).toBe(true);
    expect(acceptsLength(createWorkspaceSchema, 'name', {}, 81)).toBe(false);
    expect(acceptsLength(updateWorkspaceSchema, 'name', {}, 80)).toBe(true);
    expect(acceptsLength(updateWorkspaceSchema, 'name', {}, 81)).toBe(false);
  });

  test('label names allow up to 40 characters for create and update', () => {
    const labelFields = { color: '#123456' };
    expect(acceptsLength(createLabelSchema, 'name', labelFields, 40)).toBe(true);
    expect(acceptsLength(createLabelSchema, 'name', labelFields, 41)).toBe(false);
    expect(acceptsLength(updateLabelSchema, 'name', labelFields, 40)).toBe(true);
    expect(acceptsLength(updateLabelSchema, 'name', labelFields, 41)).toBe(false);
  });

  test('task and subtask titles allow up to 200 characters', () => {
    expect(acceptsLength(createTaskSchema, 'title', {}, 200)).toBe(true);
    expect(acceptsLength(createTaskSchema, 'title', {}, 201)).toBe(false);
    expect(acceptsLength(updateTaskSchema, 'title', {}, 200)).toBe(true);
    expect(acceptsLength(updateTaskSchema, 'title', {}, 201)).toBe(false);
    expect(acceptsLength(createSubtaskSchema, 'title', {}, 200)).toBe(true);
    expect(acceptsLength(createSubtaskSchema, 'title', {}, 201)).toBe(false);
    expect(acceptsLength(updateSubtaskSchema, 'title', {}, 200)).toBe(true);
    expect(acceptsLength(updateSubtaskSchema, 'title', {}, 201)).toBe(false);
  });

  test('comment bodies allow up to 4000 characters', () => {
    expect(acceptsLength(createCommentSchema, 'body', {}, 4000)).toBe(true);
    expect(acceptsLength(createCommentSchema, 'body', {}, 4001)).toBe(false);
  });

  test('folder names allow up to 80 characters for create and update', () => {
    expect(acceptsLength(createFolderSchema, 'name', {}, 80)).toBe(true);
    expect(acceptsLength(createFolderSchema, 'name', {}, 81)).toBe(false);
    expect(acceptsLength(updateFolderSchema, 'name', {}, 80)).toBe(true);
    expect(acceptsLength(updateFolderSchema, 'name', {}, 81)).toBe(false);
  });

  test('events may have equal start and end times, as permitted by the database check', () => {
    const event = {
      title: 'Event',
      startsAt: '2026-10-17T08:00:00.000Z',
      endsAt: '2026-10-17T08:00:00.000Z',
    };
    expect(createEventSchema.safeParse(event).success).toBe(true);
    expect(createEventSchema.safeParse({
      ...event,
      endsAt: '2026-10-17T07:59:59.999Z',
    }).success).toBe(false);
  });
});
