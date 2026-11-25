import { build } from 'esbuild';
import { mkdir, copyFile } from 'node:fs/promises';
await mkdir('dist', {recursive:true});
await build({entryPoints:['src/main.ts','src/preload.ts'],bundle:true,platform:'node',format:'cjs',outdir:'dist',outExtension:{'.js':'.cjs'},external:['electron','node:sqlite'],target:'node22',sourcemap:true});
await copyFile('src/setup.html','dist/setup.html');
await copyFile('src/icon.png','dist/icon.png');
await copyFile('src/smoke-renderer.js','dist/smoke-renderer.js');
