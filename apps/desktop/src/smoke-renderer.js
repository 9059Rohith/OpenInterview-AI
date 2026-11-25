(async () => {
  for(let i=0;i<50&&!document.getElementById('main-content');i++)await new Promise(resolve=>setTimeout(resolve,100));
  const bridge = window.openInterviewDesktop;
  let invalidIpcRejected = false;
  try { await bridge.providerRequest({provider:'unsupported',model:'bad',messages:[]}); }
  catch { invalidIpcRejected = true; }
  const key = 'smoke:' + Date.now();
  await bridge.storePut({key,value:{synthetic:'desktop-smoke-test'}});
  const stored = await bridge.storeGet({key});
  await bridge.storeDelete({key});
  const injected = document.createElement('script');
  injected.textContent = 'window.__untrustedInlineScriptRan=true';
  document.body.append(injected);
  injected.remove();
  let runnerSandboxPassed = false;
  let runnerOriginIsolated = false;
  try {
    const result = await new Promise((resolve,reject) => {
      const frame = document.createElement('iframe');
      frame.setAttribute('sandbox','allow-scripts');
      frame.style.display = 'none';
      const token = crypto.randomUUID();
      let timer;
      const cleanup = () => { clearTimeout(timer); window.removeEventListener('message',listener); frame.remove(); };
      const listener = event => {
        if (event.source !== frame.contentWindow || event.data?.token !== token) return;
        cleanup();
        resolve({passed:event.data.results?.[0]?.passed === true,isolated:event.origin === 'null'});
      };
      window.addEventListener('message',listener);
      frame.onload = () => frame.contentWindow.postMessage({token,
        code:`async function twoSum(){if(typeof window!=='undefined'||typeof require!=='undefined'||typeof process!=='undefined')throw Error('Unsafe globals');let blocked=false;try{await fetch('http://127.0.0.1:8000/health')}catch{blocked=true}if(!blocked)throw Error('Network must be blocked');return [0,1]}`,
        tests:[{nums:[2,7],target:9,expected:[0,1]}]
      },'*');
      frame.src = '/runner.html';
      document.body.append(frame);
      timer = setTimeout(() => { cleanup(); reject(Error('Runner smoke timeout')); },5000);
    });
    runnerSandboxPassed = result.passed;
    runnerOriginIsolated = result.isolated;
  } catch { /* The result reports a failed runner without logging private content. */ }
  let localAiPassed = null, localAiCancellationPassed = null, localAiStreamEvents = 0;
  if (window.__smokeLocalAi) {
    try {
      const models = await bridge.ollamaModels();
      const model = models.find(item => item.name === 'qwen2.5:0.5b')?.name;
      if (!model) throw Error('Install qwen2.5:0.5b explicitly before the local AI smoke test');
      const requestId = 'smoke-local-' + Date.now();
      const dispose = bridge.onEvent(event => {if(event.type === 'provider-chunk' && event.requestId === requestId)localAiStreamEvents++;});
      try {
        const response = await bridge.ollamaGenerate({model,prompt:'What does FIFO stand for? Answer in one short sentence.',requestId});
        localAiPassed = Boolean(response.text?.trim()) && localAiStreamEvents > 0;
      } finally {dispose();}
      const cancelId = requestId + '-cancel';
      let cancelPromise, rejected = false;
      const stopListening = bridge.onEvent(event => {
        if(event.type === 'provider-chunk' && event.requestId === cancelId && !cancelPromise)cancelPromise = bridge.cancelRequest({requestId:cancelId});
      });
      try {
        await bridge.providerRequest({provider:'ollama',model,requestId:cancelId,maxTokens:256,messages:[{role:'user',content:'Explain queues in detail, with several examples and tradeoffs.'}]});
      } catch(error) {rejected = /cancelled|timed out/i.test(error.message);}
      finally {stopListening();}
      localAiCancellationPassed = rejected && Boolean((await cancelPromise)?.cancelled);
    } catch {localAiPassed = false;localAiCancellationPassed = false;}
  }
  let cloudAiPassed = null, cloudAiStreamEvents = 0, cloudAiElapsedMs = null;
  if(window.__smokeCloudAi){
    const requestId = 'smoke-cloud-' + Date.now();
    const dispose = bridge.onEvent(event=>{if(event.type==='provider-chunk'&&event.requestId===requestId)cloudAiStreamEvents++;});
    try{
      const response=await bridge.providerRequest({provider:'openai',model:'gpt-4.1-mini',requestId,maxTokens:64,messages:[{role:'user',content:'What does FIFO stand for? Reply in one short sentence.'}]});
      cloudAiPassed=Boolean(response.text?.trim())&&cloudAiStreamEvents>0;cloudAiElapsedMs=response.elapsedMs;
    }catch{cloudAiPassed=false;}finally{dispose();}
  }
  let visionPassed=null,visionElapsedMs=null;
  if(window.__smokeVision){
    try{
      const canvas=document.createElement('canvas');canvas.width=640;canvas.height=240;
      const context=canvas.getContext('2d');context.fillStyle='white';context.fillRect(0,0,640,240);context.fillStyle='black';context.font='bold 42px monospace';context.fillText('OPENINTERVIEW FIFO 42',40,130);
      const result=await bridge.visionRequest({provider:'openai',model:'gpt-4.1-mini',dataUrl:canvas.toDataURL('image/png'),prompt:'Extract only the exact text visible in this synthetic test image.',consent:true,requestId:'smoke-vision-'+Date.now()});
      visionPassed=result.aiGenerated===true&&/FIFO/i.test(result.text)&&/42/.test(result.text);visionElapsedMs=result.elapsedMs;
    }catch{visionPassed=false;}
  }
  return {
    title:document.title,bridge:typeof bridge?.providerRequest === 'function',
    capabilities:await bridge.getCapabilities(),node:typeof require,sandbox:typeof process,
    invalidIpcRejected,sqliteRoundtrip:stored?.synthetic === 'desktop-smoke-test',
    invalidInlineScriptBlocked:!window.__untrustedInlineScriptRan,
    runnerSandboxPassed,runnerOriginIsolated,bodyLength:document.body.innerText.length
    ,workspaceHydrated:Boolean(document.getElementById('main-content')),
    localAiPassed,localAiStreamEvents,localAiCancellationPassed,cloudAiPassed,cloudAiStreamEvents,cloudAiElapsedMs,visionPassed,visionElapsedMs
  };
})();
