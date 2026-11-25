import {test} from 'node:test';
import assert from 'node:assert/strict';
import {detectOllamaInstall} from '../src/runtime.js';
test('runtime detection checks executable presence without running shell commands',()=>{
  assert.equal(detectOllamaInstall('win32',{LOCALAPPDATA:'C:/User/Local',PATH:'C:/Tools'},file=>String(file).endsWith('ollama.exe')),true);
  assert.equal(detectOllamaInstall('linux',{PATH:'/custom/bin'},file=>String(file)==='/custom/bin/ollama'),true);
  assert.equal(detectOllamaInstall('linux',{PATH:'/custom/bin'},()=>false),false);
});
