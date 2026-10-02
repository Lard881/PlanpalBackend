import express from 'express';
import { z } from 'zod';
import { validateRequest } from '../middleware/validation.js';

const router = express.Router();

// Search query validation schema
const searchQuerySchema = z.object({
  query: z.string().min(2, 'Search query must be at least 2 characters').max(100),
  type: z.enum(['all', 'tasks', 'documents', 'people']).optional().default('all'),
  workspaceId: z.string().uuid().optional(), // If provided, search only in this workspace
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

/**
 * GET /api/search
 * Global search across tasks, documents, and people
 * Query params: query, type, workspaceId, limit, offset
 */
router.get(
  '/',
  validateRequest({ query: searchQuerySchema }),
  async (req, res) => {
    const { supabase, user } = req;
    const { query, type, workspaceId, limit, offset } = req.query;

    try {
      const searchTerm = `%${query}%`;
      const results = {
        query,
        type,
        workspaceId: workspaceId || null,
        tasks: { items: [], count: 0 },
        documents: { items: [], count: 0 },
        people: { items: [], count: 0 },
      };

      // Search tasks
      if (type === 'all' || type === 'tasks') {
        const tasksResult = await searchTasks(supabase, user.id, searchTerm, workspaceId, limit, offset);
        results.tasks = tasksResult;
      }

      // Search documents
      if (type === 'all' || type === 'documents') {
        const documentsResult = await searchDocuments(supabase, user.id, searchTerm, workspaceId, limit, offset);
        results.documents = documentsResult;
      }

      // Search people
      if (type === 'all' || type === 'people') {
        const peopleResult = await searchPeople(supabase, user.id, searchTerm, workspaceId, limit, offset);
        results.people = peopleResult;
      }

      // Calculate total count
      results.totalCount = results.tasks.count + results.documents.count + results.people.count;

      res.json(results);
    } catch (error) {
      req.log.error({ err: error, userId: user.id }, 'Search failed');
      res.status(500).json({ error: 'Search failed' });
    }
  }
);

/**
 * Search tasks
 * Searches in: title, description
 * Respects RLS (only tasks in user's workspaces)
 */
async function searchTasks(supabase, userId, searchTerm, workspaceId, limit, offset) {
  let query = supabase
    .from('tasks')
    .select(`
      id,
      title,
      description,
      status,
      priority,
      due_date,
      workspace_id,
      project_id,
      assigned_to,
      created_at,
      workspaces!inner(name)
    `, { count: 'exact' })
    .or(`title.ilike.${searchTerm},description.ilike.${searchTerm}`)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  // Filter by workspace if specified
  if (workspaceId) {
    query = query.eq('workspace_id', workspaceId);
  }

  const { data, count, error } = await query;

  if (error) {
    throw error;
  }

  // Calculate match percentage (simple scoring)
  const items = (data || []).map(task => ({
    id: task.id,
    type: 'task',
    title: task.title,
    description: task.description,
    status: task.status,
    priority: task.priority,
    dueDate: task.due_date,
    workspaceId: task.workspace_id,
    workspaceName: task.workspaces?.name,
    projectId: task.project_id,
    assignedTo: task.assigned_to,
    createdAt: task.created_at,
    matchScore: calculateMatchScore(searchTerm.replace(/%/g, ''), task.title, task.description),
  }));

  // Sort by match score
  items.sort((a, b) => b.matchScore - a.matchScore);

  return {
    items,
    count: count || 0,
  };
}

/**
 * Search documents
 * Searches in: title, content
 * Respects RLS (only documents in user's workspaces)
 */
async function searchDocuments(supabase, userId, searchTerm, workspaceId, limit, offset) {
  let query = supabase
    .from('documents')
    .select(`
      id,
      title,
      content,
      workspace_id,
      folder_id,
      created_by,
      created_at,
      updated_at,
      workspaces!inner(name)
    `, { count: 'exact' })
    .or(`title.ilike.${searchTerm},content.ilike.${searchTerm}`)
    .order('updated_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (workspaceId) {
    query = query.eq('workspace_id', workspaceId);
  }

  const { data, count, error } = await query;

  if (error) {
    throw error;
  }

  const items = (data || []).map(doc => ({
    id: doc.id,
    type: 'document',
    title: doc.title,
    content: doc.content?.substring(0, 200), // Truncate content for preview
    workspaceId: doc.workspace_id,
    workspaceName: doc.workspaces?.name,
    folderId: doc.folder_id,
    createdBy: doc.created_by,
    createdAt: doc.created_at,
    updatedAt: doc.updated_at,
    matchScore: calculateMatchScore(searchTerm.replace(/%/g, ''), doc.title, doc.content),
  }));

  items.sort((a, b) => b.matchScore - a.matchScore);

  return {
    items,
    count: count || 0,
  };
}

/**
 * Search people (workspace members)
 * Searches in: full_name, email
 * Returns unique people across user's workspaces (no duplicates)
 */
async function searchPeople(supabase, userId, searchTerm, workspaceId, limit, offset) {
  // Get workspace members with user profiles
  let query = supabase
    .from('workspace_members')
    .select(`
      workspace_id,
      user_id,
      role,
      workspaces!inner(name),
      profiles!inner(
        id,
        full_name,
        email,
        avatar_url
      )
    `, { count: 'exact' })
    .or(`profiles.full_name.ilike.${searchTerm},profiles.email.ilike.${searchTerm}`)
    .order('profiles(full_name)', { ascending: true });

  if (workspaceId) {
    query = query.eq('workspace_id', workspaceId);
  }

  const { data, error } = await query;

  if (error) {
    throw error;
  }

  // Deduplicate people by user_id
  const peopleMap = new Map();
  
  (data || []).forEach(member => {
    const userId = member.user_id;
    const profile = member.profiles;
    
    if (!peopleMap.has(userId)) {
      peopleMap.set(userId, {
        id: profile.id,
        type: 'person',
        fullName: profile.full_name,
        email: profile.email,
        avatarUrl: profile.avatar_url,
        workspaces: [],
        matchScore: calculateMatchScore(
          searchTerm.replace(/%/g, ''),
          profile.full_name,
          profile.email
        ),
      });
    }
    
    // Add workspace to this person's workspaces list
    peopleMap.get(userId).workspaces.push({
      id: member.workspace_id,
      name: member.workspaces.name,
      role: member.role,
    });
  });

  const items = Array.from(peopleMap.values());
  
  // Sort by match score
  items.sort((a, b) => b.matchScore - a.matchScore);

  // Apply pagination after deduplication
  const paginatedItems = items.slice(offset, offset + limit);
  const count = items.length;

  return {
    items: paginatedItems,
    count,
  };
}

/**
 * Calculate simple match score (0-100)
 * Higher score = better match
 */
function calculateMatchScore(searchTerm, ...fields) {
  const term = searchTerm.toLowerCase();
  let score = 0;

  fields.forEach((field, index) => {
    if (!field) return;
    
    const text = field.toLowerCase();
    
    // Exact match in any field = high score
    if (text === term) {
      score += 100;
      return;
    }
    
    // Starts with search term = good score
    if (text.startsWith(term)) {
      score += 80;
      return;
    }
    
    // Contains search term = medium score
    if (text.includes(term)) {
      score += 50;
      return;
    }
    
    // Word boundary match = low score
    const words = text.split(/\s+/);
    if (words.some(word => word.startsWith(term))) {
      score += 30;
      return;
    }
  });

  return score;
}

export default router;
