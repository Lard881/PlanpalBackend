import express from 'express';
import { z } from 'zod';
import { userClient, adminClient } from '../lib/supabase.js';
import { loadWorkspace } from '../middleware/workspace.js';
import { validate } from '../middleware/validate.js';
import { AppError, ErrorCodes } from '../lib/errors.js';
import { createNotifications } from '../lib/notifications.js';

const router = express.Router({ mergeParams: true });
// Item-level routes: the URL has no workspace id (RLS enforces access)
const itemRouter = express.Router();

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
  id: z.string().uuid(),
  body: z.string().max(4000).optional(),
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
 * List channels and DMs with unread counts and last message
 */
router.get('/channels', loadWorkspace, async (req, res, next) => {
  try {
    if (req.workspace.type === 'personal') {
      throw new AppError(
        ErrorCodes.CHAT_NOT_AVAILABLE_IN_PERSONAL,
        'Chat is not available in personal workspaces',
        400
      );
    }
    if (!['admin', 'member'].includes(req.workspace.role)) {
      throw new AppError(
        ErrorCodes.FORBIDDEN,
        'Only workspace members can create channels',
        403
      );
    }

    const supabase = userClient(req.jwt);

    // Get channels the user is a member of (RLS enforced)
    const { data: memberships, error: memberError } = await supabase
      .from('channel_members')
      .select('channel_id, last_read_at, muted')
      .eq('user_id', req.user.id);

    if (memberError) throw memberError;

    const channelIds = (memberships || []).map(m => m.channel_id);
    if (channelIds.length === 0) {
      return res.json({ channels: [] });
    }

    // Get channels
    const { data: channels, error: channelsError } = await supabase
      .from('channels')
      .select('*')
      .in('id', channelIds)
      .is('deleted_at', null)
      .eq('workspace_id', req.params.workspaceId);

    if (channelsError) throw channelsError;

    // R2.4: For DM channels, pre-fetch the other member's profile
    const dmChannelIds = (channels || [])
      .filter(c => c.kind === 'dm')
      .map(c => c.id);

    const otherUsersByChannel = {};
    if (dmChannelIds.length > 0) {
      const { data: dmMembers } = await supabase
        .from('channel_members')
        .select('channel_id, user_id, profiles!channel_members_user_id_fkey(id, full_name, avatar_url)')
        .in('channel_id', dmChannelIds)
        .neq('user_id', req.user.id);

      (dmMembers || []).forEach(m => {
        otherUsersByChannel[m.channel_id] = m.profiles;
      });
    }

    // For each channel, get last message and unread count
    const formatted = await Promise.all((channels || []).map(async (channel) => {
      const membership = memberships.find(m => m.channel_id === channel.id);
      const lastReadAt = membership?.last_read_at;

      // Get last message
      const { data: lastMessages } = await supabase
        .from('messages')
        .select('id, body, created_at, sender:profiles!messages_sender_id_fkey(full_name)')
        .eq('channel_id', channel.id)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(1);

      // Get unread count — messages from others after last_read_at
      const unreadQuery = supabase
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('channel_id', channel.id)
        .is('deleted_at', null)
        .neq('sender_id', req.user.id);

      if (lastReadAt) {
        unreadQuery.gt('created_at', lastReadAt);
      }

      const { count: unreadCount } = await unreadQuery;

      const lastMsg = lastMessages?.[0] || null;

      return {
        ...channel,
        lastMessage: lastMsg ? {
          body: lastMsg.body,
          createdAt: lastMsg.created_at,
          authorName: lastMsg.sender?.full_name,
        } : null,
        unreadCount: unreadCount || 0,
        // R2.4: include other user for DM channels so the app can display a name/avatar
        ...(channel.kind === 'dm' ? { otherUser: otherUsersByChannel[channel.id] || null } : {}),
      };
    }));

    res.json({ channels: formatted });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /workspaces/:workspaceId/channels
 * Create a channel
 */
router.post('/channels', loadWorkspace, validate(createChannelSchema), async (req, res, next) => {
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
    const requestedMembers = [...new Set(memberIds)]
      .filter(userId => userId !== req.user.id);
    if (requestedMembers.length > 0) {
      const { data: workspaceMembers, error: workspaceMemberError } = await supabase
        .from('workspace_members')
        .select('user_id')
        .eq('workspace_id', req.params.workspaceId)
        .is('deleted_at', null)
        .in('user_id', requestedMembers);
      if (workspaceMemberError) throw workspaceMemberError;
      const allowedIds = new Set((workspaceMembers || []).map(member => member.user_id));
      if (requestedMembers.some(userId => !allowedIds.has(userId))) {
        throw new AppError(
          ErrorCodes.FORBIDDEN,
          'Channel members must belong to this workspace',
          403
        );
      }
    }

    const { data: channel, error } = await adminClient
      .from('channels')
      .insert({
        workspace_id: req.params.workspaceId,
        kind: 'channel',
        name,
        description: description || '',
        is_private: isPrivate,
        created_by: req.user.id,
      })
      .select()
      .single();

    if (error) throw error;

    // Add creator as member (use admin client to bypass RLS for batch)
    const members = [{ channel_id: channel.id, user_id: req.user.id }];
    requestedMembers.forEach(userId => {
      members.push({ channel_id: channel.id, user_id: userId });
    });

    const { error: memberError } = await adminClient
      .from('channel_members')
      .insert(members);

    if (memberError) throw memberError;

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
    if (req.workspace.type === 'personal') {
      throw new AppError(
        ErrorCodes.CHAT_NOT_AVAILABLE_IN_PERSONAL,
        'Chat is not available in personal workspaces',
        400
      );
    }
    const { userId } = req.body;
    const supabase = userClient(req.jwt);

    const { data: channelId, error } = await supabase.rpc('get_or_create_dm', {
      p_workspace: req.params.workspaceId,
      p_other: userId,
    });

    if (error) throw error;

    const { data: channel, error: loadError } = await supabase
      .from('channels')
      .select('*')
      .eq('id', channelId)
      .single();

    if (loadError) throw loadError;

    // R2.4: include the other user's profile in the DM response
    const { data: otherMember } = await supabase
      .from('channel_members')
      .select('profiles!channel_members_user_id_fkey(id, full_name, avatar_url)')
      .eq('channel_id', channelId)
      .neq('user_id', req.user.id)
      .maybeSingle();

    res.json({ channel: { ...channel, otherUser: otherMember?.profiles || null } });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /channels/:channelId/members
 * Add member to channel
 */
itemRouter.post('/channels/:channelId/members', validate(addMemberSchema), async (req, res, next) => {
  try {
    const { userId } = req.body;
    const supabase = userClient(req.jwt);

    const { data: member, error } = await supabase
      .from('channel_members')
      .insert({ channel_id: req.params.channelId, user_id: userId })
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
itemRouter.delete('/channels/:channelId/members/:userId', async (req, res, next) => {
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
 * Get message history with cursor pagination
 * B1 fix: use 'messages' table and 'sender_id' column
 */
itemRouter.get('/channels/:channelId/messages', validate(messagesQuerySchema, 'query'), async (req, res, next) => {
  try {
    const { before, limit = 50 } = req.query;
    const supabase = userClient(req.jwt);

    let query = supabase
      .from('messages')
      .select(`
        id, body, file_id, created_at, updated_at, edited_at,
        sender:profiles!messages_sender_id_fkey(id, full_name, avatar_url),
        file:files!messages_file_id_fkey(id, name, mime_type, size_bytes)
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

    const hasMore = messages.length > parseInt(limit);
    const results = hasMore ? messages.slice(0, parseInt(limit)) : messages;

    res.json({ messages: results, hasMore });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /channels/:channelId/messages
 * Send a message (idempotent by client id)
 * B1 fix: use 'messages' table and 'sender_id' column
 */
itemRouter.post('/channels/:channelId/messages', validate(sendMessageSchema), async (req, res, next) => {
  try {
    const { id, body, fileId } = req.body;
    const supabase = userClient(req.jwt);

    // Idempotency check
    const { data: existing } = await supabase
      .from('messages')
      .select(`
        id, channel_id, body, file_id, created_at, updated_at, edited_at,
        sender:profiles!messages_sender_id_fkey(id, full_name, avatar_url),
        file:files!messages_file_id_fkey(id, name, mime_type, size_bytes)
      `)
      .eq('id', id)
      .maybeSingle();

    if (existing) {
      return res.json({ message: existing });
    }

    // Insert message — B1 fix: sender_id not author_id
    const { data: message, error } = await supabase
      .from('messages')
      .insert({
        id,
        channel_id: req.params.channelId,
        sender_id: req.user.id,
        body: body || '',
        file_id: fileId,
      })
      .select(`
        id, body, file_id, created_at, updated_at,
        sender:profiles!messages_sender_id_fkey(id, full_name, avatar_url),
        file:files!messages_file_id_fkey(id, name, mime_type, size_bytes)
      `)
      .single();

    if (error) throw error;

    // Get channel info for notifications
    const { data: channel } = await supabase
      .from('channels')
      .select('workspace_id, kind')
      .eq('id', req.params.channelId)
      .single();

    // Get other channel members (not muted)
    const { data: members } = await supabase
      .from('channel_members')
      .select('user_id, muted')
      .eq('channel_id', req.params.channelId)
      .neq('user_id', req.user.id);

    // B4/2C fix: use admin client with title/body columns via adminClient
    const notifications = (members || [])
      .filter(m => !m.muted)
      .map(m => ({
        user_id: m.user_id,
        type: 'chat_message',
        title: 'New message',
        body: body ? body.substring(0, 200) : 'Sent a file',
        entity_type: 'channel',
        entity_id: req.params.channelId,
        workspace_id: channel?.workspace_id,
        dedupe_key: `chat_message:${message.id}:${m.user_id}`,
      }));

    if (notifications.length > 0) {
      await createNotifications(notifications);
    }

    // Parse @mentions and create mention notifications
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
            title: 'You were mentioned',
            body: `Mentioned you in a message`,
            entity_type: 'channel',
            entity_id: req.params.channelId,
            workspace_id: channel?.workspace_id,
            dedupe_key: `mention:${message.id}:${mentionedUserId}`,
          });
        }
      }

      if (mentionNotifs.length > 0) {
        await createNotifications(mentionNotifs);
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
itemRouter.patch('/messages/:messageId', validate(z.object({ body: z.string().max(4000) })), async (req, res, next) => {
  try {
    const { body } = req.body;
    const supabase = userClient(req.jwt);

    // B1 fix: use 'messages' table and 'sender_id'
    const { data: message, error } = await supabase
      .from('messages')
      .update({ body, edited_at: new Date().toISOString() })
      .eq('id', req.params.messageId)
      .eq('sender_id', req.user.id)
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
 * Soft delete (own message or admin)
 */
itemRouter.delete('/messages/:messageId', async (req, res, next) => {
  try {
    const supabase = userClient(req.jwt);

    // Try as own message first
    const { error: ownError } = await supabase
      .from('messages')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', req.params.messageId)
      .eq('sender_id', req.user.id);

    if (ownError) {
      // Try as admin (adminClient bypasses RLS)
      const { error: adminError } = await adminClient
        .from('messages')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', req.params.messageId);
      if (adminError) throw adminError;
    }

    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

/**
 * POST /channels/:channelId/read
 * Mark channel as read
 */
itemRouter.post('/channels/:channelId/read', async (req, res, next) => {
  try {
    const supabase = userClient(req.jwt);

    const { error } = await supabase
      .from('channel_members')
      .update({ last_read_at: new Date().toISOString() })
      .eq('channel_id', req.params.channelId)
      .eq('user_id', req.user.id);

    if (error) throw error;

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

export { itemRouter as channelItemRouter };
export default router;
