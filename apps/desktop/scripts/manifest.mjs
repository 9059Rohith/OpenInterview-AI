import {readdir,stat,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const version=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8')).version;
const directory=new URL('../release/',import.meta.url);
const artifacts=[];
for(const name of await readdir(directory)){
  if(!name.startsWith('OpenInterview-AI-'+version+'-')||!/\.(exe|dmg|AppImage|deb)$/.test(name))continue;
  const file=new URL(name,directory),metadata=await stat(file);
  if(!metadata.isFile())continue;
  const sha256=createHash('sha256').update(await readFile(file)).digest('hex');
  artifacts.push({name,version,size:metadata.size,sha256,signed:false,platform:name.includes('-win-')?'windows':name.includes('-mac-')?'macos':'linux',arch:name.includes('-arm64-')?'arm64':'x64'});
}
await writeFile(new URL('checksums.sha256',directory),artifacts.map(a=>a.sha256+'  '+a.name).join('\n')+'\n');
await writeFile(new URL('manifest.json',directory),JSON.stringify({version,generatedAt:new Date().toISOString(),artifacts},null,2));
console.log('Wrote release manifest for '+artifacts.length+' actual artifacts');
