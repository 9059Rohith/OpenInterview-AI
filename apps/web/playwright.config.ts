import {defineConfig,devices} from '@playwright/test';
export default defineConfig({testDir:'./tests/e2e',timeout:45000,fullyParallel:false,use:{baseURL:process.env.E2E_BASE_URL||'http://127.0.0.1:4173',trace:'retain-on-failure',channel:process.env.PLAYWRIGHT_CHANNEL},projects:[{name:'chromium',use:{...devices['Desktop Chrome'],viewport:{width:1536,height:1024}}}],reporter:'list'});
