import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const envSchema = z.object({
  PORT: z.string().default('3000'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  
  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  SUPABASE_JWT_SECRET: z.string().optional(),
  
  FIREBASE_SERVICE_ACCOUNT_JSON: z.string().optional(),
  
  ALLOWED_ORIGINS: z.string().default('http://localhost:3000'),
});

let env;

try {
  env = envSchema.parse(process.env);
} catch (error) {
  console.error('❌ Invalid environment variables:');
  console.error(error.errors);
  process.exit(1);
}

export const config = {
  port: parseInt(env.PORT, 10),
  nodeEnv: env.NODE_ENV,
  isDevelopment: env.NODE_ENV === 'development',
  isProduction: env.NODE_ENV === 'production',
  isTest: env.NODE_ENV === 'test',
  
  supabase: {
    url: env.SUPABASE_URL,
    anonKey: env.SUPABASE_ANON_KEY,
    serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
    jwtSecret: env.SUPABASE_JWT_SECRET,
  },
  
  firebase: {
    serviceAccountJson: env.FIREBASE_SERVICE_ACCOUNT_JSON,
    serviceAccount: env.FIREBASE_SERVICE_ACCOUNT_JSON
      ? JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON)
      : null,
  },
  
  cors: {
    origins: env.ALLOWED_ORIGINS.split(',').map(o => o.trim()),
  },
};
