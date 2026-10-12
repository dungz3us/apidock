import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'express/index': 'src/express/index.ts',
    'server/index': 'src/server/index.ts',
    cli: 'src/cli.ts',
  },
  format: 'esm',
  platform: 'node',
  target: 'node20',
  dts: true,
  fixedExtension: false,
  clean: true,
  sourcemap: true,
});
