import {test,expect,type Page} from '@playwright/test';

// Set E2E_ACCOUNT_API to the same NEXT_PUBLIC_API_URL used by the test server.
const api=process.env.E2E_ACCOUNT_API||'http://localhost:4175';
async function mockAccount(page:Page,capabilities:Record<string,boolean>,signedIn=false){
 await page.route(`${api}/api/v1/**`,async route=>{
  const path=new URL(route.request().url()).pathname;
  if(path.endsWith('/capabilities'))return route.fulfill({json:capabilities});
  if(path.endsWith('/auth/me'))return route.fulfill({status:signedIn?200:401,json:signedIn?{id:'synthetic-account',name:'Synthetic account',email:'synthetic@example.test'}:{detail:'Sign in required'}});
  return route.fulfill({status:404,json:{detail:'Synthetic route not configured'}});
 });
}

test('Google remains visible with an honest storage configuration blocker',async({page})=>{
 test.skip(!process.env.E2E_ACCOUNT_API,'Requires the synthetic account API build configuration.');
 await mockAccount(page,{accounts:false,googleOAuth:false});await page.goto('/login/');
 await expect(page.getByRole('button',{name:'Continue with Google'})).toBeVisible();
 await expect(page.getByRole('button',{name:'Continue with Google'})).toBeDisabled();
 await expect(page.locator('#google-sign-in-status')).toContainText('persistent account storage');
});

test('Google readiness navigates only to the official authorization page',async({page})=>{
 test.skip(!process.env.E2E_ACCOUNT_API,'Requires the synthetic account API build configuration.');
 await mockAccount(page,{accounts:true,googleOAuth:true});
 const url=new URL('https://accounts.google.com/o/oauth2/v2/auth');for(const [key,value] of Object.entries({client_id:'synthetic-client',redirect_uri:`${api}/api/v1/auth/google/callback`,response_type:'code',state:'synthetic-state',code_challenge:'synthetic-challenge',code_challenge_method:'S256'}))url.searchParams.set(key,value);
 await page.route(`${api}/api/v1/auth/google/start?format=json`,route=>route.fulfill({json:{authorizationUrl:url.href}}));
 await page.route('https://accounts.google.com/**',route=>route.fulfill({contentType:'text/html',body:'<p>Synthetic Google authorization page</p>'}));
 await page.goto('/login/');await expect(page.getByRole('button',{name:'Continue with Google'})).toBeEnabled();await page.getByRole('button',{name:'Continue with Google'}).click();
 await expect(page).toHaveURL(url.href);
});

test('unsafe OAuth URL never leaves the account page',async({page})=>{
 test.skip(!process.env.E2E_ACCOUNT_API,'Requires the synthetic account API build configuration.');
 await mockAccount(page,{accounts:true,googleOAuth:true});
 await page.route(`${api}/api/v1/auth/google/start?format=json`,route=>route.fulfill({json:{url:'https://accounts.google.com.attacker.test/steal'}}));
 await page.goto('/login/');await page.getByRole('button',{name:'Continue with Google'}).click();
 await expect(page.getByRole('alert').filter({hasText:'unsafe Google sign-in URL'})).toBeVisible();await expect(page).toHaveURL(/\/login\/$/);
});

test('OAuth return checks the server session without storing account credentials',async({page,context})=>{
 test.skip(!process.env.E2E_ACCOUNT_API,'Requires the synthetic account API build configuration.');
 await context.addCookies([{name:'oi_session',value:'synthetic-http-only-session',domain:new URL(api).hostname,path:'/',httpOnly:true,sameSite:'Lax'}]);
 await mockAccount(page,{accounts:true,googleOAuth:true},true);await page.goto('/login/');
 await expect(page.getByRole('heading',{name:'Hello, Synthetic account'})).toBeVisible();
 const stored=await page.evaluate(()=>({local:JSON.stringify(localStorage),session:JSON.stringify(sessionStorage),cookies:document.cookie,url:location.href}));
 expect(JSON.stringify(stored)).not.toContain('synthetic-http-only-session');expect(JSON.stringify(stored)).not.toContain('synthetic@example.test');
});

test('Mermaid preview uses an image rather than injecting diagram markup',async({page})=>{
 await page.goto('/workspace/#design');await expect(page.getByRole('img',{name:'System design diagram'})).toBeVisible();
 await expect(page.locator('.diagram-preview svg')).toHaveCount(0);
 await page.getByLabel('Mermaid diagram',{exact:true}).fill('flowchart TD\n A["<img src=x onerror=alert(1)>"] --> B[Safe preview]');
 await expect(page.getByRole('img',{name:'System design diagram'})).toBeVisible();await expect(page.locator('.diagram-preview img[onerror]')).toHaveCount(0);
});
