import { fileURLToPath } from 'node:url';
/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { copyFileSync, createReadStream, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { iwsdkDev } from '@iwsdk/vite-plugin-dev';
import { defineConfig, type Plugin } from 'vite';

/**
 * Serve MediaPipe's hand-tracking runtime from our own origin at
 * /vendor/mediapipe/ (from node_modules in dev, copied into the build), so
 * the family viewer's camera hands never depend on a third-party CDN.
 */
function mediapipeVendor(): Plugin {
  const source = join(process.cwd(), 'node_modules/@mediapipe/tasks-vision/wasm');
  let outDir = 'dist';
  return {
    name: 'shadowplay-mediapipe-vendor',
    configResolved(config) {
      outDir = config.build.outDir;
    },
    configureServer(server) {
      server.middlewares.use('/vendor/mediapipe/', (req, res, next) => {
        const file = join(source, (req.url ?? '').split('?')[0].replace(/^\/+/, ''));
        if (!file.startsWith(source) || !existsSync(file)) return next();
        res.setHeader('Content-Type', file.endsWith('.wasm') ? 'application/wasm' : 'text/javascript');
        createReadStream(file).pipe(res);
      });
    },
    closeBundle() {
      const target = join(process.cwd(), outDir, 'vendor/mediapipe');
      mkdirSync(target, { recursive: true });
      for (const f of readdirSync(source)) copyFileSync(join(source, f), join(target, f));
    },
  };
}

type ModuleInfo = { isEntry: boolean; importedIds: readonly string[] } | null;
let startupModules: Set<string> | null = null;

/** Modules reached from the page entry by static imports alone (worked out once per build). */
function loadedAtStartup(id: string, getModuleIds: () => IterableIterator<string>, getModuleInfo: (id: string) => ModuleInfo): boolean {
  if (!startupModules) {
    startupModules = new Set();
    const todo = [...getModuleIds()].filter((m) => getModuleInfo(m)?.isEntry);
    while (todo.length) {
      const m = todo.pop()!;
      if (startupModules.has(m)) continue;
      startupModules.add(m);
      todo.push(...(getModuleInfo(m)?.importedIds ?? []));
    }
  }
  return startupModules.has(id);
}

export default defineConfig({
  plugins: [iwsdkDev(), mediapipeVendor()],
  server: {
    host: '0.0.0.0',
    port: 8082,
    open: false,
    // The sharing API runs as its own process in development (npm run server).
    proxy: {
      '/api': 'http://localhost:8787',
      '/live': { target: 'ws://localhost:8787', ws: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: process.env.NODE_ENV !== 'production',
    target: 'esnext',
    rollupOptions: {
      input: './index.html',
      output: {
        // The framework that loads at startup, split out of the 2.6 MB main file
        // into two pieces the browser fetches in parallel: three (which imports
        // nothing back) and the rest of the framework (IWSDK and uikit import each
        // other, so they share one piece). Only modules the page loads at startup
        // are moved: lazily loaded ones (the font, the MSDF and locomotion workers,
        // the world initializer) stay in their own chunks, loaded when needed.
        manualChunks(id, { getModuleIds, getModuleInfo }) {
          if (!id.includes('node_modules') || !loadedAtStartup(id, getModuleIds, getModuleInfo)) return undefined;
          return /node_modules\/three\//.test(id) ? 'three' : 'framework';
        },
      },
    },
  },
  esbuild: { target: 'esnext' },
  // @drawcall/uikitml otherwise pulls a second three/@pmndrs/uikit graph
  // (three@0.185 vs app super-three@0.181). Duplicate Component classes break
  // instanceof checks → "Only pmndrs/uikit components can be added as children".
  resolve: {
    // Only the Lucide icons the app uses (see src/vendor/lucide-subset.ts): the
    // full set is 4.1 MB. Exact match, so the subset's deep imports still resolve.
    alias: [{ find: /^@pmndrs\/uikit-lucide$/, replacement: fileURLToPath(new URL('./src/vendor/lucide-subset.ts', import.meta.url)) }],
    dedupe: [
      'three',
      '@pmndrs/uikit',
      '@pmndrs/uikit-horizon',
      '@pmndrs/uikit-lucide',
    ],
  },
  optimizeDeps: {
    exclude: ['@babylonjs/havok'],
    include: [
      'three',
      '@pmndrs/uikit',
      '@pmndrs/uikit-horizon',
      '@pmndrs/uikit-lucide',
      '@drawcall/uikitml',
    ],
    esbuildOptions: { target: 'esnext' },
  },
  publicDir: 'public',
  base: './',
});
