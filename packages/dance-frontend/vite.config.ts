import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  base: './',
  resolve: {
    alias: {
      // semi-ui 的 exports 未导出 dist/css，这里直接指到真实文件
      '@douyinfe/semi-ui/dist/css/semi.min.css': path.resolve(process.cwd(), 'node_modules/@douyinfe/semi-ui/dist/css/semi.min.css'),
    },
  },
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 3000 },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:8790',
      '/media': 'http://127.0.0.1:8790',
    },
  },
});

