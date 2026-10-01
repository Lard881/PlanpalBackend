/**
 * Application error codes
 */
export const ErrorCodes = {
  // Validation
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  
  // Auth
  AUTH_REQUIRED: 'AUTH_REQUIRED',
  AUTH_EXPIRED: 'AUTH_EXPIRED',
  
  // Authorization
  NOT_A_MEMBER: 'NOT_A_MEMBER',
  FORBIDDEN: 'FORBIDDEN',
  LAST_ADMIN: 'LAST_ADMIN',
  
  // Invite codes
  INVALID_CODE: 'INVALID_CODE',
  CODE_EXPIRED: 'CODE_EXPIRED',
  CODE_REVOKED: 'CODE_REVOKED',
  CODE_USED_UP: 'CODE_USED_UP',
  ALREADY_MEMBER: 'ALREADY_MEMBER',
  
  // Files
  FILE_TOO_LARGE: 'FILE_TOO_LARGE',
  FILE_TYPE_NOT_ALLOWED: 'FILE_TYPE_NOT_ALLOWED',
  
  // Resources
  NOT_FOUND: 'NOT_FOUND',
  TASK_NOT_FOUND: 'TASK_NOT_FOUND',
  WORKSPACE_NOT_FOUND: 'WORKSPACE_NOT_FOUND',
  
  // Conflicts
  CONFLICT: 'CONFLICT',
  FOLDER_NOT_EMPTY: 'FOLDER_NOT_EMPTY',
  
  // System
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  UPSTREAM_ERROR: 'UPSTREAM_ERROR',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
};

/**
 * Custom application error
 */
export class AppError extends Error {
  constructor(code, message, statusCode = 400, details = null) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

/**
 * Create error response format
 */
export function createErrorResponse(code, message, requestId, details = null) {
  return {
    error: {
      code,
      message,
      ...(details && { details }),
      requestId,
    },
  };
}
