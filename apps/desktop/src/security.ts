import path from 'node:path';
import {createHash} from 'node:crypto';
export const PROVIDERS = ['openai','gemini','claude','compatible','ollama'] as const;
export type Provider = typeof PROVIDERS[number];
export const MAX_FILE = 20 * 1024 * 1024;
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected an object');
  return value as Record<string, unknown>;
}
export function string(value: unknown, max = 1000): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || value.includes('\0')) throw new Error('Invalid text value');
  return value;
}
export function provider(value: unknown): Provider {
  if (!PROVIDERS.includes(value as Provider)) throw new Error('Unsupported provider');
  return value as Provider;
}
export function model(value: unknown): string {
  const result=string(value,150);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/.test(result) || result.includes('..')) throw new Error('Invalid model name');
  return result;
}
export function requestId(value: unknown): string { const id=string(value,100); if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error('Invalid request identifier'); return id; }
export function storeKey(value: unknown): string { const key=string(value,150); if(!/^[a-zA-Z0-9_.:-]+$/.test(key)) throw new Error('Invalid record key'); return key; }
export function safeName(value: unknown): string {
  const name=string(value,180); if(name!==path.basename(name)||/[<>:"/\\|?*\x00-\x1f]/.test(name)||/[. ]$/.test(name)||name==='.'||name==='..'||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) throw new Error('Invalid file name'); return name;
}
export function trustedNavigation(candidate: string, origin: string): boolean {
  try { const url=new URL(candidate), base=new URL(origin); return url.protocol===base.protocol && url.host===base.host && !url.username && !url.password; } catch {return false;}
}
export const EXTERNAL_HOSTS=new Set(['github.com','ollama.com','docs.ollama.com','platform.openai.com','developers.openai.com','ai.google.dev','aistudio.google.com','console.anthropic.com','docs.anthropic.com','razorpay.com','checkout.razorpay.com']);
export function externalLink(candidate:string):string|null {try{const url=new URL(candidate);return url.protocol==='https:'&&!url.username&&!url.password&&!url.port&&EXTERNAL_HOSTS.has(url.hostname)?url.toString():null;}catch{return null;}}
export function inlineScriptHashes(html:string):string[]{return [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].filter(match=>Boolean(match[1])).map(match=>"'sha256-"+createHash('sha256').update(match[1].replace(/\r\n?/g,'\n')).digest('base64')+"'");}
export function assetPath(root: string, pathname: string): string {
  const decoded=decodeURIComponent(pathname);
  if (decoded.includes('\0')||decoded.includes('\\')) throw new Error('Invalid asset path');
  const resolved=path.resolve(root,'.'+decoded);
  if(resolved!==path.resolve(root)&&!resolved.startsWith(path.resolve(root)+path.sep))throw new Error('Asset path escaped root');
  return resolved;
}
export interface GenerateRequest { provider:Provider; model:string; messages:{role:'system'|'user'|'assistant';content:string}[]; requestId:string; maxTokens:number }
export function generation(value:unknown): GenerateRequest {
  const data=object(value); const p=provider(data.provider), m=model(data.model);
  if(!Array.isArray(data.messages)||data.messages.length<1||data.messages.length>100)throw new Error('Provide 1–100 messages');
  let total=0;const messages=data.messages.map(raw=>{const item=object(raw);if(!['system','user','assistant'].includes(item.role as string))throw new Error('Invalid message role');const content=string(item.content,100_000);total+=content.length;return {role:item.role as 'system'|'user'|'assistant',content};});
  if(total>300_000)throw new Error('Context is too large');
  const tokens=data.maxTokens??2048;if(typeof tokens!=='number'||!Number.isInteger(tokens)||tokens<1||tokens>8192)throw new Error('Token limit must be 1–8192');
  return {provider:p,model:m,messages,requestId:requestId(data.requestId),maxTokens:tokens};
}
export function secureVaultAvailable(available:boolean,platform:string,backend:string):boolean {return available && !(platform==='linux'&&['basic_text','unknown',''].includes(backend));}
