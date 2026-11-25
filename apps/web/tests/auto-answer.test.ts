import {test} from 'node:test';
import assert from 'node:assert/strict';
import {AutoAnswerScheduler,AUTO_ANSWER_DELAY_MS,isInterviewQuestion} from '../lib/auto-answer';
const wait=(ms=15)=>new Promise(resolve=>setTimeout(resolve,ms));
const until=async(check:()=>boolean)=>{const deadline=Date.now()+1500;while(!check()&&Date.now()<deadline)await wait();assert.ok(check(),'asynchronous work completed');};
const final=(text:string,source:'PC'|'MIC'='PC')=>({text,source,isFinal:true});

test('detects normal questions, requests and short follow-ups, excludes statements and unfinished prefixes',()=>{
  for(const text of ['Why?','How so?','Trade-offs?','What about Redis?','Tell me about your project','Walk me through a request','Can you explain the cache','Design a queue','Compare SQL and NoSQL','क्या आप अपना प्रोजेक्ट समझा सकते हैं?'])assert.equal(isInterviewQuestion(text),true,text);
  for(const text of ['I used Redis for caching.','That was a useful question.','The interviewer asked how we scale.','Can you','Tell me about','What about',''])assert.equal(isInterviewQuestion(text),false,text);
});

test('queues computer questions received while active and serializes callbacks without loss',async()=>{
  let release!:()=>void;const gate=new Promise<void>(resolve=>release=resolve),asked:string[]=[],counts:number[]=[];let running=0,maxRunning=0;
  const scheduler=new AutoAnswerScheduler({delayMs:1,onQueueChange:count=>counts.push(count),onQuestion:async task=>{
    running++;maxRunning=Math.max(maxRunning,running);asked.push(task.question);if(asked.length===1)await gate;running--;
  }});
  scheduler.configure({enabled:true,sessionId:'a'});scheduler.push(final('Explain Redis caching'));await wait();
  scheduler.push(final('Why?'));scheduler.push(final('What about durability?'));await wait();
  assert.deepEqual(asked,['Explain Redis caching']);assert.equal(scheduler.pendingCount,2);
  release();await until(()=>asked.length===3);assert.deepEqual(asked,['Explain Redis caching','Why?','What about durability?']);assert.equal(maxRunning,1);assert.equal(counts.at(-1),0);scheduler.dispose();
});

test('manual busy holds questions; PC defaults exclude MIC, duplicate finals and partials',async()=>{
  const asked:string[]=[];const scheduler=new AutoAnswerScheduler({delayMs:1,onQuestion:async task=>{asked.push(task.question);}});
  scheduler.configure({enabled:true,sessionId:'a'});scheduler.setBusy(true);
  assert.equal(scheduler.push(final('Why?','MIC')),'ignored');
  assert.equal(scheduler.push({...final('Explain Redis'),isFinal:false}),'ignored');
  assert.equal(scheduler.push({...final('Explain Redis'),itemId:'1'}),'queued');
  assert.equal(scheduler.push({...final('Explain Redis.'),itemId:'1'}),'duplicate');
  assert.equal(scheduler.push(final('Explain Redis')),'duplicate');await wait();assert.deepEqual(asked,[]);
  scheduler.setBusy(false);await wait();assert.deepEqual(asked,['Explain Redis']);
  scheduler.configure({enabled:true,sessionId:'a',includeMic:true});scheduler.push(final('How so?','MIC'));await wait();assert.equal(asked.at(-1),'How so?');scheduler.dispose();
});

test('disable, stop/cancel, new session and disposal discard pending and abort active work',async()=>{
  for(const action of ['disable','cancel','session','dispose']){
    let signal:AbortSignal|undefined,release!:()=>void;const gate=new Promise<void>(resolve=>release=resolve),asked:string[]=[];
    const scheduler=new AutoAnswerScheduler({delayMs:1,onQuestion:async task=>{signal=task.signal;asked.push(task.question);await gate;}});
    scheduler.configure({enabled:true,sessionId:'a'});scheduler.push(final('Explain Redis'));await wait();scheduler.push(final('Why?'));
    if(action==='disable')scheduler.configure({enabled:false,sessionId:'a'});
    if(action==='cancel')scheduler.cancel();
    if(action==='session')scheduler.configure({enabled:true,sessionId:'b'});
    if(action==='dispose')scheduler.dispose();
    assert.equal(signal?.aborted,true,action);assert.equal(scheduler.pendingCount,0,action);release();await wait();assert.deepEqual(asked,['Explain Redis'],action);scheduler.dispose();
  }
});

test('session tags prevent stale finals, fragments accumulate, and queue capacity reports overflow visibly',async()=>{
  const asked:string[]=[],overflow:string[]=[];
  const scheduler=new AutoAnswerScheduler({delayMs:1,maxPending:2,onOverflow:question=>overflow.push(question),onQuestion:async task=>{asked.push(task.question);}});
  scheduler.configure({enabled:true,sessionId:'new'});scheduler.setBusy(true);
  assert.equal(scheduler.push({...final('Why?'),sessionId:'old'}),'ignored');
  assert.equal(scheduler.push(final('Can you')),'fragment');assert.equal(scheduler.push(final('explain your project')),'queued');
  scheduler.push(final('Why?'));assert.equal(scheduler.push(final('What about scaling?')),'full');
  assert.deepEqual(overflow,['What about scaling?']);scheduler.setBusy(false);await until(()=>asked.length===2);
  assert.deepEqual(asked,['Can you explain your project','Why?']);scheduler.dispose();
});

test('a new provider turn can repeat Why after a reply while duplicate finals of one turn are ignored',async()=>{
  const asked:string[]=[];
  const scheduler=new AutoAnswerScheduler({delayMs:1,onQuestion:async task=>{asked.push(task.question);}});
  scheduler.configure({enabled:true,sessionId:'a'});
  assert.equal(scheduler.push({...final('Why?'),itemId:'turn-1'}),'queued');
  await until(()=>asked.length===1);
  assert.equal(scheduler.push({...final('Why?'),itemId:'turn-1'}),'duplicate');
  assert.equal(scheduler.push({...final('Why?'),itemId:'turn-2'}),'queued');
  await until(()=>asked.length===2);
  assert.deepEqual(asked,['Why?','Why?']);scheduler.dispose();
});

test('default final-to-answer debounce is fast and starts without the old 900ms pause',async()=>{
  assert.ok(AUTO_ANSWER_DELAY_MS>=150&&AUTO_ANSWER_DELAY_MS<=250);
  let calledAt=0;const started=Date.now();
  const scheduler=new AutoAnswerScheduler({onQuestion:async()=>{calledAt=Date.now();}});
  scheduler.configure({enabled:true,sessionId:'a'});scheduler.push(final('Explain your project'));
  await wait(100);assert.equal(calledAt,0);await wait(180);assert.ok(calledAt-started>=150&&calledAt-started<500);scheduler.dispose();
});
