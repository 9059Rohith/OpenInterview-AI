import type { AppState, Evaluation, Profile, Question, Session } from './types';
export const uid = () => globalThis.crypto?.randomUUID?.() ?? `local-${Date.now()}-${Math.random().toString(16).slice(2)}`;
export const now = () => new Date().toISOString();
export const initialProfile:Profile = {id:'local-profile',name:'',role:'Software engineer',experience:'Student / fresher',language:'en-IN',companies:[],skills:[],education:[],projects:[],employment:[],resumeText:'',consentCloud:false,onboarded:false};
export const initialState:AppState = {profile:initialProfile,documents:[],sessions:[],questions:[],bookmarks:[],practiced:[],reported:[],roadmaps:[],versions:[],flashcards:[],provider:{provider:'openai',model:'gpt-4.1-mini',baseUrl:'',configured:false},theme:'dark',fontSize:15,reducedMotion:false,design:{diagram:'flowchart LR\n  Client --> API[API gateway]\n  API --> Queue[Durable queue]\n  Queue --> Worker[Delivery worker]\n  Worker --> Provider[Channel provider]\n  API --> DB[(Delivery status)]\n  Worker --> DB',notes:'',requirements:''},code:'function twoSum(nums, target) {\n  const seen = new Map();\n  for (let i = 0; i < nums.length; i++) {\n    const need = target - nums[i];\n    if (seen.has(need)) return [seen.get(need), i];\n    seen.set(nums[i], i);\n  }\n  return [];\n}',codeLanguage:'javascript',focus:[]};
export function evaluateAnswer(answer:string,question:Question):Evaluation {
 const words=answer.trim().split(/\s+/).filter(Boolean).length;
 const normalized=answer.toLowerCase();
 const concepts=question.expectedConcepts.filter(c=>normalized.includes(c.toLowerCase()));
 const missing=question.expectedConcepts.filter(c=>!concepts.includes(c));
 const coverage=Math.round(concepts.length/Math.max(1,question.expectedConcepts.length)*50);
 const depth=Math.min(20,Math.floor(words/5));
 const structure=/(first|then|because|however|result|for example|trade.off|finally)/i.test(answer)?15:0;
 const example=/(for example|such as|project|\d+|experience)/i.test(answer)?15:0;
 const score=Math.min(100,coverage+depth+structure+example);
 const feedback=[`${concepts.length} of ${question.expectedConcepts.length} expected terms mentioned. Keyword matching does not verify factual correctness.`,words<45?'Add a concrete explanation and a real example; aim for enough detail to support your reasoning.':'Review the explanation for factual accuracy and concise wording.',missing.length?`Consider discussing: ${missing.join(', ')}.`:'You mentioned all expected terms. Explain how they relate and discuss trade-offs.',!structure?'Make the reasoning easy to follow: establish context, explain a decision and close with the outcome.':'A structure cue was detected. Check that your reasoning follows that structure.'];
 return {score,concepts,missing,feedback,words,kind:'Deterministic rubric',improved:question.sampleAnswer};
}
export function parseResume(text:string):Partial<Profile> {
 const lines=text.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
 const known=['JavaScript','TypeScript','Python','Java','React','Next.js','Node.js','SQL','PostgreSQL','MongoDB','Docker','Kubernetes','AWS','Azure','Git','C++','C#','HTML','CSS','TensorFlow','PyTorch','Figma','Excel','Go','Rust','Redis','Linux'];
 const skills=known.filter(s=>new RegExp(`(^|[^a-z])${s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}([^a-z]|$)`,'i').test(text));
 const section=(labels:string[])=>{const start=lines.findIndex(l=>labels.some(k=>new RegExp(`^${k}[:\\s]*$`,'i').test(l)));if(start<0)return [];const out:string[]=[];for(let i=start+1;i<lines.length&&out.length<12;i++){if(/^(education|experience|projects|skills|summary|certifications|employment|interests|achievements)[:\s]*$/i.test(lines[i]))break;out.push(lines[i]);}return out;};
 return {resumeText:text,skills,education:section(['education','academic qualifications']),projects:section(['projects','personal projects']),employment:section(['experience','work experience','employment'])};
}
export function resumeAudit(text:string,jobDescription='') {
 const lines=text.split('\n').map(s=>s.trim()).filter(Boolean);
 const bulletLines=lines.filter(l=>/^[•*\-]/.test(l));
 const quantified=bulletLines.filter(l=>/\d/.test(l)).length;
 const sections=['experience','education','skills','projects'].map(name=>({name,found:new RegExp(name,'i').test(text)}));
 const jobWords=[...new Set(jobDescription.toLowerCase().match(/[a-z][a-z+#.]{2,}/g)||[])].filter(w=>!['the','and','with','for','you','our','will','are','have','from','that','this','your','work'].includes(w));
 const matched=jobWords.filter(w=>text.toLowerCase().includes(w));
 return {words:text.trim()?text.trim().split(/\s+/).length:0,sections,bullets:bulletLines.length,quantified,matched,missing:jobWords.filter(w=>!matched.includes(w)),match:jobWords.length?Math.round(matched.length/jobWords.length*100):null};
}
export function createSession(input:Partial<Session>,question:Question):Session {
 return {id:uid(),title:`${input.category||question.topic} practice`,mode:'Light Mode',category:question.topic,company:'Any company',role:'Software engineer',difficulty:question.difficulty,status:'active',createdAt:now(),updatedAt:now(),turns:[{id:uid(),speaker:'assistant',text:question.question,createdAt:now()}],notes:'',archived:false,questionIds:[question.id],duration:20,...input};
}
export function sessionMarkdown(session:Session) {return `# ${session.title}\n\n${session.mode} · ${session.category} · ${new Date(session.createdAt).toLocaleString()}\n\n${session.turns.map(t=>`## ${t.speaker}\n\n${t.text}${t.evaluation?`\n\n${t.evaluation.kind}: ${t.evaluation.score}/100\n${t.evaluation.feedback.join('\n')}`:''}`).join('\n\n')}\n\n## Notes\n\n${session.notes}`;}
export function dateLabel(date:string){return new Date(date).toLocaleDateString(undefined,{month:'short',day:'numeric'});}
export function selectContext(query:string,documents:{name:string;text:string}[],budget=6000){const words=query.toLowerCase().split(/\W+/).filter(w=>w.length>3);const chunks=documents.flatMap(d=>(d.text.match(/[\s\S]{1,1400}/g)||[]).map((text,index)=>({name:d.name,index,text,rank:words.reduce((n,w)=>n+(text.toLowerCase().includes(w)?1:0),0)})));const seen=new Set<string>();let length=0;return chunks.sort((a,b)=>b.rank-a.rank).filter(c=>{if(seen.has(c.text)||length+c.text.length>budget)return false;seen.add(c.text);length+=c.text.length;return true;});}
