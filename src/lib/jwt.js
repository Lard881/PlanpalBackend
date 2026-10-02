import { supabaseAdmin } from './supabase.js';
import { logger } from './logger.js';

/**
 * Verify JWT token using Supabase
 * @param {string} token - JWT token
 * @returns {object} Decoded token payload
 * @throws {Error} If token is invalid
 */
export async function verifyToken(token) {
  try {
    const { data, error } = await supabaseAdmin.auth.getUser(token);
    
    if (error || !data.user) {
      throw new Error('Invalid token');
    }
    
    return {
      sub: data.user.id,
      user_id: data.user.id,
      email: data.user.email,
    };
  } catch (error) {
    logger.error('JWT verification error', error);
    throw error;
  }
}

/**
 * Generate a token (delegated to Supabase)
 * This is just a placeholder - actual token generation
 * happens through Supabase Auth API
 */
export function generateToken(_userId) {
  // This is handled by Supabase Auth
  // Included for compatibility with existing code
  return null;
}
