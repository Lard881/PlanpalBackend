import { describe, expect, it } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import {
  createFolderSchema,
  listFoldersQuerySchema,
  softDeleteDocument,
} from '../src/routes/documents.js';

function createDeleteClient(updatedDocument, existingDocument) {
  const updateQuery = {
    eq() { return this; },
    is() { return this; },
    select() { return this; },
    async maybeSingle() {
      return { data: updatedDocument, error: null };
    },
  };
  const lookupQuery = {
    eq() { return this; },
    async maybeSingle() {
      return { data: existingDocument, error: null };
    },
  };

  return {
    from(table) {
      expect(table).toBe('documents');
      return {
        update() { return updateQuery; },
        select() { return lookupQuery; },
      };
    },
  };
}

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

describe('Document soft deletion', () => {
  it('accepts a successful update', async () => {
    const client = createDeleteClient({ id: 'document-id' }, null);

    await expect(softDeleteDocument(client, 'document-id')).resolves.toBeUndefined();
  });

  it('treats an already deleted document as success', async () => {
    const client = createDeleteClient(null, {
      id: 'document-id',
      deleted_at: '2026-01-01T12:00:00.000Z',
    });

    await expect(softDeleteDocument(client, 'document-id')).resolves.toBeUndefined();
  });

  it('rejects an update blocked by row-level permissions', async () => {
    const client = createDeleteClient(null, {
      id: 'document-id',
      deleted_at: null,
    });

    await expect(softDeleteDocument(client, 'document-id')).rejects.toMatchObject({
      code: 'FORBIDDEN',
      statusCode: 403,
    });
  });

  it('returns not found when the document does not exist', async () => {
    const client = createDeleteClient(null, null);

    await expect(softDeleteDocument(client, 'document-id')).rejects.toMatchObject({
      code: 'NOT_FOUND',
      statusCode: 404,
    });
  });
});
