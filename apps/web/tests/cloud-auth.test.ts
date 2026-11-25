import test from 'node:test';
import assert from 'node:assert/strict';
import {googleAuthorizationUrl,googleSignInStatus} from '../lib/cloud-auth';

const api='https://api.example.test';
function authorization(){const url=new URL('https://accounts.google.com/o/oauth2/v2/auth');for(const [key,value] of Object.entries({client_id:'synthetic-client',redirect_uri:`${api}/api/v1/auth/google/callback`,response_type:'code',state:'synthetic-one-use-state',code_challenge:'synthetic-pkce-challenge',code_challenge_method:'S256'}))url.searchParams.set(key,value);return url;}

test('Google readiness distinguishes API, storage, OAuth and loading states',()=>{
 assert.match(googleSignInStatus('',{},false),/cloud account services/);
 assert.match(googleSignInStatus(api,{},false),/Checking/);
 assert.match(googleSignInStatus(api,{accounts:false,googleOAuth:true},true),/persistent account storage/);
 assert.match(googleSignInStatus(api,{accounts:true,googleOAuth:false},true),/OAuth credentials/);
 assert.equal(googleSignInStatus(api,{accounts:true,googleOAuth:true},true),'');
});

test('Google sign-in accepts only the real authorization host and configured API callback',()=>{
 assert.equal(googleAuthorizationUrl(authorization().href,api),authorization().href);
 for(const value of ['javascript:alert(1)','https://accounts.google.com.attacker.test/o/oauth2/v2/auth','https://accounts.google.com@attacker.test/',null])assert.throws(()=>googleAuthorizationUrl(value,api),/unsafe/);
 for(const change of [(u:URL)=>u.protocol='http:',(u:URL)=>u.pathname='/logout',(u:URL)=>u.hash='token',(u:URL)=>u.searchParams.set('redirect_uri','https://attacker.test/api/v1/auth/google/callback'),(u:URL)=>u.searchParams.set('redirect_uri',`${api}/api/v1/auth/google/callback?token=secret`),(u:URL)=>u.searchParams.set('code_challenge_method','plain'),(u:URL)=>u.searchParams.delete('state'),(u:URL)=>u.searchParams.set('client_secret','synthetic-private-value'),(u:URL)=>u.searchParams.set('access_token','synthetic-private-value')]){const url=authorization();change(url);assert.throws(()=>googleAuthorizationUrl(url.href,api),/unsafe/);}
});
