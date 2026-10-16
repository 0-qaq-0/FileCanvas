import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['02_测试/单元测试/**/*.test.ts'],
  },
});
