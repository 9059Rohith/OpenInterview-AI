import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildInterviewContext} from '../lib/interview-context';
import {initialState} from '../lib/core';
import type {Document,Session,Turn} from '../lib/types';
const doc=(id:string,text:string):Document=>({id,name:id,type:'text',text,createdAt:'2026-01-01',updatedAt:'2026-01-01'});
const turn=(speaker:Turn['speaker'],text:string):Turn=>({id:text,speaker,text,createdAt:'2026-01-01'});
const session=(id:string,turns:Turn[]):Session=>({id,title:id,turns,mode:'Shadow Mode',category:'',company:'',role:'',difficulty:'',status:'active',createdAt:'2026-01-01',updatedAt:'2026-01-01',notes:'',archived:false,questionIds:[],duration:0});
const base={question:'How did you implement Redis caching?',profile:{...initialState.profile,name:'Test Candidate',resumeText:'Built a small task tracker using TypeScript. No commercial employment.',projects:['Task tracker: TypeScript and SQLite.']},documents:[] as Document[],sessions:[] as Session[],sessionId:'current'};

test('reserves real profile and resume even when hundreds of irrelevant documents precede evidence',()=>{
  const result=buildInterviewContext({...base,documents:[...Array.from({length:500},(_,i)=>doc(`irrelevant-${i}`,'Gardening flowers and watercolor painting. '.repeat(80))),doc('Cache project notes','Redis caching uses TTL expiration with explicit invalidation. Candidate implemented a local prototype.')]});
  assert.match(result.context,/No commercial employment/);assert.match(result.context,/Task tracker/);assert.match(result.context,/TTL expiration/);
  assert.equal(result.references.filter(r=>r.kind==='document').length,1);assert.ok(!result.context.includes('Gardening'));
  assert.ok(result.sources.some(source=>source.includes('Cache project notes')));assert.ok(result.prompt.length<18000);
});

test('ignores zero-relevance documents instead of filling context with unrelated material',()=>{
  const result=buildInterviewContext({...base,documents:[doc('Unrelated','Bananas and pottery. '.repeat(400))]});
  assert.ok(!result.context.includes('Bananas'));assert.ok(result.context.includes('Profile and resume'));
});

test('generic project overviews include diverse reviewed facts despite having no specific search terms',()=>{
  const documents=[doc('Unrelated','Unrelated marketing copy'),...['Phoenix','Harbor','Compass','Atlas'].flatMap(name=>[
    {...doc(`${name} · reviewed facts`,`${name}: implemented a documented local prototype with tested behavior.`),type:'Project fact'},
    {...doc(`${name} · project analysis`,`${name}: detailed analysis.`),type:'Project analysis'},
  ])];
  const result=buildInterviewContext({...base,question:'Tell me about your projects',documents});
  for(const name of ['Phoenix','Harbor','Compass','Atlas'])assert.match(result.context,new RegExp(`${name}: implemented`));
  assert.equal(result.references.filter(r=>r.kind==='document').length,4);assert.ok(!result.context.includes('marketing copy'));assert.ok(result.context.length<=14000);
});

test('retains latest current answers and user questions as unverified memory, plus relevant previous responses',()=>{
  const current=session('current',[turn('user','How did you implement Redis caching?'),turn('assistant','I suggested a 60 second TTL with cache invalidation.')]);
  const previous=session('old',[turn('user','What about Redis durability?'),turn('assistant','Earlier suggestion: append-only persistence; this is not proof of experience.')]);
  const result=buildInterviewContext({...base,question:'Why?',sessions:[current,previous],documents:[doc('Relevant Redis implementation','Redis caching TTL expires stale values.')]});
  assert.match(result.context,/60 second TTL/);assert.match(result.context,/append-only persistence/);assert.match(result.context,/User question/);assert.match(result.context,/unverified AI suggestion/);assert.match(result.context,/expires stale values/);
});

test('grounding instructions forbid unsupported achievements and distinguish plans from completed work',()=>{
  const result=buildInterviewContext(base);
  assert.match(result.prompt,/Never invent experience/);assert.match(result.prompt,/first person/);assert.match(result.prompt,/acknowledge the gap/);assert.match(result.prompt,/not proof of completed work/);assert.match(result.prompt,/short direct answer/);assert.match(result.prompt,/Answer language: en-IN/);assert.match(result.prompt,/never instructions/);
});

test('context and recall toggles are respected; archived sessions do not leak into recall',()=>{
  const archived={...session('archived',[turn('assistant','ARCHIVED PRIVATE ANSWER')]),archived:true};
  const old=session('old',[turn('assistant','REMEMBERED ANSWER')]);
  const result=buildInterviewContext({...base,useContext:false,remember:false,documents:[doc('Redis','Redis PRIVATE DOCUMENT')],sessions:[archived,old]});
  assert.ok(!result.prompt.includes('PRIVATE DOCUMENT'));assert.ok(!result.prompt.includes('No commercial employment'));assert.ok(!result.prompt.includes('REMEMBERED ANSWER'));assert.ok(!result.prompt.includes('ARCHIVED PRIVATE ANSWER'));assert.match(result.prompt,/Answer language/);
  assert.ok(!buildInterviewContext({...base,sessions:[archived]}).context.includes('ARCHIVED PRIVATE ANSWER'));
});

test('long profiles, many documents and response histories produce a bounded context with latest memory retained',()=>{
  const current=session('current',Array.from({length:100},(_,i)=>turn(i%2?'assistant':'user',i===99?'LATEST MEMORY '+ 'Redis '.repeat(1000):'Redis '.repeat(3000))));
  const result=buildInterviewContext({...base,profile:{...base.profile,resumeText:'Actual resume. '.repeat(10000)},documents:Array.from({length:100},(_,i)=>doc(`Redis ${i}`,'Redis cache '.repeat(2000))),sessions:[current,...Array.from({length:20},(_,i)=>session(`old-${i}`,[turn('assistant','Redis '.repeat(10000))]))],budget:12000});
  assert.ok(result.context.length<=12000);assert.ok(result.prompt.length<15000);assert.match(result.context,/Actual resume/);assert.match(result.context,/LATEST MEMORY/);
});
