import { defineConfig } from 'vite';

export default defineConfig({
  define: {
    __MULTIPLAYER__: JSON.stringify(process.env.MULTIPLAYER !== '0'),
  },
});
