import path from 'node:path';
import {existsSync} from 'node:fs';
export function detectOllamaInstall(platform=process.platform,environment=process.env,exists=existsSync){
  const executable=platform==='win32'?'ollama.exe':'ollama';
  const paths=platform==='win32'?path.win32:path.posix;
  const standard=platform==='win32'?(environment.LOCALAPPDATA?[paths.join(environment.LOCALAPPDATA,'Programs','Ollama',executable),paths.join(environment.LOCALAPPDATA,'Ollama',executable)]:[]):platform==='darwin'?['/Applications/Ollama.app/Contents/Resources/ollama','/usr/local/bin/ollama','/opt/homebrew/bin/ollama']:['/usr/local/bin/ollama','/usr/bin/ollama'];
  const candidates=[...standard,...(environment.PATH??environment.Path??'').split(platform==='win32'?';':':').filter(Boolean).map(directory=>paths.join(directory,executable))];
  return candidates.some(candidate=>exists(candidate));
}
