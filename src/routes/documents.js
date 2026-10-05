import express from 'express';
import { z } from 'zod';
import { userClient } from '../lib/supabase.js';
import { loadWorkspace } from '../middleware/workspace.js';
import { validate } from '../middleware/validate.js';
import { AppError, ErrorCodes } from '../lib/errors.js';

const router = express.Router({ mergeParams: true });

const listDocsQuerySchema = z.object({
  folderId: z.string().uuid().optional(),
  kind: z.enum(['file', 'written']).optional(),
  recent: z.coerce.boolean().optional(),
});

const createFolderSchema = z.object({
  name: z.string().min(1).max(200),
  parentId: z.string().uuid().optional().nullable(),
});

const updateFolderSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  parentId: z.string().uuid().optional().nullable(),
});

const createDocumentSchema = z.object({
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

/**
 * GET /workspaces/:workspaceId/folders?parentId=
 * List folders
 */
router.get('/folders', loadWorkspace, validate(listDocsQuerySchema, 'query'), async (req, res, next) => {
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
    const { name, parentId } = req.body;
    const supabase = userClient(req.jwt);

    const { data: folder, error } = await supabase
      .from('folders')
      .insert({
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
router.patch('/folders/:folderId', validate(updateFolderSchema), async (req, res, next) => {
  try {
    const supabase = userClient(req.jwt);

    const { data: folder, error } = await supabase
      .from('folders')
      .update(req.body)
      .eq('id', req.params.folderId)
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
router.delete('/folders/:folderId', async (req, res, next) => {
  try {
    const supabase = userClient(req.jwt);

    // Check if empty
    const { count } = await supabase
      .from('documents')
      .select('*', { count: 'exact', head: true })
      .eq('folder_id', req.params.folderId)
      .is('deleted_at', null);

    if (count > 0) {
      throw new AppError(
        ErrorCodes.FOLDER_NOT_EMPTY,
        'Folder must be empty before deletion',
        409
      );
    }

    const { error } = await supabase
      .from('folders')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', req.params.folderId);

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
      .select('id, kind, title, folder_id, file_id, created_at, updated_at')
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
    const { kind, title, fileId, content, contentText, folderId } = req.body;
    const supabase = userClient(req.jwt);

    const docData = {
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
router.get('/documents/:documentId', async (req, res, next) => {
  try {
    const supabase = userClient(req.jwt);

    const { data: document, error } = await supabase
      .from('documents')
      .select('*')
      .eq('id', req.params.documentId)
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
router.patch('/documents/:documentId', validate(updateDocumentSchema), async (req, res, next) => {
  try {
    const supabase = userClient(req.jwt);

    const { data: document, error } = await supabase
      .from('documents')
      .update(req.body)
      .eq('id', req.params.documentId)
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
router.delete('/documents/:documentId', async (req, res, next) => {
  try {
    const supabase = userClient(req.jwt);

    const { error } = await supabase
      .from('documents')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', req.params.documentId);

    if (error) throw error;

    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

export default router;
