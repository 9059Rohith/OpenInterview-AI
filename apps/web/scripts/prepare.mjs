import {copyFileSync,mkdirSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname,resolve} from 'node:path';
const require=createRequire(import.meta.url);
const root=dirname(dirname(require.resolve('pdfjs-dist/build/pdf.mjs')));
mkdirSync(new URL('../public/',import.meta.url),{recursive:true});
copyFileSync(resolve(root,'build/pdf.worker.min.mjs'),new URL('../public/pdf.worker.min.mjs',import.meta.url));
