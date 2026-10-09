import express from 'express';
import { z } from 'zod';
import { userClient } from '../lib/supabase.js';
import { loadWorkspace } from '../middleware/workspace.js';
import { validate } from '../middleware/validate.js';
import { AppError, ErrorCodes } from '../lib/errors.js';

const router = express.Router({ mergeParams: true });

const createChannelSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  isPrivate: z.boolean().optional(),
  memberIds: z.array(z.string().uuid()).optional(),
});

const createDmSchema = z.object({
  userId: z.string().uuid(),
});

const addMemberSchema = z.object({
  userId: z.string().uuid(),
});

const sendMessageSchema = z.object({
  id: z.string().uuid(), // Client-generated for idempotency
  body: z.string().max(5000).optional(),
  fileId: z.string().uuid().optional(),
}).refine(data => data.body || data.fileId, {
  message: 'Message must have body or fileId',
});

const messagesQuerySchema = z.object({
  before: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

/**
 * GET /workspaces/:workspaceId/channels
 * List channels and DMs
 */
router.get('/', loadWorkspace, async (req, res, next) => {
  try {
    // Block for personal workspaces
    if (req.workspace.type === 'personal') {
      throw new AppError(
        ErrorCodes.CHAT_NOT_AVAILABLE_IN_PERSONAL,
        'Chat is not available in personal workspaces',
        400
      );
    }

    const supabase = userClient(req.jwt);

    // Get channels the user can see (RLS handles permissions)
    const { data: channels, error } = await supabase
      .from('channels')
      .select(`
        *,
        channel_members!inner(user_id, last_read_at),
        messages:channel_messages(id, body, created_at, author_id, profiles(full_name))
      `)
      .eq('workspace_id', req.params.workspaceId)
      .eq('channel_members.user_id', req.user.id)
      .is('deleted_at', null)
      .order('created_at', { foreignTable: 'messages', ascending: false });

    if (error) throw error;

    // Calculate unread counts and get last message
    const formatted = (channels || []).map(channel => {
      const lastMessage = channel.messages?.[0] || null;
      const lastReadAt = channel.channel_members.find(m => m.user_id === req.user.id)?.last_read_at;
      
      // Count messages after last_read_at
      const unreadCount = channel.messages?.filter(m => {
        return !lastReadAt || new Date(m.created_at) > new Date(lastReadAt);
      }).length || 0;

      return {
        ...channel,
        lastMessage: lastMessage ? {
          body: lastMessage.body,
          createdAt: lastMessage.created_at,
          authorName: lastMessage.profiles?.full_name,
        } : null,
        unreadCount,
        channel_members: undefined, // Remove internal data
        messages: undefined,
      };
    });

    res.json({ channels: formatted });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /workspaces/:workspaceId/channels
 * Create a channel
 */
router.post('/', loadWorkspace, validate(createChannelSchema), async (req, res, next) => {
  try {
    if (req.workspace.type === 'personal') {
      throw new AppError(
        ErrorCodes.CHAT_NOT_AVAILABLE_IN_PERSONAL,
        'Chat is not available in personal workspaces',
        400
      );
    }

    const { name, description, isPrivate = false, memberIds = [] } = req.body;
    const supabase = userClient(req.jwt);

    const { data: channel, error } = await supabase
      .from('channels')
      .insert({
        workspace_id: req.params.workspaceId,
        name,
        description,
        is_private: isPrivate,
        is_dm: false,
        created_by: req.user.id,
      })
      .select()
      .single();

    if (error) throw error;

    // Add creator as member
    const members = [{ channel_id: channel.id, user_id: req.user.id }];

    // Add additional members
    memberIds.forEach(userId => {
      if (userId !== req.user.id) {
        members.push({ channel_id: channel.id, user_id: userId });
      }
    });

    await supabase.from('channel_members').insert(members);

    res.status(201).json({ channel });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /workspaces/:workspaceId/dms
 * Get or create DM channel
 */
router.post('/dms', loadWorkspace, validate(createDmSchema), async (req, res, next) => {
  try {
    const { userId } = req.body;
    const supabase = userClient(req.jwt);

    const { data: channel, error } = await supabase.rpc('get_or_create_dm', {
      p_workspace_id: req.params.workspaceId,
      p_other_user_id: userId,
    });

    if (error) throw error;

    res.json({ channel });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /channels/:channelId/members
 * Add member to channel
 */
router.post('/:channelId/members', validate(addMemberSchema), async (req, res, next) => {
  try {
    const { userId } = req.body;
    const supabase = userClient(req.jwt);

    const { data: member, error } = await supabase
      .from('channel_members')
      .insert({
        channel_id: req.params.channelId,
        user_id: userId,
      })
      .select()
      .single();

    if (error) throw error;

    res.status(201).json({ member });
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /channels/:channelId/members/:userId
 * Remove member or leave channel
 */
router.delete('/:channelId/members/:userId', async (req, res, next) => {
  try {
    const supabase = userClient(req.jwt);

    const { error } = await supabase
      .from('channel_members')
      .delete()
      .eq('channel_id', req.params.channelId)
      .eq('user_id', req.params.userId);

    if (error) throw error;

    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

/**
 * GET /channels/:channelId/messages
 * Get message history
 */
router.get('/:channelId/messages', validate(messagesQuerySchema, 'query'), async (req, res, next) => {
  try {
    const { before, limit = 50 } = req.query;
    const supabase = userClient(req.jwt);

    let query = supabase
      .from('channel_messages')
      .select(`
        id, body, file_id, created_at, updated_at,
        author:profiles!author_id(id, full_name, avatar_url)
      `)
      .eq('channel_id', req.params.channelId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(parseInt(limit) + 1);

    if (before) {
      query = query.lt('created_at', before);
    }

    const { data: messages, error } = await query;
    if (error) throw error;

    const hasMore = messages.length > limit;
    const results = hasMore ? messages.slice(0, limit) : messages;

    res.json({ messages: results, hasMore });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /channels/:channelId/messages
 * Send a message
 */
router.post('/:channelId/messages', validate(sendMessageSchema), async (req, res, next) => {
  try {
    const { id, body, fileId } = req.body;
    const supabase = userClient(req.jwt);

    // Check if message with this ID already exists (idempotency)
    const { data: existing } = await supabase
      .from('channel_messages')
      .select('id')
      .eq('id', id)
      .single();

    if (existing) {
      // Already sent, return existing
      return res.json({ message: existing });
    }

    // Insert message
    const { data: message, error } = await supabase
      .from('channel_messages')
      .insert({
        id,
        channel_id: req.params.channelId,
        author_id: req.user.id,
        body,
        file_id: fileId,
      })
      .select()
      .single();

    if (error) throw error;

    // Get channel info for notifications
    const { data: channel } = await supabase
      .from('channels')
      .select('workspace_id')
      .eq('id', req.params.channelId)
      .single();

    // Get other channel members
    const { data: members } = await supabase
      .from('channel_members')
      .select('user_id')
      .eq('channel_id', req.params.channelId)
      .neq('user_id', req.user.id);

    // Create chat_message notifications
    const notifications = (members || []).map(m => ({
      user_id: m.user_id,
      type: 'chat_message',
      entity_type: 'channel',
      entity_id: req.params.channelId,
      workspace_id: channel.workspace_id,
      text: `${req.user.email} sent a message`,
      dedupe_key: `chat_message:${message.id}:${m.user_id}`,
    }));

    if (notifications.length > 0) {
      await supabase.from('notifications').insert(notifications);
    }

    // Parse @mentions
    if (body) {
      const mentionRegex = /@\[([^\]]+)\]\(user:([a-f0-9-]+)\)/g;
      let match;
      const mentionNotifs = [];

      while ((match = mentionRegex.exec(body)) !== null) {
        const mentionedUserId = match[2];
        if (mentionedUserId !== req.user.id) {
          mentionNotifs.push({
            user_id: mentionedUserId,
            type: 'mention',
            entity_type: 'channel',
            entity_id: req.params.channelId,
            workspace_id: channel.workspace_id,
            text: `${req.user.email} mentioned you`,
            dedupe_key: `mention:${message.id}:${mentionedUserId}`,
          });
        }
      }

      if (mentionNotifs.length > 0) {
        await supabase.from('notifications').insert(mentionNotifs);
      }
    }

    res.status(201).json({ message });
  } catch (error) {
    next(error);
  }
});

/**
 * PATCH /messages/:messageId
 * Edit own message
 */
router.patch('/messages/:messageId', validate(z.object({ body: z.string().max(5000) })), async (req, res, next) => {
  try {
    const { body } = req.body;
    const supabase = userClient(req.jwt);

    const { data: message, error } = await supabase
      .from('channel_messages')
      .update({ body })
      .eq('id', req.params.messageId)
      .eq('author_id', req.user.id)
      .select()
      .single();

    if (error) throw error;

    res.json({ message });
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /messages/:messageId
 * Delete message (own or admin)
 */
router.delete('/messages/:messageId', async (req, res, next) => {
  try {
    const supabase = userClient(req.jwt);

    const { error } = await supabase
      .from('channel_messages')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', req.params.messageId);

    if (error) throw error;

    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

/**
 * POST /channels/:channelId/read
 * Mark channel as read
 */
router.post('/:channelId/read', async (req, res, next) => {
  try {
    const supabase = userClient(req.jwt);

    const { error } = await supabase
      .from('channel_members')
      .update({ last_read_at: new Date().toISOString() })
      .eq('channel_id', req.params.channelId)
      .eq('user_id', req.user.id);

    if (error) throw error;

    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

export default router;
