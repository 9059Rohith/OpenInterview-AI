import { DatabaseSync } from 'node:sqlite';
import type { Vault } from './vault.js';
import { storeKey } from './security.js';
export class LocalStore {
  private db:DatabaseSync;
  constructor(file:string,private vault:Vault){this.db=new DatabaseSync(file);this.db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS records (key TEXT PRIMARY KEY, ciphertext BLOB NOT NULL, updated_at TEXT NOT NULL); PRAGMA user_version=1;');}
  get(key:unknown){const row=this.db.prepare('SELECT ciphertext FROM records WHERE key=?').get(storeKey(key));return row?JSON.parse(this.vault.decrypt(Buffer.from(row.ciphertext as Uint8Array))):null;}
  put(key:unknown,value:unknown){const json=JSON.stringify(value);if(!json||json.length>5_000_000)throw new Error('Record must be JSON below 5 MB');const encrypted=this.vault.encrypt(json);this.db.prepare('INSERT INTO records(key,ciphertext,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET ciphertext=excluded.ciphertext,updated_at=excluded.updated_at').run(storeKey(key),encrypted,new Date().toISOString());return {saved:true};}
  delete(key:unknown){this.db.prepare('DELETE FROM records WHERE key=?').run(storeKey(key));return {deleted:true};}
  close(){this.db.close();}
}
