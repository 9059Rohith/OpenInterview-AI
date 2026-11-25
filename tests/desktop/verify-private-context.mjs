import {_electron as electron} from '@playwright/test';import path from 'node:path';import {writeFile} from 'node:fs/promises';import assert from 'node:assert/strict';
// Read-only private-data checks: only counts, provider names and source IDs are
// returned. No resume, transcript or project source is uploaded by this test.
const app=await electron.launch({executablePath:path.join(process.env.LOCALAPPDATA,'Programs/OpenInterview AI/OpenInterview AI.exe'),args:[],timeout:45000});
const expectedVersion=JSON.parse(await (await import('node:fs/promises')).readFile('apps/desktop/package.json','utf8')).version;
try{
 const page=await app.firstWindow();await page.getByRole('heading',{name:'Make your next interview your best one.'}).waitFor();
 const result=await page.evaluate(async()=>{
  const bridge=window.openInterviewDesktop,data=await bridge.storeGet({key:'workspace'}),retrieved=await bridge.retrieveKnowledge({query:'Explain project architecture, retries, agents and matching',limit:6}),vault=await bridge.vaultStatus();
  return {version:bridge.version,resumeCharacters:data.profile.resumeText.length,documents:data.documents.length,sessions:data.sessions.length,previousAnswers:data.sessions.reduce((n,s)=>n+s.turns.filter(t=>t.speaker==='assistant').length,0),projectSources:retrieved.totalSources,projects:retrieved.projects,retrievedPassages:retrieved.documents.length,retrievedCharacters:retrieved.documents.reduce((n,d)=>n+d.text.length,0),settings:data.shadowSettings,provider:data.provider.provider,model:data.provider.model,providerKeyAvailable:vault.configured.includes('openai')};
 });
 assert.equal(result.version,expectedVersion);assert(result.resumeCharacters>2500&&result.projectSources>2000&&result.previousAnswers>0&&result.retrievedPassages>0);assert(result.retrievedCharacters<=6500);assert.deepEqual(result.settings,{autoAnswer:true,useContext:true,remember:true});assert.equal(result.provider,'openai');assert(result.providerKeyAvailable);
 await writeFile('.local/private-context-verification.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));console.log('PASS: installed automatic-answer build has encrypted resume, project corpus and previous responses, with a configured fast provider');
}finally{await app.close();}
