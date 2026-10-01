import { AppError, ErrorCodes, createErrorResponse } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { ZodError } from 'zod';

/**
 * Central error handler
 */
export function errorHandler(err, req, res, next) {
  const requestId = req.id || 'unknown';
  
  // Log error
  logger.error({
    err,
    requestId,
    userId: req.user?.id,
    path: req.path,
  });
  
  // Handle known AppError
  if (err instanceof AppError) {
    return res.status(err.statusCode).json(
      createErrorResponse(err.code, err.message, requestId, err.details)
    );
  }
  
  // Handle Zod validation errors
  if (err instanceof ZodError) {
    const details = err.errors.map(e => ({
      field: e.path.join('.'),
      message: e.message,
    }));
    
    return res.status(400).json(
      createErrorResponse(
        ErrorCodes.VALIDATION_FAILED,
        'Validation failed',
        requestId,
        { fields: details }
      )
    );
  }
  
  // Handle Supabase/Postgres errors
  if (err.code) {
    const { statusCode, errorCode, message } = translateDatabaseError(err);
    return res.status(statusCode).json(
      createErrorResponse(errorCode, message, requestId)
    );
  }
  
  // Handle Payload too large
  if (err.type === 'entity.too.large') {
    return res.status(413).json(
      createErrorResponse(
        ErrorCodes.PAYLOAD_TOO_LARGE,
        'Request payload too large',
        requestId
      )
    );
  }
  
  // Unknown error - don't leak details
  return res.status(500).json(
    createErrorResponse(
      ErrorCodes.INTERNAL_ERROR,
      'An internal error occurred',
      requestId
    )
  );
}

/**
 * Translate database errors to application errors
 */
function translateDatabaseError(err) {
  // PostgreSQL error codes
  if (err.code === '42501') {
    return {
      statusCode: 403,
      errorCode: ErrorCodes.FORBIDDEN,
      message: 'Permission denied',
    };
  }
  
  if (err.code === '23505') {
    return {
      statusCode: 409,
      errorCode: ErrorCodes.CONFLICT,
      message: 'Resource already exists',
    };
  }
  
  // PostgREST error codes
  if (err.code === 'PGRST116') {
    return {
      statusCode: 404,
      errorCode: ErrorCodes.NOT_FOUND,
      message: 'Resource not found',
    };
  }
  
  // Custom function errors (raise exception with errcode P0001 or P0002)
  if (err.code === 'P0001' || err.code === 'P0002') {
    if (err.message?.includes('last admin')) {
      return {
        statusCode: 403,
        errorCode: ErrorCodes.LAST_ADMIN,
        message: 'Cannot remove or demote the last admin',
      };
    }
    
    if (err.message?.includes('invalid code')) {
      return {
        statusCode: 400,
        errorCode: ErrorCodes.INVALID_CODE,
        message: 'Invalid invite code',
      };
    }
    
    if (err.message?.includes('expired')) {
      return {
        statusCode: 400,
        errorCode: ErrorCodes.CODE_EXPIRED,
        message: 'Invite code has expired',
      };
    }
    
    if (err.message?.includes('revoked')) {
      return {
        statusCode: 400,
        errorCode: ErrorCodes.CODE_REVOKED,
        message: 'Invite code has been revoked',
      };
    }
    
    if (err.message?.includes('used up')) {
      return {
        statusCode: 400,
        errorCode: ErrorCodes.CODE_USED_UP,
        message: 'Invite code has reached maximum uses',
      };
    }
    
    if (err.message?.includes('already member')) {
      return {
        statusCode: 400,
        errorCode: ErrorCodes.ALREADY_MEMBER,
        message: 'Already a member of this workspace',
      };
    }
  }
  
  // Default database error
  return {
    statusCode: 502,
    errorCode: ErrorCodes.UPSTREAM_ERROR,
    message: 'Database error occurred',
  };
}
