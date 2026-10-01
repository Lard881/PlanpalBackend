import crypto from 'crypto';

/**
 * Generate a secure invite code
 * 8 characters from A-Z and 2-9 (no look-alike letters O, I, L, 0, 1)
 */
export function generateInviteCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const length = 8;
  
  let code = '';
  const bytes = crypto.randomBytes(length);
  
  for (let i = 0; i < length; i++) {
    code += chars[bytes[i] % chars.length];
  }
  
  return code;
}

/**
 * Normalize invite code (uppercase, remove spaces)
 */
export function normalizeInviteCode(code) {
  return code.toUpperCase().replace(/\s/g, '');
}
