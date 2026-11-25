import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Vault,type CryptoStore} from '../src/vault.js';
import {LocalStore} from '../src/store.js';
const crypto:CryptoStore={isEncryptionAvailable:()=>true,encryptString:value=>Buffer.from('encrypted:'+Buffer.from(value).toString('base64')),decryptString:value=>Buffer.from(value.toString().slice(10),'base64').toString()};
test('vault stores ciphertext, never exposes key in status, and deletes only selected key',()=>{
  const dir=mkdtempSync(path.join(os.tmpdir(),'oi-vault-'));try{const vault=new Vault(dir,crypto,'win32');vault.set('openai','test-secret-never-use');vault.set('claude','another-test-secret');
  const file=readFileSync(path.join(dir,'credentials.enc.json'),'utf8');assert.equal(file.includes('test-secret-never-use'),false);assert.equal(JSON.stringify(vault.status()).includes('test-secret-never-use'),false);assert.equal(vault.get('openai'),'test-secret-never-use');vault.remove('openai');assert.throws(()=>vault.get('openai'));assert.equal(vault.get('claude'),'another-test-secret');}finally{rmSync(dir,{recursive:true,force:true});}
});
test('unavailable vault never writes plaintext',()=>{const dir=mkdtempSync(path.join(os.tmpdir(),'oi-vault-'));try{const vault=new Vault(dir,{...crypto,isEncryptionAvailable:()=>false},'win32');assert.equal(vault.status().available,false);assert.throws(()=>vault.set('openai','not-written'));}finally{rmSync(dir,{recursive:true,force:true});}});
test('credentials reject control characters before a request header can disclose them in errors',()=>{const dir=mkdtempSync(path.join(os.tmpdir(),'oi-vault-'));try{const vault=new Vault(dir,crypto,'win32');assert.throws(()=>vault.set('openai','synthetic\u0001-key'),/format/);assert.throws(()=>vault.set('openai','synthetic key'),/format/);}finally{rmSync(dir,{recursive:true,force:true});}});
test('SQLite records encrypt payloads and roundtrip across reopen',()=>{const dir=mkdtempSync(path.join(os.tmpdir(),'oi-sqlite-'));try{const vault=new Vault(dir,crypto,'win32');const file=path.join(dir,'local.sqlite3');let db=new LocalStore(file,vault);db.put('profile',{name:'private-test-candidate',skills:['TypeScript']});assert.deepEqual(db.get('profile'),{name:'private-test-candidate',skills:['TypeScript']});db.close();assert.equal(readFileSync(file).includes(Buffer.from('private-test-candidate')),false);db=new LocalStore(file,vault);assert.equal((db.get('profile') as {name:string}).name,'private-test-candidate');db.delete('profile');assert.equal(db.get('profile'),null);db.close();}finally{rmSync(dir,{recursive:true,force:true});}});
