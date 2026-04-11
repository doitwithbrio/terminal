// Build a single-file Milkdown bundle using esbuild
import { build } from "https://deno.land/x/esbuild@v0.20.1/mod.js";

await build({
  stdin: {
    contents: `
      export { Editor, rootCtx, defaultValueCtx, editorViewOptionsCtx } from '@milkdown/kit/core';
      export { commonmark } from '@milkdown/kit/preset/commonmark';
      export { gfm } from '@milkdown/kit/preset/gfm';
      export { history } from '@milkdown/kit/plugin/history';
      export { listener, listenerCtx } from '@milkdown/kit/plugin/listener';
      export { replaceAll } from '@milkdown/kit/utils';
    `,
    resolveDir: '.',
    loader: 'js',
  },
  bundle: true,
  format: 'esm',
  outfile: 'milkdown-bundle.js',
  minify: true,
});

Deno.exit(0);
