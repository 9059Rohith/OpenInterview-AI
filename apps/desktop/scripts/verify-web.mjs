import {readdir,readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const expected=fileURLToPath(new URL('../../web/out/',import.meta.url));
const actual=process.argv[2];
if(!actual)throw Error('Pass the installed application resources/web directory');
async function fingerprint(root){const files=[];async function walk(relative=''){for(const entry of await readdir(path.join(root,relative),{withFileTypes:true})){const name=path.join(relative,entry.name);if(entry.isDirectory())await walk(name);else if(entry.isFile())files.push(name);}}await walk();files.sort();const digest=createHash('sha256');for(const file of files){digest.update(file.split(path.sep).join('/')+'\0');digest.update(createHash('sha256').update(await readFile(path.join(root,file))).digest());}return {files:files.length,sha256:digest.digest('hex')};}
const source=await fingerprint(expected),installed=await fingerprint(actual);
if(source.sha256!==installed.sha256)throw Error('Installed web resources differ from the final exported web build');
console.log(JSON.stringify({matched:true,...installed}));
