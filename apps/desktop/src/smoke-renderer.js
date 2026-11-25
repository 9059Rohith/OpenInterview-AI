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
  return {
    title:document.title,bridge:typeof bridge?.providerRequest === 'function',
    capabilities:await bridge.getCapabilities(),node:typeof require,sandbox:typeof process,
    invalidIpcRejected,sqliteRoundtrip:stored?.synthetic === 'desktop-smoke-test',
    invalidInlineScriptBlocked:!window.__untrustedInlineScriptRan,
    runnerSandboxPassed,runnerOriginIsolated,bodyLength:document.body.innerText.length
    ,workspaceHydrated:Boolean(document.getElementById('main-content'))
  };
})();
