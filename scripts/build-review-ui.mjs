import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

// Bundle shared validation with the UI so opening the HTML needs no CDN or server.
await build({
  entryPoints: [fileURLToPath(new URL('../src/oracle-ui-entry.ts', import.meta.url))],
  outfile: fileURLToPath(new URL('../dist/oracle-ui.bundle.js', import.meta.url)),
  bundle: true, platform: 'browser', target: ['es2022'], format: 'iife',
  charset: 'utf8', minify: true, legalComments: 'inline',
});
