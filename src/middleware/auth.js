import { adminClient } from '../lib/supabase.js';
import { AppError, ErrorCodes } from '../lib/errors.js';

/**
 * Authentication middleware
 * Verifies JWT and attaches user to request
 */
export async function authenticate(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new AppError(
        ErrorCodes.AUTH_REQUIRED,
        'Authentication required',
        401
      );
    }
    
    const token = authHeader.substring(7);
    
    // Verify token with Supabase
    const { data, error } = await adminClient.auth.getUser(token);
    
    if (error || !data.user) {
      throw new AppError(
        ErrorCodes.AUTH_EXPIRED,
        'Token expired or invalid',
        401
      );
    }
    
    // Attach user and JWT to request
    req.user = {
      id: data.user.id,
      email: data.user.email,
    };
    req.jwt = token;
    
    next();
  } catch (error) {
    next(error);
  }
}
