import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  define: {
    __DEV__: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
      // Mock react-native-ble-plx (Flow-based, can't be parsed by Vitest)
      'react-native-ble-plx': path.resolve(__dirname, 'tests/__mocks__/react-native-ble-plx.ts'),
      // Mock react-native for node environment
      'react-native': path.resolve(__dirname, 'tests/__mocks__/react-native.ts'),
    },
  },
  test: {
    globals: false,
    environment: 'node',
  },
});
