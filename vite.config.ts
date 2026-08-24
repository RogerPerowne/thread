import { defineConfig } from 'vite';

export default defineConfig({
  base: process.env.VITE_BASE ?? '/',
  build: { target: 'es2022', assetsInlineLimit: 4096 },
  test: { environment: 'node', include: ['tests/unit/**/*.test.ts'] },
} as any);
