import { mkdirSync, existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import path from 'node:path';
import { provider, secureVaultAvailable, string, type Provider } from './security.js';
export interface CryptoStore {isEncryptionAvailable():boolean;getSelectedStorageBackend?():string;encryptString(value:string):Buffer;decryptString(value:Buffer):string}
export class Vault {
  private file:string;
  constructor(private directory:string,private crypto:CryptoStore,private platform=process.platform){this.file=path.join(directory,'credentials.enc.json');}
  status(){const backend=this.platform==='linux'?this.crypto.getSelectedStorageBackend?.()??'unknown':this.platform==='win32'?'DPAPI':'Keychain';return {available:secureVaultAvailable(this.crypto.isEncryptionAvailable(),this.platform,backend),backend,configured:this.available()?Object.keys(this.read()):[],message:'Keys never leave the main process; cloud calls go directly to the chosen provider.'};}
  private available(){const backend=this.platform==='linux'?this.crypto.getSelectedStorageBackend?.()??'unknown':'';return secureVaultAvailable(this.crypto.isEncryptionAvailable(),this.platform,backend);}
  private require(){if(!this.available())throw new Error('OS credential vault unavailable. Unlock your keyring; plaintext fallback is disabled.');}
  private read():Record<string,string>{this.require();if(!existsSync(this.file))return {};const raw=JSON.parse(readFileSync(this.file,'utf8'));if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('Credential vault is damaged');return raw;}
  private write(data:Record<string,string>){mkdirSync(this.directory,{recursive:true});const temp=this.file+'.tmp';writeFileSync(temp,JSON.stringify(data),{mode:0o600});renameSync(temp,this.file);}
  set(p:unknown,key:unknown){const name=provider(p);if(name==='ollama')throw new Error('Ollama does not require a key');const value=string(key,4096).trim();if(!/^[\x21-\x7e]+$/.test(value))throw new Error('Invalid credential format');this.require();const data=this.read();data[name]=this.crypto.encryptString(value).toString('base64');this.write(data);return this.status();}
  remove(p:unknown){const name=provider(p);const data=this.read();delete data[name];this.write(data);return this.status();}
  get(p:Provider){const data=this.read();if(!data[p])throw new Error('Configure an API key in Settings first');return this.crypto.decryptString(Buffer.from(data[p],'base64'));}
  encrypt(value:string){this.require();return this.crypto.encryptString(value);}
  decrypt(value:Buffer){this.require();return this.crypto.decryptString(value);}
}
