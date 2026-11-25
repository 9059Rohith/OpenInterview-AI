import {test} from 'node:test';
import assert from 'node:assert/strict';
import {audioInput,transcribeAudio} from '../src/speech.js';
const input={base64:Buffer.from('synthetic-audio-bytes-for-test-only').toString('base64'),mime:'audio/webm;codecs=opus',consent:true,requestId:'speech-test'};
test('transcription requires explicit consent and validates audio encoding and MIME',()=>{
  assert.throws(()=>audioInput({...input,consent:false}),/consent/);assert.throws(()=>audioInput({...input,mime:'application/octet-stream'}),/format/);assert.throws(()=>audioInput({...input,base64:'not base64'}),/encoding/);assert.throws(()=>audioInput({...input,base64:Buffer.from('tiny').toString('base64')}),/nonempty/);assert.equal(audioInput(input).extension,'webm');
});
test('audio goes only to OpenAI with in-memory multipart and no credential in audio metadata',async()=>{
  const response=await transcribeAudio(input,'synthetic-test-key',new AbortController().signal,(async(url,options)=>{assert.equal(url,'https://api.openai.com/v1/audio/transcriptions');assert.equal(options?.redirect,'error');assert.equal((options?.headers as Record<string,string>).Authorization,'Bearer synthetic-test-key');const form=options?.body as FormData;assert.equal(form.get('model'),'gpt-4o-mini-transcribe');const file=form.get('file') as File;assert.equal(file.name,'session-audio.webm');assert.equal(file.type,'audio/webm');return new Response(JSON.stringify({text:'Describe your project.'}));})as typeof fetch);assert.equal(response.text,'Describe your project.');assert.equal(response.requestId,'speech-test');
});
test('transcription cancellation reaches fetch and upstream errors are sanitized',async()=>{
  const controller=new AbortController();controller.abort();await assert.rejects(()=>transcribeAudio(input,'synthetic',controller.signal,(async(_url,options)=>{assert.equal(options?.signal?.aborted,true);throw new DOMException('Aborted','AbortError');})as typeof fetch),{name:'AbortError'});
  await assert.rejects(()=>transcribeAudio(input,'synthetic',new AbortController().signal,(async()=>new Response('secret-provider-body',{status:401}))as typeof fetch),/credentials/);
  await assert.rejects(()=>transcribeAudio(input,'synthetic',new AbortController().signal,(async()=>new Response('private-synthetic-audio-error'))as typeof fetch),{message:'Transcription returned an invalid JSON response'});
});
