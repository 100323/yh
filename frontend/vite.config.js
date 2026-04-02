import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import path from 'path';

function createManualChunks(id) {
  const normalizedId = id.split(path.sep).join('/');

  if (normalizedId.includes('/src/xyzw/cocos2d-js-min.js')) {
    return 'xyzw-cocos';
  }
  if (normalizedId.includes('/src/xyzw/index.js')) {
    return 'xyzw-runtime';
  }
  if (normalizedId.includes('/src/xyzw/')) {
    return 'xyzw-core';
  }

  if (!normalizedId.includes('/node_modules/')) return undefined;

  if (
    normalizedId.includes('/node_modules/vue/') ||
    normalizedId.includes('/node_modules/@vue/') ||
    normalizedId.includes('/node_modules/pinia/') ||
    normalizedId.includes('/node_modules/vue-router/') ||
    normalizedId.includes('/node_modules/@vueuse/')
  ) {
    return 'vendor-vue';
  }

  if (
    normalizedId.includes('/node_modules/element-plus/') ||
    normalizedId.includes('/node_modules/@element-plus/') ||
    normalizedId.includes('/node_modules/@ctrl/tinycolor/')
  ) {
    return 'vendor-element';
  }

  if (normalizedId.includes('/node_modules/naive-ui/')) {
    return 'vendor-naive';
  }

  if (normalizedId.includes('/node_modules/@arco-design/')) {
    return 'vendor-arco';
  }

  if (normalizedId.includes('/node_modules/xlsx/')) {
    return 'vendor-xlsx';
  }

  if (normalizedId.includes('/node_modules/html2canvas/')) {
    return 'vendor-html2canvas';
  }

  if (
    normalizedId.includes('/node_modules/axios/') ||
    normalizedId.includes('/node_modules/crypto-js/') ||
    normalizedId.includes('/node_modules/event-emitter3/') ||
    normalizedId.includes('/node_modules/idb/') ||
    normalizedId.includes('/node_modules/lz4js/') ||
    normalizedId.includes('/node_modules/moment/') ||
    normalizedId.includes('/node_modules/p-queue/')
  ) {
    return 'vendor-utils';
  }

  if (
    normalizedId.includes('/node_modules/@vicons/') ||
    normalizedId.includes('/node_modules/@css-render/')
  ) {
    return 'vendor-icons';
  }

  return 'vendor-misc';
}

export default defineConfig({
  plugins: [vue()],
  build: {
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks: createManualChunks
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
