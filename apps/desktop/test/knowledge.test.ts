import {test} from 'node:test';import assert from 'node:assert/strict';import {PrivateKnowledge,MAX_KNOWLEDGE_SOURCES,MAX_KNOWLEDGE_TEXT} from '../src/knowledge.js';
test('private project retrieval selects evidence with source provenance and bounds model input',()=>{
 const rows=new Map<string,unknown>([['private.knowledge.index',{shards:1,projects:['Queue','Weather']}],['private.knowledge.0',[{name:'Queue · reviewed facts · https://example.invalid/code @ abc',kind:'fact',text:'Queue retries use idempotency keys. '+ 'x'.repeat(3000)},{name:'Weather chart',text:'Temperature forecasting unrelated.'}]]]);
 let reads=0;const library=new PrivateKnowledge({get:key=>{reads++;return rows.get(String(key))??null;}});const result=library.query('How do queue retries avoid duplicate work?');assert(result.documents[0].name.includes('abc'));assert(result.documents[0].text.includes('idempotency'));assert(!result.documents.some(d=>d.name==='Weather chart'));assert(result.documents.reduce((sum,d)=>sum+d.text.length,0)<=6500);assert.equal(result.totalSources,2);const count=reads;library.query('Why retries?');assert.equal(reads,count);
});
test('missing corpus is empty and corrupted shards fail explicitly',()=>{assert.equal(new PrivateKnowledge({get:()=>null}).query('A project').totalSources,0);const broken=new PrivateKnowledge({get:key=>key==='private.knowledge.index'?{shards:1,projects:[]}:null});assert.throws(()=>broken.query('Queue'));assert.throws(()=>broken.query('',6));assert.throws(()=>broken.query('Queue',100));});

test('retrieval rejects invalid query limits and oversized or malformed library metadata',()=>{
 const library=(doc:unknown,projects:unknown=[])=>new PrivateKnowledge({get:key=>key==='private.knowledge.index'?{shards:1,projects}:[doc]});
 for(const limit of [0,-1,13,1.5,NaN,Infinity])assert.throws(()=>library({name:'Queue',text:'Retries'}).query('Queue',limit));
 for(const doc of [{name:'x'.repeat(2049),text:'Queue'},{name:'Queue',text:'Queue',project:{}},{name:'Queue',text:'Queue',kind:[]}, {name:'Queue',text:'Queue',project:'x'.repeat(201)}])assert.throws(()=>library(doc).query('Queue'),/source is invalid/);
 assert.throws(()=>library({name:'Queue',text:'Queue'},['x'.repeat(201)]).query('Queue'),/index is invalid/);
 assert.throws(()=>library({name:'Queue',text:'Queue'},Array(257).fill('Queue')).query('Queue'),/index is invalid/);
});

test('library aggregate size and source count are bounded before loading later shards',()=>{
 let reads=0;
 const text='x'.repeat(250_000),perShard=16;
 const shards=Math.floor(MAX_KNOWLEDGE_TEXT/(text.length*perShard))+2;
 const large=new PrivateKnowledge({get:key=>{reads++;return key==='private.knowledge.index'?{shards,projects:[]}:Array(perShard).fill({name:'Queue',text});}});
 assert.throws(()=>large.query('Queue'),/size limit/);
 assert(reads<=shards,'the remaining shards should not be read after the size cap');
 const many=new PrivateKnowledge({get:key=>key==='private.knowledge.index'?{shards:1,projects:[]}:Array(MAX_KNOWLEDGE_SOURCES+1).fill({name:'Queue',text:''})});
 assert.throws(()=>many.query('Queue'),/size limit/);
});
