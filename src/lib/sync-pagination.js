const collectionOrder = [
  'tasks',
  'subtasks',
  'taskComments',
  'taskAttachments',
  'labels',
  'events',
  'eventAttendees',
  'channels',
  'documents',
  'folders',
  'members',
  'files',
];

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;

function rowKeyFields(collection) {
  if (collection === 'taskAttachments') return ['task_id', 'file_id'];
  if (collection === 'eventAttendees') return ['event_id', 'user_id'];
  if (collection === 'members') return ['workspace_id', 'user_id'];
  return ['id'];
}

function timestampMicros(value) {
  const match = /^(.+?T\d{2}:\d{2}:\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) return BigInt(Date.parse(value)) * 1000n;

  const wholeSecond = Date.parse(`${match[1]}${match[3]}`);
  const fractionalMicros = (match[2] || '').padEnd(6, '0').slice(0, 6);
  return BigInt(wholeSecond) * 1000n + BigInt(fractionalMicros || '0');
}

function rowKey(collection, row) {
  return rowKeyFields(collection).map(field => row[field]).join(':');
}

function compareText(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function compareEntries(left, right) {
  const timeDifference = timestampMicros(left.row.updated_at) - timestampMicros(right.row.updated_at);
  if (timeDifference !== 0n) return timeDifference < 0n ? -1 : 1;

  const collectionDifference = left.collectionIndex - right.collectionIndex;
  if (collectionDifference !== 0) return collectionDifference;
  return compareText(left.key, right.key);
}

export function decodeSyncCursor(cursor, workspaceId) {
  if (!cursor) return null;

  try {
    const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (
      decoded.version !== 1
      || decoded.workspaceId !== workspaceId
      || !collectionOrder.includes(decoded.collection)
      || typeof decoded.key !== 'string'
      || typeof decoded.updatedAt !== 'string'
      || !timestampPattern.test(decoded.updatedAt)
    ) {
      return null;
    }

    timestampMicros(decoded.updatedAt);
    const keyParts = decoded.key.split(':');
    if (
      keyParts.length !== rowKeyFields(decoded.collection).length
      || keyParts.some(part => !uuidPattern.test(part))
    ) {
      return null;
    }
    return decoded;
  } catch {
    return null;
  }
}

export function prepareSyncQuery(query, collection, since, cursor, maxRows) {
  let result = query;
  const keyFields = rowKeyFields(collection);

  if (!cursor) {
    result = result.gte('updated_at', since);
  } else {
    const collectionIndex = collectionOrder.indexOf(collection);
    const cursorIndex = collectionOrder.indexOf(cursor.collection);
    if (collectionIndex < cursorIndex) {
      result = result.gt('updated_at', cursor.updatedAt);
    } else if (collectionIndex > cursorIndex) {
      result = result.gte('updated_at', cursor.updatedAt);
    } else {
      const keyParts = cursor.key.split(':');
      const tieBreakers = keyFields.map((field, index) => {
        const comparisons = keyFields.slice(0, index).map((previousField, previousIndex) =>
          `${previousField}.eq.${keyParts[previousIndex]}`,
        );
        comparisons.push(`${field}.gt.${keyParts[index]}`);
        return `and(updated_at.eq.${cursor.updatedAt},${comparisons.join(',')})`;
      });
      result = result
        .gte('updated_at', cursor.updatedAt)
        .or([`updated_at.gt.${cursor.updatedAt}`, ...tieBreakers].join(','));
    }
  }

  for (const field of ['updated_at', ...keyFields]) {
    result = result.order(field, { ascending: true });
  }
  return result.limit(maxRows);
}

export function paginateSyncRows(rowsByCollection, maxRows, cursor, workspaceId, couldHaveMore = false) {
  const cursorIndex = cursor ? collectionOrder.indexOf(cursor.collection) : -1;
  const entries = collectionOrder.flatMap((collection, collectionIndex) =>
    (rowsByCollection[collection] || []).map(row => ({
      collection,
      collectionIndex,
      key: rowKey(collection, row),
      row,
    })),
  ).filter(entry => {
    if (!cursor) return true;
    const timeDifference = timestampMicros(entry.row.updated_at) - timestampMicros(cursor.updatedAt);
    if (timeDifference !== 0n) return timeDifference > 0n;
    if (entry.collectionIndex !== cursorIndex) return entry.collectionIndex > cursorIndex;
    return compareText(entry.key, cursor.key) > 0;
  }).sort(compareEntries);

  const pageEntries = entries.slice(0, maxRows);
  const hasMore = entries.length > maxRows || couldHaveMore;
  const pageRows = Object.fromEntries(
    collectionOrder.map(collection => [collection, []]),
  );
  for (const entry of pageEntries) pageRows[entry.collection].push(entry.row);

  const lastEntry = pageEntries.at(-1);
  const nextCursor = hasMore && lastEntry
    ? Buffer.from(JSON.stringify({
      version: 1,
      workspaceId,
      updatedAt: lastEntry.row.updated_at,
      collection: lastEntry.collection,
      key: lastEntry.key,
    })).toString('base64url')
    : null;

  return {
    rows: pageRows,
    hasMore,
    nextCursor,
    lastUpdatedAt: lastEntry?.row.updated_at || null,
  };
}
