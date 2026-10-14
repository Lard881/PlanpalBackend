import express from 'express';
import { z } from 'zod';
import { userClient } from '../lib/supabase.js';
import { validate } from '../middleware/validate.js';

const router = express.Router();

const searchQuerySchema = z.object({
  q: z.string().min(2, 'Query must be at least 2 characters'),
  workspaceId: z.string().uuid().optional(),
  type: z.enum(['all', 'task', 'document', 'person']).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});

/**
 * GET /search?q=&workspaceId=&type=&limit=
 * Universal search across tasks, documents, and people
 */
router.get('/', validate(searchQuerySchema, 'query'), async (req, res, next) => {
  try {
    const { q, workspaceId, type = 'all', limit = 20 } = req.query;
    const supabase = userClient(req.jwt);

    // Call search_all function
    const { data, error } = await supabase.rpc('search_all', {
      p_query: q,
      p_workspace: workspaceId || null,
      p_limit: limit,
    });

    if (error) throw error;

    // Group results by type
    const tasks = [];
    const documents = [];
    const people = [];

    // search_all returns rows: { kind, id, workspace_id, title, subtitle, score, at }
    (data || []).forEach(result => {
      if (result.kind === 'task') tasks.push(result);
      else if (result.kind === 'document') documents.push(result);
      else if (result.kind === 'person') people.push(result);
    });

    // Deduplicate people by id
    const peopleMap = new Map();
    people.forEach(p => peopleMap.set(p.id, p));
    const uniquePeople = Array.from(peopleMap.values());

    // Filter by type if specified
    let results = [];
    if (type === 'all') {
      results = [...tasks, ...documents, ...uniquePeople];
    } else if (type === 'task') {
      results = tasks;
    } else if (type === 'document') {
      results = documents;
    } else if (type === 'person') {
      results = uniquePeople;
    }

    res.json({
      counts: {
        all: tasks.length + documents.length + uniquePeople.length,
        task: tasks.length,
        document: documents.length,
        person: uniquePeople.length,
      },
      results,
    });
  } catch (error) {
    next(error);
  }
});

export default router;
