import { defineConfig } from 'tsup';

// The build script empties dist before tsup runs, so no entry cleans it.
export default defineConfig({
  entry: ['src/index.ts', 'src/browser.ts'],
  format: ['esm', 'cjs'],
  target: 'node20',
  platform: 'node',
  dts: true,
  sourcemap: false,
  clean: false,
});
