import { describe, expect, it } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import {
  createFolderSchema,
  listFoldersQuerySchema,
} from '../src/routes/documents.js';

describe('Documents folder create schema', () => {
  it('accepts a client-generated folder ID for offline synchronization', () => {
    const id = randomUUID();
    const result = createFolderSchema.safeParse({
      id,
      name: 'Offline folder',
    });

    expect(result.success).toBe(true);
    expect(result.data.id).toBe(id);
  });

  it('continues to allow server-generated folder IDs', () => {
    const result = createFolderSchema.safeParse({ name: 'Online folder' });

    expect(result.success).toBe(true);
    expect(result.data.id).toBeUndefined();
  });

  it('accepts a parent ID when listing folders inside a folder', () => {
    const parentId = randomUUID();
    const result = listFoldersQuerySchema.safeParse({ parentId });

    expect(result.success).toBe(true);
    expect(result.data.parentId).toBe(parentId);
  });
});
