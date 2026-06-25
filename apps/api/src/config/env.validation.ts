import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),

  PORT: Joi.number().port().default(3001),

  DATABASE_URL: Joi.string()
    .pattern(/^postgresql:\/\/.+/)
    .required()
    .messages({
      'string.pattern.base':
        '"DATABASE_URL" must be a valid PostgreSQL connection string starting with postgresql://',
      'any.required': '"DATABASE_URL" is required',
    }),

  REDIS_URL: Joi.string()
    .pattern(/^redis(s?):\/\/.+/)
    .required()
    .messages({
      'string.pattern.base':
        '"REDIS_URL" must be a valid Redis connection string starting with redis:// or rediss://',
      'any.required': '"REDIS_URL" is required',
    }),

  JWT_SECRET: Joi.string()
    .min(32)
    .required()
    .messages({
      'string.min':
        '"JWT_SECRET" must be at least 32 characters long',
      'any.required': '"JWT_SECRET" is required',
    }),

  ENCRYPTION_KEY: Joi.alternatives()
    .try(Joi.string().length(64).pattern(/^[0-9a-fA-F]{64}$/), Joi.allow(null))
    .optional()
    .messages({
      'string.length':
        '"ENCRYPTION_KEY" must be exactly 64 hexadecimal characters (32 bytes)',
      'string.pattern.base':
        '"ENCRYPTION_KEY" must be a 64-character hex string (0-9, a-f)',
    }),

  KMS_KEY_ID: Joi.string()
    .optional()
    .messages({
      'string.base': '"KMS_KEY_ID" must be a string',
    }),

  AWS_REGION: Joi.string()
    .optional()
    .messages({
      'string.base': '"AWS_REGION" must be a string',
    }),

  STELLAR_NETWORK: Joi.string()
    .valid('testnet', 'mainnet')
    .required()
    .messages({
      'any.only':
        '"STELLAR_NETWORK" must be either "testnet" or "mainnet"',
      'any.required': '"STELLAR_NETWORK" is required',
    }),

  STELLAR_HORIZON_URL: Joi.string()
    .uri({ scheme: ['http', 'https'] })
    .required()
    .messages({
      'string.uri':
        '"STELLAR_HORIZON_URL" must be a valid URL',
      'any.required': '"STELLAR_HORIZON_URL" is required',
    }),

  ANCHOR_USDC_URL: Joi.string()
    .uri({ scheme: ['http', 'https'] })
    .required()
    .messages({
      'string.uri': '"ANCHOR_USDC_URL" must be a valid URL',
      'any.required': '"ANCHOR_USDC_URL" is required',
    }),

  ANCHOR_NGN_URL: Joi.string()
    .uri({ scheme: ['http', 'https'] })
    .required()
    .messages({
      'string.uri': '"ANCHOR_NGN_URL" must be a valid URL',
      'any.required': '"ANCHOR_NGN_URL" is required',
    }),
}).or('KMS_KEY_ID', 'ENCRYPTION_KEY').with('KMS_KEY_ID', 'AWS_REGION');
