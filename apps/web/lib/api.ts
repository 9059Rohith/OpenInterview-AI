export const API=process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/,'')||'';
let csrf='';
export async function api<T=Record<string,unknown>>(path:string,options:RequestInit={}):Promise<T>{
 if(!API)throw Error('Cloud services are not configured. Your local workspace is fully available.');
 const mutation=options.method&&!['GET','HEAD'].includes(options.method);const multipart=typeof FormData!=='undefined'&&options.body instanceof FormData;const headers:Record<string,string>={...(!multipart?{'Content-Type':'application/json'}:{}),...(options.headers as Record<string,string>||{})};
 if(mutation&&!/\/auth\/(login|register|recovery)/.test(path)){if(!csrf){const r=await fetch(`${API}/api/v1/auth/csrf`,{credentials:'include'});if(r.ok)csrf=(await r.json()).csrfToken||'';}if(csrf)headers['x-csrf-token']=csrf;}
 const response=await fetch(`${API}/api/v1${path}`,{...options,headers,credentials:'include',signal:options.signal||AbortSignal.timeout(20000)});let data;try{data=await response.json();}catch{throw Error(`Cloud service returned ${response.status}.`);}if(!response.ok)throw Error(typeof data.detail==='string'?data.detail:JSON.stringify(data.detail||data.error||`Request failed (${response.status})`));if(data.csrfToken)csrf=data.csrfToken;return data;
}
export function forgetCloudSession(){csrf='';}
