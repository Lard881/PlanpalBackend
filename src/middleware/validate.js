import { AppError, ErrorCodes } from '../lib/errors.js';

/**
 * Zod validation middleware
 */
export function validate(schema, source = 'body') {
  return (req, res, next) => {
    try {
      const data = source === 'body' ? req.body : 
                   source === 'query' ? req.query : 
                   req.params;
      
      const result = schema.safeParse(data);
      
      if (!result.success) {
        const details = result.error.errors.map(err => ({
          field: err.path.join('.'),
          message: err.message,
        }));
        
        throw new AppError(
          ErrorCodes.VALIDATION_FAILED,
          'Validation failed',
          400,
          { fields: details }
        );
      }
      
      // Replace with validated data
      if (source === 'body') req.body = result.data;
      else if (source === 'query') req.query = result.data;
      else req.params = result.data;
      
      next();
    } catch (error) {
      next(error);
    }
  };
}
