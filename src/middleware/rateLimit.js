import rateLimit from 'express-rate-limit';
import { ErrorCodes, createErrorResponse } from '../lib/errors.js';

/**
 * General rate limit: 300 requests per 15 minutes
 */
export const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json(
      createErrorResponse(
        ErrorCodes.RATE_LIMITED,
        'Too many requests, please try again later',
        req.id
      )
    );
  },
  keyGenerator: (req) => req.user?.id || req.ip,
});

/**
 * Strict rate limit for joining workspaces: 10 per hour
 */
export const joinWorkspaceLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json(
      createErrorResponse(
        ErrorCodes.RATE_LIMITED,
        'Too many join attempts, please try again later',
        req.id
      )
    );
  },
  keyGenerator: (req) => req.user?.id || req.ip,
});

/**
 * File upload URL rate limit: 60 per hour
 */
export const fileUploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json(
      createErrorResponse(
        ErrorCodes.RATE_LIMITED,
        'Too many upload requests, please try again later',
        req.id
      )
    );
  },
  keyGenerator: (req) => req.user?.id || req.ip,
});
