// Run against an isolated local API and a static build configured for that API.
import {chromium,expect} from '@playwright/test';

const web=process.env.E2E_ACCOUNT_WEB_URL||'http://127.0.0.1:3018';
const api=process.env.E2E_ACCOUNT_API_URL||'http://127.0.0.1:8018';
for(const value of [web,api]) {
  if(!['localhost','127.0.0.1'].includes(new URL(value).hostname))throw Error('This fixture creates accounts only on an isolated loopback service.');
}
const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH}:{})});
const page=await browser.newPage();
const errors=[];
page.on('pageerror',error=>errors.push(error.message));
const email=`integration-${Date.now()}@example.com`;
try {
  await page.goto(web+'/register/',{waitUntil:'networkidle'});
  await page.getByRole('button',{name:'Create account',exact:true}).click();
  await page.getByLabel('Name',{exact:true}).fill('Integration Candidate');
  await page.getByLabel('Email',{exact:true}).fill(email);
  await page.getByLabel('Password',{exact:true}).fill('Synthetic-Practice-Only-42!');
  await page.locator('form').getByRole('button',{name:'Create account',exact:true}).click();
  await expect(page.getByText('Signed in. Local data remains on this device until you explicitly upload it.')).toBeVisible({timeout:15000});
  console.log('PASS browser registration and cookie authentication');
  await page.goto(web+'/workspace/#profile');
  await page.getByLabel('Your name',{exact:true}).fill('Integration Candidate');
  await page.getByRole('button',{name:/Continue/}).click();
  await page.getByRole('button',{name:/Continue/}).click();
  await page.getByRole('button',{name:'Save profile',exact:true}).click();
  await expect(page.getByText(/Your profile is saved locally/)).toBeVisible();
  await page.goto(web+'/workspace/#account');
  await expect(page.getByRole('heading',{name:'Hello, Integration Candidate'})).toBeVisible({timeout:10000});
  await page.getByLabel('I consent to uploading my profile, resume and text documents to this OpenInterview server.').check();
  await page.getByRole('button',{name:'Upload profile & documents'}).click();
  await expect(page.getByText(/Profile and text documents uploaded to your account/)).toBeVisible({timeout:10000});
  const response=await page.request.get(api+'/api/v1/profile');
  const profile=await response.json();
  expect(response.status()).toBe(200);
  expect(profile.name).toBe('Integration Candidate');
  console.log('PASS local onboarding and actual consented profile sync with CSRF');
  await page.reload();
  await expect(page.getByRole('heading',{name:'Hello, Integration Candidate'})).toBeVisible({timeout:10000});
  await page.getByRole('button',{name:'Sign out',exact:true}).click();
  await expect(page.getByText(/Signed out. Your local workspace remains available/)).toBeVisible();
  const me=await page.request.get(api+'/api/v1/auth/me');
  expect(me.status()).toBe(401);
  expect(errors).toEqual([]);
  console.log(JSON.stringify({result:'PASS actual browser/API account lifecycle',registration:true,onboarding:true,consentedSync:true,reloadCookie:true,logoutRevoked:true,pageErrors:errors}));
} catch(error) {
  await page.screenshot({path:'.local/auth-failure.png',fullPage:true});
  throw error;
} finally {
  await browser.close();
}
