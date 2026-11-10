import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// `vite build --mode artifact` bundles everything into one self-contained
// HTML file (dist-artifact/index.html) for hosting as a shareable link.
export default defineConfig(({ mode }) => ({
  plugins: mode === 'artifact' ? [react(), viteSingleFile()] : [react()],
  base: './',
  build: mode === 'artifact' ? { outDir: 'dist-artifact', chunkSizeWarningLimit: 4000 } : {},
  test: { environment: 'node' },
}));
