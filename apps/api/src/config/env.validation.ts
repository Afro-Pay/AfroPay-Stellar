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

  COSIGNER_SECRET: Joi.string()
    .pattern(/^S[2-9A-Za-z]{55}$/)
    .optional()
    .messages({
      'string.pattern.base':
        '"COSIGNER_SECRET" must be a valid Stellar secret seed starting with S',
    }),

  COSIGNER_PUBLIC_KEY: Joi.string()
    .pattern(/^G[2-9A-Za-z]{55}$/)
    .optional(),

  SIGNER_URL: Joi.string()
    .uri({ scheme: ['http', 'https'] })
    .optional(),

  SIGNER_AUTH_TOKEN: Joi.string()
    .min(16)
    .optional(),

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

  STELLAR_HORIZON_URLS: Joi.string()
    .optional()
    .custom((value, helpers) => validateWeightedUrlList(value, helpers, 'STELLAR_HORIZON_URLS')),

  SOROBAN_RPC_URL: Joi.string()
    .uri({ scheme: ['http', 'https'] })
    .optional(),

  SOROBAN_RPC_URLS: Joi.string()
    .optional()
    .custom((value, helpers) => validateWeightedUrlList(value, helpers, 'SOROBAN_RPC_URLS')),

  RPC_HEALTH_INTERVAL_MS: Joi.number().integer().min(1000).default(10000),

  RPC_REQUEST_TIMEOUT_MS: Joi.number().integer().min(250).default(5000),

  RPC_RATE_LIMIT_COOLDOWN_MS: Joi.number().integer().min(1000).default(60000),

  RPC_MAX_BLOCK_LAG: Joi.number().integer().min(0).default(3),

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

  LIQUIDITY_REBALANCING_ENABLED: Joi.boolean().truthy('true').falsy('false').default(true),
  LIQUIDITY_CHECK_INTERVAL_MS: Joi.number().integer().min(60_000).default(3_600_000),
  LIQUIDITY_CORRIDORS: Joi.string().default('USDC:NGN,USDC:GHS'),
  LIQUIDITY_DEFAULT_WEEKLY_DEMAND: Joi.number().min(0).default(0),
  LIQUIDITY_DEFAULT_RATE: Joi.number().greater(0).default(1),
  LIQUIDITY_MAX_DAILY_REBALANCES: Joi.number().integer().greater(0).default(3),
  LIQUIDITY_MAX_DAILY_AMOUNT: Joi.number().greater(0).default(100_000),
  LIQUIDITY_MOCK_RESERVES: Joi.string().default('{}'),
  LIQUIDITY_ASSET_ISSUERS: Joi.string().default('{}'),
  LIQUIDITY_RESERVE_ACCOUNTS: Joi.string().default('{}'),
  LIQUIDITY_TREASURY_PUBLIC_KEY: Joi.string().pattern(/^G[2-9A-Za-z]{55}$/).optional(),
  LIQUIDITY_TREASURY_SECRET_KEY: Joi.string().pattern(/^S[2-9A-Za-z]{55}$/).optional(),
  LIQUIDITY_QUEUE_NAME: Joi.string().default('liquidity_rebalance_jobs'),
  LIQUIDITY_RESULT_URL: Joi.string().uri({ scheme: ['http', 'https'] }).optional(),
  LIQUIDITY_WORKER_TOKEN: Joi.string().min(16).optional(),
})
  .or('KMS_KEY_ID', 'ENCRYPTION_KEY')
  .with('KMS_KEY_ID', 'AWS_REGION')
  .with('SIGNER_URL', 'SIGNER_AUTH_TOKEN')
  .with('SIGNER_AUTH_TOKEN', 'SIGNER_URL')
  .with('LIQUIDITY_RESULT_URL', 'LIQUIDITY_WORKER_TOKEN')
  .with('LIQUIDITY_WORKER_TOKEN', 'LIQUIDITY_RESULT_URL');

function validateWeightedUrlList(value: string, helpers: Joi.CustomHelpers, name: string) {
  const entries = value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

  for (const entry of entries) {
    const [url, weight] = entry.split('|').map((part) => part.trim());
    const validation = Joi.string().uri({ scheme: ['http', 'https'] }).validate(url);
    if (validation.error) {
      return helpers.message({
        custom: `"${name}" contains an invalid URL: ${url}`,
      });
    }
    if (weight && (!Number.isFinite(Number(weight)) || Number(weight) <= 0)) {
      return helpers.message({
        custom: `"${name}" weights must be positive numbers`,
      });
    }
  }

  return value;
}
