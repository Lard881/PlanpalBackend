/**
 * Parse pagination parameters
 */
export function parsePaginationParams(query) {
  const limit = Math.min(parseInt(query.limit, 10) || 30, 100);
  const cursor = query.cursor || null;
  
  return { limit, cursor };
}

/**
 * Create pagination response
 */
export function createPaginationResponse(data, hasMore, lastCursor = null) {
  return {
    data,
    nextCursor: hasMore ? lastCursor : null,
  };
}

/**
 * Build cursor for timestamp-based pagination
 */
export function buildTimestampCursor(timestamp, id) {
  return Buffer.from(`${timestamp}:${id}`).toString('base64');
}

/**
 * Parse cursor
 */
export function parseCursor(cursor) {
  try {
    const decoded = Buffer.from(cursor, 'base64').toString('utf-8');
    const [timestamp, id] = decoded.split(':');
    return { timestamp, id };
  } catch {
    return null;
  }
}
