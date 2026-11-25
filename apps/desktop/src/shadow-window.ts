import {app,BrowserWindow,Menu,Tray,globalShortcut,screen} from 'electron';
import path from 'node:path';
import {shadowSettings,shadowResize,shadowCaptureStatus,SHADOW_DEFAULTS,type ShadowSettings} from './shadow.js';
import type {LocalStore} from './store.js';

export class ShadowWindow {
  window:BrowserWindow|undefined;
  private settings:ShadowSettings={...SHADOW_DEFAULTS};
  private capture=shadowCaptureStatus(process.platform,false);
  private tray:Tray|undefined;
  private shortcutRegistered=false;
  private quitting=false;
  private closing=false;
  private quitAfterClose=false;
  private shortcuts:string[]=[];
  private opening:Promise<ReturnType<ShadowWindow['state']>>|undefined;
  constructor(private main:BrowserWindow,private store:LocalStore,private home:string,private secure:(window:BrowserWindow)=>void,private cancelled:(window:BrowserWindow)=>void){
    try{const saved=store.get('desktop.shadow.settings');if(saved)this.settings={...shadowSettings(saved),clickThrough:false};}catch{/* Ignore invalid old configuration. */}
    const register=(accelerator:string,callback:()=>void)=>{const registered=globalShortcut.register(accelerator,callback);if(registered)this.shortcuts.push(accelerator);return registered;};
    this.shortcutRegistered=register('Control+Alt+Space',()=>this.toggle());
    register('Control+Alt+C',()=>{if(this.window)this.update({clickThrough:!this.settings.clickThrough});});
    register('Control+Alt+O',()=>{if(this.window)this.update({compact:!this.settings.compact});});
    for(const [key,action] of [['Return','answer'],['S','screen'],['L','listen']])register('Control+Alt+'+key,()=>{if(this.window&&!this.window.isDestroyed()){
      this.restore();
      // A real native shortcut supplies user activation for the chooser; its trusted-frame checks still apply.
      void this.window.webContents.executeJavaScript(`window.dispatchEvent(new CustomEvent('openinterview-shadow-command',{detail:{action:${JSON.stringify(action)}}}))`,true).catch(()=>{/* The tray remains available during a reload. */});
    }});
    for(const [key,dx,dy] of [['Left',-24,0],['Right',24,0],['Up',0,-24],['Down',0,24]] as const)register('Control+Alt+'+key,()=>{if(this.window&&!this.window.isDestroyed()){const bounds=this.window.getBounds();this.window.setPosition(bounds.x+dx,bounds.y+dy);this.save();}});
    this.tray=new Tray(path.join(__dirname,'icon.png'));
    this.tray.setToolTip('OpenInterview AI · Shadow controls');
    this.tray.setContextMenu(Menu.buildFromTemplate([{label:'Show / hide Shadow · Ctrl+Alt+Space',click:()=>this.toggle()},{label:'Restore mouse interaction',click:()=>this.restore()},{label:'Return to Light workspace',click:()=>this.requestClose()},{type:'separator'},{label:'Quit OpenInterview AI',role:'quit'}]));
    this.tray.on('double-click',()=>this.restore());
  }
  state(){return {active:!!this.window&&!this.window.isDestroyed(),visible:!!this.window&&!this.window.isDestroyed()&&this.window.isVisible(),...this.settings,bounds:this.window&&!this.window.isDestroyed()?this.window.getBounds():{x:this.settings.x??0,y:this.settings.y??0,width:this.settings.width,height:this.settings.height},captureProtection:this.capture,shortcutRegistered:this.shortcutRegistered,registeredShortcuts:this.shortcuts};}
  private publish(){const event={type:'shadow-state',state:this.state()};for(const window of [this.main,this.window])if(window&&!window.isDestroyed())window.webContents.send('oi:event',event);}
  private save(){if(this.window&&!this.window.isDestroyed())this.settings={...this.settings,...this.window.getBounds()};this.store.put('desktop.shadow.settings',this.settings);this.publish();}
  async open(){
    if(this.opening)return this.opening;
    if(this.window&&!this.window.isDestroyed()){this.window.show();this.publish();return this.state();}
    this.opening=this.create();try{return await this.opening;}finally{this.opening=undefined;}
  }
  private async create(){
    this.closing=false;this.quitAfterClose=false;this.settings.clickThrough=false;
    const area=screen.getDisplayMatching({x:this.settings.x??0,y:this.settings.y??0,width:this.settings.width,height:this.settings.height}).workArea;
    const width=Math.max(560,Math.min(this.settings.width,area.width)),height=Math.max(440,Math.min(this.settings.height,area.height));
    const x=Math.max(area.x,Math.min(this.settings.x??area.x+area.width-width-24,area.x+area.width-width)),y=Math.max(area.y,Math.min(this.settings.y??area.y+24,area.y+area.height-height));
    const window=new BrowserWindow({x,y,width,height,minWidth:560,minHeight:440,title:'OpenInterview AI · Shadow',icon:path.join(__dirname,'icon.png'),show:false,frame:false,thickFrame:false,transparent:true,backgroundColor:'#00000000',resizable:true,maximizable:false,fullscreenable:false,alwaysOnTop:this.settings.alwaysOnTop,skipTaskbar:true,hasShadow:false,webPreferences:{preload:path.join(__dirname,'preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false,webSecurity:true,allowRunningInsecureContent:false,webviewTag:false,spellcheck:true,backgroundThrottling:false}});
    this.window=window;this.secure(window);
    try{if(process.platform==='win32'){window.setContentProtection(true);const requested=window.isContentProtected();this.capture=shadowCaptureStatus(process.platform,requested,!requested);}else this.capture=shadowCaptureStatus(process.platform,false);}catch{this.capture=shadowCaptureStatus(process.platform,false,true);}
    window.on('resize',()=>this.save());window.on('move',()=>this.save());window.on('show',()=>this.publish());window.on('hide',()=>this.publish());
    window.on('close',event=>{if(!this.quitting&&!this.closing){event.preventDefault();this.requestClose();}});
    window.on('closed',()=>{this.cancelled(window);this.window=undefined;this.publish();if(!this.quitting)void this.resume();});
    const url=new URL(this.home);url.searchParams.set('desktopShadow','1');url.hash='shadow';
    try{await window.loadURL(url.toString());this.main.hide();window.show();this.save();return this.state();}catch(error){window.destroy();throw error;}
  }
  update(raw:unknown){this.settings=shadowSettings(raw,this.settings);if(this.window&&!this.window.isDestroyed()){this.window.setAlwaysOnTop(this.settings.alwaysOnTop);this.window.setIgnoreMouseEvents(this.settings.clickThrough,{forward:true});const bounds=this.window.getBounds();if(bounds.width!==this.settings.width||bounds.height!==this.settings.height)this.window.setSize(this.settings.width,this.settings.height);}this.save();return this.state();}
  resize(raw:unknown){if(!this.window||this.window.isDestroyed())throw new Error('Shadow window is not open');this.window.setBounds(shadowResize(this.window.getBounds(),raw));this.save();return this.state();}
  hide(){this.window?.hide();this.publish();return this.state();}
  restore(){if(!this.window){this.main.show();return;}this.update({clickThrough:false});this.window.show();this.window.focus();this.publish();}
  toggle(){if(!this.window){this.main.show();return;}if(this.settings.clickThrough||!this.window.isVisible())this.restore();else this.window.hide();this.publish();}
  requestClose(){if(!this.window||this.window.isDestroyed()){this.main.show();return;}if(this.window.webContents.isCrashed()){void this.close();return;}this.restore();this.window.webContents.send('oi:event',{type:'shadow-close-requested'});}
  prepareQuit(){if(this.quitting||!this.window||this.window.isDestroyed())return false;this.quitAfterClose=true;this.requestClose();return true;}
  private async resume(){if(this.main.isDestroyed())return;await this.main.loadURL(this.home);this.main.show();this.main.focus();this.main.webContents.send('oi:event',{type:'workspace-resume'});}
  async close(){if(this.window&&!this.window.isDestroyed()){this.closing=true;this.quitting=this.quitAfterClose;this.save();this.window.close();if(this.quitAfterClose)app.quit();}else{this.main.show();}return this.state();}
  dispose(){this.quitting=true;for(const accelerator of this.shortcuts)globalShortcut.unregister(accelerator);this.tray?.destroy();if(this.window&&!this.window.isDestroyed())this.window.destroy();}
}
