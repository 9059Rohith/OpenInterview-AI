import {initialState} from './core';
import type {AppState} from './types';
const obj=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const string=(v:unknown):v is string=>typeof v==='string';
const strings=(v:unknown):v is string[]=>Array.isArray(v)&&v.every(string);
function requireValue(ok:unknown,name:string):asserts ok{if(!ok)throw Error(`Workspace data is invalid: ${name}. Import a valid OpenInterview backup or export the current workspace before resetting it.`);}
/** Validate nested external data before it becomes live application state. */
export function readWorkspace(value:unknown):AppState {
 requireValue(obj(value),'workspace object');const p=value.profile;requireValue(obj(p),'profile');
 for(const k of ['id','name','role','experience','language','resumeText'])requireValue(string(p[k]),`profile.${k}`);
 for(const k of ['companies','skills','education','projects','employment'])requireValue(strings(p[k]),`profile.${k}`);
 requireValue(typeof p.consentCloud==='boolean'&&typeof p.onboarded==='boolean','profile preferences');
 for(const k of ['documents','sessions','questions','roadmaps','versions','flashcards'])requireValue(Array.isArray(value[k]),k);
 for(const d of value.documents as unknown[]){requireValue(obj(d)&&['id','name','type','text','createdAt','updatedAt'].every(k=>string(d[k])),'document fields');if(d.image!==undefined)requireValue(string(d.image)&&/^data:image\/(png|jpeg|webp|gif);base64,/.test(d.image),'document image');}
 for(const s of value.sessions as unknown[]){requireValue(obj(s)&&['id','title','category','company','role','difficulty','createdAt','updatedAt','notes'].every(k=>string(s[k])),'session fields');requireValue(s.mode==='Light Mode'||s.mode==='Shadow Mode','session mode');requireValue(s.status==='active'||s.status==='completed','session status');requireValue(typeof s.archived==='boolean'&&typeof s.duration==='number'&&strings(s.questionIds)&&Array.isArray(s.turns),'session collections');for(const t of s.turns){requireValue(obj(t)&&string(t.id)&&string(t.text)&&string(t.createdAt)&&['user','assistant','transcript'].includes(String(t.speaker)),'session turn');if(t.evaluation!==undefined){const e=t.evaluation;requireValue(obj(e)&&typeof e.score==='number'&&Number.isFinite(e.score)&&strings(e.concepts)&&strings(e.missing)&&strings(e.feedback)&&typeof e.words==='number'&&['Deterministic rubric','AI-generated'].includes(String(e.kind)),'turn evaluation');}}}
 for(const q of value.questions as unknown[]){requireValue(obj(q)&&['id','company','role','topic','difficulty','question','sampleAnswer'].every(k=>string(q[k]))&&strings(q.expectedConcepts)&&strings(q.followUps)&&typeof q.original==='boolean'&&obj(q.source),'question fields');requireValue(['title','url','collectedAt','confidence'].every(k=>string((q.source as Record<string,unknown>)[k])),'question provenance');const url=(q.source as {url:string}).url;requireValue(!url||/^https?:\/\//i.test(url),'question source URL');}
 for(const r of value.roadmaps as unknown[]){requireValue(obj(r)&&string(r.id)&&string(r.title)&&Array.isArray(r.items),'roadmap');for(const i of r.items)requireValue(obj(i)&&string(i.id)&&string(i.topic)&&string(i.dueDate)&&typeof i.completed==='boolean','roadmap item');}
 for(const v of value.versions as unknown[])requireValue(obj(v)&&['id','title','text','createdAt'].every(k=>string(v[k])),'resume version');
 for(const f of value.flashcards as unknown[])requireValue(obj(f)&&['id','front','back','dueDate'].every(k=>string(f[k]))&&typeof f.interval==='number','flashcard');
 for(const k of ['bookmarks','practiced','reported','focus'])requireValue(strings(value[k]),k);
 const c=value.provider;requireValue(obj(c)&&['openai','gemini','claude','compatible','ollama'].includes(String(c.provider))&&string(c.model)&&string(c.baseUrl),'provider configuration');
 requireValue(obj(value.design)&&['diagram','notes','requirements'].every(k=>string((value.design as Record<string,unknown>)[k])),'design notes');
 requireValue(string(value.code)&&string(value.codeLanguage),'coding workspace');requireValue(value.theme==='dark'||value.theme==='light','theme');requireValue(typeof value.fontSize==='number'&&[14,15,17].includes(value.fontSize),'font size');requireValue(typeof value.reducedMotion==='boolean','motion preference');
 if(value.shadowSettings!==undefined)requireValue(obj(value.shadowSettings)&&['autoAnswer','useContext','remember'].every(k=>typeof (value.shadowSettings as Record<string,unknown>)[k]==='boolean'),'Shadow preferences');
 const result={...initialState};for(const k of Object.keys(initialState) as (keyof AppState)[])(result as unknown as Record<string,unknown>)[k]=value[k];
 result.provider={provider:c.provider as AppState['provider']['provider'],model:c.model,baseUrl:c.baseUrl,configured:c.provider==='ollama'};
 result.shadowSettings=value.shadowSettings as AppState['shadowSettings']??{autoAnswer:true,useContext:true,remember:true};
 return result;
}
