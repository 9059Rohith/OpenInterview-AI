import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SHADOW_DEFAULTS,shadowSettings,shadowResize,shadowCaptureStatus} from '../src/shadow.js';

test('Shadow defaults preserve opaque text with independent background transparency',()=>{
  assert.equal(SHADOW_DEFAULTS.backgroundTransparency,0.7);assert.equal(SHADOW_DEFAULTS.compact,true);assert.equal(SHADOW_DEFAULTS.alwaysOnTop,true);
  assert.equal(shadowSettings({backgroundTransparency:0}).backgroundTransparency,0);
  for(const raw of [{backgroundTransparency:1},{backgroundTransparency:NaN},{fontSize:11},{alwaysOnTop:'yes'},{width:100},{opacity:0.1},{x:Infinity}])assert.throws(()=>shadowSettings(raw));
});
test('eight resize edges move only their intended axes and enforce minimum dimensions',()=>{
  const bounds={x:100,y:150,width:930,height:790};
  assert.deepEqual(shadowResize(bounds,{edge:'NW',dx:20,dy:30}),{x:120,y:180,width:910,height:760});
  assert.deepEqual(shadowResize(bounds,{edge:'SE',dx:20,dy:30}),{x:100,y:150,width:950,height:820});
  assert.deepEqual(shadowResize(bounds,{edge:'W',dx:1000,dy:30}),{x:470,y:150,width:560,height:790});
  assert.deepEqual(shadowResize(bounds,{edge:'N',dx:20,dy:1000}),{x:100,y:500,width:930,height:440});
  for(const edge of ['N','S','E','W','NE','NW','SE','SW']){const next=shadowResize(bounds,{edge,dx:10,dy:12});assert.ok(next.width>=560&&next.height>=440);}
  for(const raw of [{edge:'NN',dx:1,dy:1},{edge:'SE',dx:Infinity,dy:1},{edge:'SE',dx:1,dy:3000}])assert.throws(()=>shadowResize(bounds,raw));
});
test('capture protection status communicates request and platform limits honestly',()=>{
  assert.equal(shadowCaptureStatus('win32',true).status,'requested');
  assert.match(shadowCaptureStatus('win32',true).message,/test the receiving view/);
  assert.equal(shadowCaptureStatus('linux',false).status,'unsupported');
  assert.equal(shadowCaptureStatus('win32',false,true).status,'failed');
});
