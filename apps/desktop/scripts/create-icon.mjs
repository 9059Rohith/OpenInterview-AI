// Development utility. Generated PNG/ICO assets are committed; sharp is supplied by Next.js.
import sharp from 'sharp';
import {readFile,writeFile} from 'node:fs/promises';
const svg=await readFile(new URL('../src/icon.svg',import.meta.url));
const png=await sharp(svg).resize(512,512).png().toBuffer();
await writeFile(new URL('../src/icon.png',import.meta.url),png);
const small=await sharp(svg).resize(256,256).png().toBuffer();
const header=Buffer.alloc(22);header.writeUInt16LE(1,2);header.writeUInt16LE(1,4);header[6]=0;header[7]=0;header.writeUInt16LE(1,10);header.writeUInt16LE(32,12);header.writeUInt32LE(small.length,14);header.writeUInt32LE(22,18);
await writeFile(new URL('../src/icon.ico',import.meta.url),Buffer.concat([header,small]));
