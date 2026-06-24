const requiredVars: { key: string; hint: string }[] = [
  {
    key: 'NEXT_PUBLIC_API_URL',
    hint: 'Base URL of the AfroPay API. Example: http://localhost:3001',
  },
];

function validateEnv(): void {
  const missing: string[] = [];

  for (const { key, hint } of requiredVars) {
    if (!process.env[key]) {
      missing.push(`  ${key} — ${hint}`);
    }
  }

  if (missing.length > 0) {
    const msg = [
      '[AfroPay] FATAL: Required frontend environment variables are missing.',
      'Add them to your .env.local file or set them in your deployment:',
      '',
      ...missing,
      '',
      'See .env.example at the project root for reference.',
    ].join('\n');

    console.error(msg);
    process.exit(1);
  }
}

validateEnv();

export const env = {
  NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL!,
} as const;
