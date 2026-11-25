import {test} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { assetPath,externalLink,inlineScriptHashes,generation,model,requestId,safeName,secureVaultAvailable,trustedNavigation } from '../src/security.js';
test('navigation allows only the application origin, rejecting lookalikes and credentials',()=>{
  assert.equal(trustedNavigation('oi://app/workspace?tab=profile','oi://app/'),true);
  for(const url of ['https://attacker.test','oi://app.attacker.test','oi://user:pass@app','file:///etc/passwd','javascript:alert(1)'])assert.equal(trustedNavigation(url,'oi://app/'),false);
  assert.equal(trustedNavigation('http://localhost:3000/settings','http://localhost:3000'),true);
  assert.equal(trustedNavigation('http://localhost:3001','http://localhost:3000'),false);
});
test('asset lookup blocks encoded traversal and Windows path separators',()=>{
  const root=path.resolve('public');assert.equal(assetPath(root,'/assets/app.js'),path.join(root,'assets/app.js'));
  for(const value of ['/%2e%2e/private','/..\\private','/%00secret'])assert.throws(()=>assetPath(root,value));
});
test('IPC inputs reject filesystem paths, injection, invalid roles and excess context',()=>{
  for(const value of ['../secret','nul.txt','CON','CON ','notes.txt.','a/b.json','a\\b.md','a:ads.txt'])assert.throws(()=>safeName(value));
  assert.equal(safeName('practice-notes.md'),'practice-notes.md');
  for(const value of ['../../app','a;shutdown','evil\nname'])assert.throws(()=>model(value));
  assert.throws(()=>requestId('x\nfoo'));assert.throws(()=>generation({provider:'openai',model:'gpt-4.1-mini',requestId:'ok',messages:[{role:'developer',content:'hi'}]}));
  assert.throws(()=>generation({provider:'openai',model:'gpt-4.1-mini',requestId:'ok',messages:[{role:'user',content:'hello'}],maxTokens:9000}));
  assert.equal(generation({provider:'ollama',model:'qwen3:0.6b',requestId:'ok',messages:[{role:'user',content:'hello'}]}).maxTokens,2048);
});
test('Linux insecure fallback is refused',()=>{
  assert.equal(secureVaultAvailable(true,'linux','basic_text'),false);assert.equal(secureVaultAvailable(true,'linux','unknown'),false);
  assert.equal(secureVaultAvailable(false,'win32','DPAPI'),false);assert.equal(secureVaultAvailable(true,'linux','gnome_libsecret'),true);
});
test('external links allow exact HTTPS documentation hosts only',()=>{assert.equal(externalLink('https://ollama.com/download'),'https://ollama.com/download');for(const value of ['https://ollama.com.attacker.test/','https://user:secret@github.com/','file:///a','javascript:alert(1)','https://github.com:8443/','http://github.com/'])assert.equal(externalLink(value),null);});
test('CSP hashes normalize Windows HTML line endings like the Chromium parser',()=>{assert.deepEqual(inlineScriptHashes('<script>\r\nwindow.ready=true;\r\n</script>'),inlineScriptHashes('<script>\nwindow.ready=true;\n</script>'));assert.equal(inlineScriptHashes('<script src="external.js"></script>').length,0);});
