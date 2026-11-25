export const AUTO_ANSWER_DELAY_MS = 180;
export type AudioQuestionSource = 'PC' | 'MIC';
export interface AutoQuestion { question:string; sessionId:string; source:AudioQuestionSource; signal:AbortSignal }
export interface AutoTranscript { text:string; source:AudioQuestionSource; isFinal:boolean; itemId?:string; sessionId?:string }
export interface AutoAnswerOptions {
  onQuestion:(question:AutoQuestion)=>Promise<unknown>;
  onDetected?:(question:string)=>void;
  onError?:(error:unknown)=>void;
  onOverflow?:(question:string)=>void;
  onQueueChange?:(count:number)=>void;
  delayMs?:number;
  maxPending?:number;
}
const normalize=(text:string)=>text.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const incomplete = /^(?:(?:so|and|then|okay|ok)\s+)?(?:can you|could you|would you|will you|do you|have you|tell me(?: about)?|walk me(?: through)?|what(?: about| is| are| was| were| do you| would you| did you)?|how(?: do you| would you| did you| does)?|explain(?: to me)?|describe|compare|give me(?: an example of)?)\s*$/i;

/** Deliberately accepts short interview follow-ups, but never interprets a statement as a question just because it mentions one. */
export function isInterviewQuestion(value:string):boolean {
  const text=value.trim();
  if(!text||incomplete.test(text.replace(/[?.!,]+$/,'')))return false;
  if(/^(?:why|how so|why not|trade[ -]?offs?|alternatives?|limitations?|any examples?|anything else|and then)\s*[?.!]*$/i.test(text))return true;
  if(/[?？]/.test(text))return true;
  return /^(?:(?:so|and|then|okay|ok|now|also|please)\s*[,.:]?\s+)*(?:(?:how|why|what|when|where|which|who|whose)\b|(?:can|could|would|will|do|does|did|have|has|are|is|should)\s+(?:you|your|we|the|a|it|this|that)\b|tell me\b|walk (?:me|us) through\b|explain\b|describe\b|compare\b|design\b|implement\b|solve\b|write\b|give (?:me|us)\b|talk (?:me|us) through\b|(?:i'd|i would) like you to\b|let['’]s (?:discuss|talk about)\b|क्या|कैसे|क्यों|कब|बताइए|समझाइए|kya\b|kaise\b|kyun\b)/i.test(text);
}

/** Final transcripts enter a bounded FIFO. A busy answer holds the queue; it never consumes a question. */
export class AutoAnswerScheduler {
  private config={enabled:false,sessionId:'',includeMic:false};
  private queue:Array<{question:string;sessionId:string;source:AudioQuestionSource;readyAt:number}>=[];
  private seen=new Map<string,number>();
  private fragments=new Map<AudioQuestionSource,{text:string;at:number}>();
  private timer:ReturnType<typeof setTimeout>|null=null;
  private active:AbortController|null=null;
  private busy=false;
  private disposed=false;
  private epoch=0;
  readonly delayMs:number;
  readonly maxPending:number;
  constructor(private options:AutoAnswerOptions){
    this.delayMs=Math.max(0,options.delayMs??AUTO_ANSWER_DELAY_MS);
    this.maxPending=Math.max(1,options.maxPending??16);
  }
  get pendingCount(){return this.queue.length;}
  configure(config:{enabled:boolean;sessionId:string;includeMic?:boolean}){
    const next={...config,includeMic:config.includeMic??false};
    if(!next.enabled||next.sessionId!==this.config.sessionId||next.includeMic!==this.config.includeMic)this.cancel();
    this.config=next;this.schedule();
  }
  setBusy(busy:boolean){this.busy=busy;if(!busy)this.schedule();}
  notifyIdle(){this.setBusy(false);}
  push(event:AutoTranscript):'ignored'|'fragment'|'duplicate'|'queued'|'full'{
    if(this.disposed||!this.config.enabled||!this.config.sessionId||!event.isFinal||(event.sessionId&&event.sessionId!==this.config.sessionId)||(event.source==='MIC'&&!this.config.includeMic))return 'ignored';
    let text=event.text.trim().slice(0,6000);if(!text)return 'ignored';
    const at=Date.now(),prior=this.fragments.get(event.source);
    this.fragments.delete(event.source);
    if(prior&&at-prior.at<8000)text=`${prior.text} ${text}`.slice(0,6000);
    if(incomplete.test(text.replace(/[?.!,]+$/,''))){this.fragments.set(event.source,{text:text.slice(0,320),at});return 'fragment';}
    if(!isInterviewQuestion(text))return 'ignored';
    for(const [key,time] of this.seen)if(at-time>30000)this.seen.delete(key);
    const key=`${event.source}:${normalize(text)}`,item=event.itemId?`${event.source}:item:${event.itemId}`:'';
    // Provider turn IDs distinguish a repeated follow-up from a repeated final.
    // Without IDs, suppress only a brief echo rather than a legitimate later question.
    if(item?this.seen.has(item):at-(this.seen.get(key)??-Infinity)<=2000)return 'duplicate';
    if(this.queue.length>=this.maxPending){this.options.onOverflow?.(text);return 'full';}
    this.seen.set(key,at);if(item)this.seen.set(item,at);
    while(this.seen.size>256)this.seen.delete(this.seen.keys().next().value!);
    this.queue.push({question:text,source:event.source,sessionId:this.config.sessionId,readyAt:at+this.delayMs});
    this.options.onQueueChange?.(this.queue.length);
    this.options.onDetected?.(text);this.schedule();return 'queued';
  }
  cancel(){
    this.epoch++;this.queue=[];this.seen.clear();this.fragments.clear();
    this.options.onQueueChange?.(0);
    if(this.timer)clearTimeout(this.timer);this.timer=null;this.active?.abort();
  }
  dispose(){this.disposed=true;this.cancel();}
  private schedule(){
    if(this.disposed||!this.config.enabled||this.active||this.busy||this.timer||!this.queue.length)return;
    this.timer=setTimeout(()=>{this.timer=null;void this.drain();},Math.max(0,this.queue[0].readyAt-Date.now()));
  }
  private async drain(){
    if(this.disposed||!this.config.enabled||this.active||this.busy)return;
    const entry=this.queue.shift();if(!entry)return;
    this.options.onQueueChange?.(this.queue.length);
    if(entry.sessionId!==this.config.sessionId){this.schedule();return;}
    const controller=new AbortController(),epoch=this.epoch;this.active=controller;
    try{await this.options.onQuestion({...entry,signal:controller.signal});}
    catch(error){if(!controller.signal.aborted&&epoch===this.epoch)this.options.onError?.(error);}
    finally{if(this.active===controller)this.active=null;this.schedule();}
  }
}
