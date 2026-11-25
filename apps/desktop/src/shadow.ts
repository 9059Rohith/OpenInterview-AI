import { object } from './security.js';

export const SHADOW_DEFAULTS={backgroundTransparency:0.7,alwaysOnTop:true,compact:true,clickThrough:false,fontSize:15,width:930,height:790};
export type ShadowSettings=typeof SHADOW_DEFAULTS & {x?:number;y?:number};
function number(value:unknown,min:number,max:number){if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max)throw new Error('Invalid Shadow setting');return value;}
export function shadowSettings(raw:unknown,current:ShadowSettings=SHADOW_DEFAULTS):ShadowSettings {
  const data=object(raw),next={...current};
  for(const key of Object.keys(data))if(!['backgroundTransparency','alwaysOnTop','compact','clickThrough','fontSize','width','height','x','y'].includes(key))throw new Error('Unknown Shadow setting');
  if(data.backgroundTransparency!==undefined)next.backgroundTransparency=number(data.backgroundTransparency,0,0.9);
  if(data.fontSize!==undefined)next.fontSize=number(data.fontSize,12,24);
  for(const key of ['alwaysOnTop','compact','clickThrough'] as const)if(data[key]!==undefined){if(typeof data[key]!=='boolean')throw new Error('Invalid Shadow setting');next[key]=data[key];}
  for(const [key,min,max] of [['width',560,7680],['height',440,4320],['x',-100000,100000],['y',-100000,100000]] as const)if(data[key]!==undefined)next[key]=Math.round(number(data[key],min,max));
  return next;
}
export function shadowResize(bounds:{x:number;y:number;width:number;height:number},raw:unknown){
  const data=object(raw),edge=data.edge;if(typeof edge!=='string'||!['N','S','E','W','NE','NW','SE','SW'].includes(edge))throw new Error('Invalid resize edge');
  const dx=number(data.dx,-2000,2000),dy=number(data.dy,-2000,2000),next={...bounds};
  if(edge.includes('E'))next.width=Math.max(560,Math.min(7680,bounds.width+dx));
  if(edge.includes('S'))next.height=Math.max(440,Math.min(4320,bounds.height+dy));
  if(edge.includes('W')){next.width=Math.max(560,Math.min(7680,bounds.width-dx));next.x=bounds.x+bounds.width-next.width;}
  if(edge.includes('N')){next.height=Math.max(440,Math.min(4320,bounds.height-dy));next.y=bounds.y+bounds.height-next.height;}
  return Object.fromEntries(Object.entries(next).map(([key,value])=>[key,Math.round(value)])) as typeof bounds;
}
export function shadowCaptureStatus(platform:string,requested:boolean,failed=false){return {requested,platform,status:failed?'failed':requested?'requested':'unsupported',message:failed?'Windows capture protection could not be requested. Test your receiving view.':requested?'Windows capture exclusion requested. Sharing apps must honor Windows filtering; test the receiving view.':'Capture exclusion is unavailable here. The overlay may appear in sharing or recording.'};}
