import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import path from 'path';

export default defineConfig({
  plugins: [vue()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return;

          if (id.includes('element-plus') || id.includes('@element-plus')) {
            return 'vendor-element';
          }
          if (id.includes('@arco-design')) {
            return 'vendor-arco';
          }
          if (id.includes('xlsx')) {
            return 'vendor-xlsx';
          }
          if (id.includes('html2canvas')) {
            return 'vendor-html2canvas';
          }
        }
      }
    }
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@components': path.resolve(__dirname, 'src/components'),
      '@views': path.resolve(__dirname, 'src/views'),
      '@stores': path.resolve(__dirname, 'src/stores'),
      '@utils': path.resolve(__dirname, 'src/utils'),
      '@router': path.resolve(__dirname, 'src/router'),
      '@layouts': path.resolve(__dirname, 'src/layouts')
    }
  },
  server: {
    port: 3000,
    host: true,
    allowedHosts: [
      'hugh-nonfissile-abeyantly.ngrok-free.dev',
      '.ngrok-free.dev',
      'localhost'
    ],
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true
      }
    }
  }
});
