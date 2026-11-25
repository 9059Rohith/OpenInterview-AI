import type {LocalStore} from './store.js';
type KnowledgeDocument={name:string;text:string;project?:string;kind?:string};
export const MAX_KNOWLEDGE_TEXT = 32_000_000;
export const MAX_KNOWLEDGE_SOURCES = 20_000;
const words=(value:string)=>value.toLowerCase().replace(/multiagent/g,'multi agent').match(/[a-z0-9+#]{3,}/g)??[];
const stop=new Set(['the','and','you','your','how','what','why','about','tell','would','could','project','projects','with','that','this','from','please','explain']);
/** Local private corpus, separate from the 5 MB editable workspace record. */
export class PrivateKnowledge {
 private cache:{chunks:(KnowledgeDocument&{lower:string})[];totalSources:number;projects:string[]}|undefined;
 constructor(private store:Pick<LocalStore,'get'>){}
 query(query:string,limit=6){
  if(typeof query!=='string'||!query.trim()||query.length>4000||!Number.isInteger(limit)||limit<1||limit>12)throw Error('Invalid project retrieval request');
  if(!this.cache)this.cache=this.load();
  const terms=[...new Set(words(query).filter(w=>!stop.has(w)))];
  let ranked=this.cache.chunks.map((doc,index)=>{const title=doc.name.toLowerCase();let score=0;for(const term of terms){if(title.includes(term))score+=7;if(doc.lower.includes(term))score+=3;}if(score>0||!terms.length)score+=doc.kind==='fact'?5:doc.kind==='analysis'?2:0;return {doc,index,score};}).filter(item=>item.score>0).sort((a,b)=>b.score-a.score||a.index-b.index);
  if(!this.cache.projects.some(project=>query.toLowerCase().includes(project.toLowerCase()))){const covered=new Set<string>(),first:typeof ranked=[],rest:typeof ranked=[];for(const item of ranked){if(item.doc.project&&!covered.has(item.doc.project)){covered.add(item.doc.project);first.push(item);}else rest.push(item);}ranked=[...first,...rest];}
  const documents:{name:string;text:string}[]=[],seen=new Set<string>();let remaining=6500;
  for(const {doc}of ranked){if(documents.length>=limit||remaining<160)break;if(seen.has(doc.text))continue;seen.add(doc.text);const text=doc.text.slice(0,Math.min(1600,remaining));documents.push({name:doc.name,text});remaining-=text.length;}
  return {documents,totalSources:this.cache.totalSources,projects:this.cache.projects};
 }
 private load(){
  const manifest=this.store.get('private.knowledge.index') as {shards?:unknown;totalSources?:unknown;projects?:unknown}|null;
  if(!manifest)return {chunks:[],totalSources:0,projects:[]};
  if(!Number.isInteger(manifest.shards)||Number(manifest.shards)<0||Number(manifest.shards)>100||!Array.isArray(manifest.projects)||manifest.projects.length>256||!manifest.projects.every(p=>typeof p==='string'&&p.length>0&&p.length<=200))throw Error('Project library index is invalid');
  const chunks:(KnowledgeDocument&{lower:string})[]=[];let totalSources=0,totalText=0;
  for(let index=0;index<Number(manifest.shards);index++){
   const records=this.store.get('private.knowledge.'+index);if(!Array.isArray(records))throw Error('Project library shard is unreadable');
   for(const doc of records){
    if(!doc||typeof doc.name!=='string'||doc.name.length>2048||typeof doc.text!=='string'||doc.text.length>250000||
      (doc.project!==undefined&&(typeof doc.project!=='string'||doc.project.length>200))||
      (doc.kind!==undefined&&(typeof doc.kind!=='string'||doc.kind.length>64)))throw Error('Project library source is invalid');
    totalSources++;totalText+=doc.text.length;
    if(totalSources>MAX_KNOWLEDGE_SOURCES||totalText>MAX_KNOWLEDGE_TEXT)throw Error('Project library exceeds its size limit');
    for(let offset=0;offset<doc.text.length;offset+=1600){const text=doc.text.slice(offset,offset+1600);chunks.push({name:doc.name,project:doc.project,kind:doc.kind,text,lower:text.toLowerCase()});}
   }
  }
  return {chunks,totalSources,projects:manifest.projects as string[]};
 }
}
