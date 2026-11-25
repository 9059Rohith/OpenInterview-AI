export type AccountCapabilities={accounts?:boolean;cloudSync?:boolean;googleOAuth?:boolean;billing?:boolean;passwordRecovery?:boolean};

export function googleSignInStatus(apiUrl:string,capabilities:AccountCapabilities,loaded:boolean){
 if(!apiUrl)return 'Google sign-in is unavailable: cloud account services are not configured on this deployment.';
 if(!loaded)return 'Checking Google sign-in availability…';
 if(!capabilities.accounts)return 'Google sign-in is unavailable: persistent account storage is not configured on this server.';
 if(!capabilities.googleOAuth)return 'Google sign-in is unavailable: the server operator must configure Google OAuth credentials and its callback URL.';
 return '';
}

/** The API supplies a Google authorization URL, never executable content or a session token. */
export function googleAuthorizationUrl(value:unknown,apiUrl:string):string {
 const invalid=()=>new Error('The server returned an unsafe Google sign-in URL. Check the server OAuth configuration.');
 if(typeof value!=='string')throw invalid();
 let url:URL,callback:URL;
 try{url=new URL(value);callback=new URL(url.searchParams.get('redirect_uri')||'');}catch{throw invalid();}
 if(url.origin!=='https://accounts.google.com'||url.pathname!=='/o/oauth2/v2/auth'||url.username||url.password||url.hash)throw invalid();
 if(callback.origin!==new URL(apiUrl).origin||callback.pathname!=='/api/v1/auth/google/callback'||callback.search||callback.hash||callback.username||callback.password)throw invalid();
 if(url.searchParams.get('response_type')!=='code'||url.searchParams.get('code_challenge_method')!=='S256'||!url.searchParams.get('code_challenge')||!url.searchParams.get('state'))throw invalid();
 for(const name of ['access_token','id_token','refresh_token','client_secret','token'])if(url.searchParams.has(name))throw invalid();
 return url.href;
}
