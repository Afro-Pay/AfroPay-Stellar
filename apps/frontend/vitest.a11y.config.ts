import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['components/**/*.a11y.test.tsx', 'pages/**/*.test.tsx', 'pages/**/*.a11y.test.tsx'],
  },
});
