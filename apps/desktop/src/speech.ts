import {object,string,requestId} from './security.js';
const AUDIO_TYPES:Record<string,string>={'audio/webm':'webm','audio/wav':'wav','audio/x-wav':'wav','audio/ogg':'ogg','audio/mp4':'mp4','audio/mpeg':'mp3','audio/flac':'flac'};
export const MAX_AUDIO_BYTES=10*1024*1024;
export function audioInput(raw:unknown){
  const data=object(raw);if(data.consent!==true)throw new Error('Explicit consent to send audio to OpenAI is required');
  const mime=string(data.mime,100).split(';')[0].toLowerCase();if(!AUDIO_TYPES[mime])throw new Error('Unsupported audio format');
  const base64=string(data.base64,Math.ceil(MAX_AUDIO_BYTES*4/3)+8);
  if(base64.length%4!==0||!/^[A-Za-z0-9+/]+={0,2}$/.test(base64))throw new Error('Invalid audio encoding');
  const audio=Buffer.from(base64,'base64');if(audio.length<16||audio.length>MAX_AUDIO_BYTES||audio.toString('base64')!==base64)throw new Error('Audio must be nonempty and below 10 MB');
  const language=data.language===undefined?undefined:string(data.language,8);if(language&&!/^[a-z]{2}$/.test(language))throw new Error('Language must be a two-letter ISO code');
  return {audio,mime,extension:AUDIO_TYPES[mime],language,requestId:requestId(data.requestId)};
}
export async function transcribeAudio(raw:unknown,key:string,signal:AbortSignal,fetcher:typeof fetch=fetch){
  const data=audioInput(raw),started=Date.now();const form=new FormData();form.set('file',new Blob([new Uint8Array(data.audio)],{type:data.mime}),'session-audio.'+data.extension);form.set('model','gpt-4o-mini-transcribe');form.set('response_format','json');if(data.language)form.set('language',data.language);
  const response=await fetcher('https://api.openai.com/v1/audio/transcriptions',{method:'POST',headers:{Authorization:'Bearer '+key},body:form,signal,redirect:'error'});
  if(!response.ok){if(response.status===401||response.status===403)throw new Error('OpenAI transcription credentials or permissions rejected');if(response.status===429)throw new Error('OpenAI transcription rate limit or quota reached');throw new Error('Audio transcription failed (HTTP '+response.status+')');}
  const body=await response.text();if(body.length>1_000_000)throw new Error('Transcription response exceeded size limit');let result:{text?:unknown};try{result=JSON.parse(body);}catch{throw new Error('Transcription returned an invalid JSON response');}if(typeof result.text!=='string')throw new Error('Transcription returned no text');
  return {text:result.text,provider:'openai',model:'gpt-4o-mini-transcribe',requestId:data.requestId,elapsedMs:Date.now()-started};
}
