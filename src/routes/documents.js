import express from 'express';
import { z } from 'zod';
import { userClient } from '../lib/supabase.js';
import { loadWorkspace } from '../middleware/workspace.js';
import { validate } from '../middleware/validate.js';
import { AppError, ErrorCodes } from '../lib/errors.js';

const router = express.Router({ mergeParams: true });
// Item-level routes: the URL has no workspace id (RLS enforces access)
const itemRouter = express.Router();

const listDocsQuerySchema = z.object({
  folderId: z.string().uuid().optional(),
  kind: z.enum(['file', 'written']).optional(),
  recent: z.coerce.boolean().optional(),
});

export const listFoldersQuerySchema = z.object({
  parentId: z.string().uuid().optional(),
});

export const createFolderSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1).max(80),
  parentId: z.string().uuid().optional().nullable(),
});

export const updateFolderSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  parentId: z.string().uuid().optional().nullable(),
});

const createDocumentSchema = z.object({
  id: z.string().uuid().optional(),
  kind: z.enum(['file', 'written']),
  title: z.string().min(1).max(200),
  fileId: z.string().uuid().optional(),
  content: z.any().optional(), // Quill delta JSON
  contentText: z.string().optional(),
  folderId: z.string().uuid().optional().nullable(),
}).refine(data => {
  if (data.kind === 'file') return !!data.fileId;
  if (data.kind === 'written') return data.content !== undefined;
  return false;
}, { message: 'File documents need fileId, written documents need content' });

const updateDocumentSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  folderId: z.string().uuid().optional().nullable(),
  content: z.any().optional(),
  contentText: z.string().optional(),
});

export async function softDeleteDocument(supabase, documentId) {
  const { data: deletedDocument, error } = await supabase
    .from('documents')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', documentId)
    .is('deleted_at', null)
    .select('id')
    .maybeSingle();

  if (error) throw error;
  if (deletedDocument) return;

  const { data: existingDocument, error: lookupError } = await supabase
    .from('documents')
    .select('id, deleted_at')
    .eq('id', documentId)
    .maybeSingle();

  if (lookupError) throw lookupError;
  if (!existingDocument) {
    throw new AppError(ErrorCodes.NOT_FOUND, 'Document not found', 404);
  }
  if (existingDocument.deleted_at === null) {
    throw new AppError(
      ErrorCodes.FORBIDDEN,
      'You do not have permission to delete this document',
      403
    );
  }
}

/**
 * GET /workspaces/:workspaceId/folders?parentId=
 * List folders
 */
router.get('/folders', loadWorkspace, validate(listFoldersQuerySchema, 'query'), async (req, res, next) => {
  try {
    const { parentId } = req.query;
    const supabase = userClient(req.jwt);

    let query = supabase
      .from('folders')
      .select('*')
      .eq('workspace_id', req.params.workspaceId)
      .is('deleted_at', null);

    if (parentId) {
      query = query.eq('parent_id', parentId);
    } else {
      query = query.is('parent_id', null);
    }

    const { data: folders, error } = await query.order('name');
    if (error) throw error;

    // Get file counts for each folder
    for (const folder of folders || []) {
      const { count } = await supabase
        .from('documents')
        .select('*', { count: 'exact', head: true })
        .eq('folder_id', folder.id)
        .is('deleted_at', null);

      folder.fileCount = count || 0;
    }

    res.json({ folders: folders || [] });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /workspaces/:workspaceId/folders
 * Create folder
 */
router.post('/folders', loadWorkspace, validate(createFolderSchema), async (req, res, next) => {
  try {
    const { id, name, parentId } = req.body;
    const supabase = userClient(req.jwt);

    const { data: folder, error } = await supabase
      .from('folders')
      .insert({
        ...(id ? { id } : {}),
        workspace_id: req.params.workspaceId,
        name,
        parent_id: parentId,
        created_by: req.user.id,
      })
      .select()
      .single();

    if (error) throw error;

    res.status(201).json({ folder });
  } catch (error) {
    next(error);
  }
});

/**
 * PATCH /folders/:folderId
 * Update folder
 */
itemRouter.patch('/folders/:folderId', validate(updateFolderSchema), async (req, res, next) => {
  try {
    const supabase = userClient(req.jwt);
    const update = {
      ...(req.body.name !== undefined ? { name: req.body.name } : {}),
      ...(req.body.parentId !== undefined ? { parent_id: req.body.parentId } : {}),
    };

    const { data: folder, error } = await supabase
      .from('folders')
      .update(update)
      .eq('id', req.params.folderId)
      .is('deleted_at', null)
      .select()
      .single();

    if (error) throw error;

    res.json({ folder });
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /folders/:folderId
 * Delete folder (only if empty)
 */
itemRouter.delete('/folders/:folderId', async (req, res, next) => {
  try {
    const supabase = userClient(req.jwt);

    // Check if empty
    const { count } = await supabase
      .from('documents')
      .select('*', { count: 'exact', head: true })
      .eq('folder_id', req.params.folderId)
      .is('deleted_at', null);

    const { count: childFolderCount, error: childFolderError } = await supabase
      .from('folders')
      .select('*', { count: 'exact', head: true })
      .eq('parent_id', req.params.folderId)
      .is('deleted_at', null);

    if (childFolderError) throw childFolderError;

    if (count > 0 || childFolderCount > 0) {
      throw new AppError(
        ErrorCodes.FOLDER_NOT_EMPTY,
        'Folder must be empty before deletion',
        409
      );
    }

    const { error } = await supabase
      .from('folders')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', req.params.folderId)
      .is('deleted_at', null);

    if (error) throw error;

    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

/**
 * GET /workspaces/:workspaceId/documents
 * List documents
 */
router.get('/documents', loadWorkspace, validate(listDocsQuerySchema, 'query'), async (req, res, next) => {
  try {
    const { folderId, kind, recent } = req.query;
    const supabase = userClient(req.jwt);

    let query = supabase
      .from('documents')
      .select(
        'id, workspace_id, created_by, kind, title, folder_id, file_id, created_at, updated_at, file:files!documents_file_id_fkey(id, name, mime_type, size_bytes, storage_path)',
      )
      .eq('workspace_id', req.params.workspaceId)
      .is('deleted_at', null);

    if (folderId) {
      query = query.eq('folder_id', folderId);
    }

    if (kind) {
      query = query.eq('kind', kind);
    }

    if (recent) {
      query = query.order('updated_at', { ascending: false }).limit(12);
    } else {
      query = query.order('title');
    }

    const { data: documents, error } = await query;
    if (error) throw error;

    res.json({ documents: documents || [] });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /workspaces/:workspaceId/documents
 * Create document
 */
router.post('/documents', loadWorkspace, validate(createDocumentSchema), async (req, res, next) => {
  try {
    const { id, kind, title, fileId, content, contentText, folderId } = req.body;
    const supabase = userClient(req.jwt);

    if (id) {
      const { data: existing, error: existingError } = await supabase
        .from('documents')
        .select('*')
        .eq('id', id)
        .maybeSingle();
      if (existingError) throw existingError;
      if (existing) {
        if (existing.workspace_id !== req.params.workspaceId) {
          throw new AppError(ErrorCodes.FORBIDDEN, 'Document is outside this workspace', 403);
        }
        return res.json({ document: existing });
      }
    }

    const docData = {
      ...(id ? { id } : {}),
      workspace_id: req.params.workspaceId,
      kind,
      title,
      folder_id: folderId,
      created_by: req.user.id,
    };

    if (kind === 'file') {
      docData.file_id = fileId;
    } else {
      docData.content = content;
      docData.content_text = contentText;
    }

    const { data: document, error } = await supabase
      .from('documents')
      .insert(docData)
      .select()
      .single();

    if (error) throw error;

    res.status(201).json({ document });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /documents/:documentId
 * Get full document
 */
itemRouter.get('/documents/:documentId', async (req, res, next) => {
  try {
    const supabase = userClient(req.jwt);

    const { data: document, error } = await supabase
      .from('documents')
      .select('*, file:files!documents_file_id_fkey(id, name, mime_type, size_bytes, storage_path)')
      .eq('id', req.params.documentId)
      .is('deleted_at', null)
      .single();

    if (error) throw error;

    res.json({ document });
  } catch (error) {
    next(error);
  }
});

/**
 * PATCH /documents/:documentId
 * Update document
 */
itemRouter.patch('/documents/:documentId', validate(updateDocumentSchema), async (req, res, next) => {
  try {
    const supabase = userClient(req.jwt);
    const update = {
      ...(req.body.title !== undefined ? { title: req.body.title } : {}),
      ...(req.body.folderId !== undefined ? { folder_id: req.body.folderId } : {}),
      ...(req.body.content !== undefined ? { content: req.body.content } : {}),
      ...(req.body.contentText !== undefined ? { content_text: req.body.contentText } : {}),
    };

    const { data: document, error } = await supabase
      .from('documents')
      .update(update)
      .eq('id', req.params.documentId)
      .is('deleted_at', null)
      .select()
      .single();

    if (error) throw error;

    res.json({ document });
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /documents/:documentId
 * Soft delete document
 */
itemRouter.delete('/documents/:documentId', async (req, res, next) => {
  try {
    const supabase = userClient(req.jwt);
    await softDeleteDocument(supabase, req.params.documentId);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

export { itemRouter as documentItemRouter };
export default router;
