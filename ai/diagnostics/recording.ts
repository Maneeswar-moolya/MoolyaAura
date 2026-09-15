/** Recording-time pictures. These carry no candidate measurements or trust promotion. */
import path from 'node:path';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { BrowserContext, Page } from '@playwright/test';
import type { ApplicationScope } from '../projects/scope';
import type { RecordedAction, RecordedAssertion } from '../dashboard/recorder';
import { captureDiagnostic, diagnosticRoot, type CaptureAttribution, type DiagnosticCapture } from './artifacts';

interface Observation { id:string; name:string; selector:string; documentId:string; captures:DiagnosticCapture[] }
export class RecordingPictures {
  readonly sessionId = randomUUID();
  readonly observations: Observation[] = [];
  readonly assertionPictures: DiagnosticCapture[] = [];
  /** Set by `finish`. Unknown until then, and never guessed. */
  attribution: CaptureAttribution | null = null;
  private focusPictures = new WeakMap<Page,Map<string,DiagnosticCapture>>();
  private buffered = new WeakMap<Page,Map<string,{capture:DiagnosticCapture;bytes:Buffer}>>();
  private directory: string;
  /**
   * Observation work, run strictly in the order the page reported it.
   *
   * The page no longer waits for a picture before letting the recorder record its
   * action, so several reports can now be in flight at once. Arrival order is the only
   * order that means anything here - it is the order the person acted in - so the work
   * is chained rather than run concurrently, and `settle` is what a caller awaits
   * instead of guessing a delay.
   */
  private work: Promise<unknown> = Promise.resolve();
  /**
   * The recorder's own overlay, recognised by the SAME rule the parser drops it with.
   *
   * Injected rather than re-stated: the parser drops a click on the assertion picker
   * from the recorded stream, and an observation kept for that click leaves the two
   * streams permanently different lengths - which discards every action picture in the
   * recording. One rule, supplied by the one place that owns it.
   */
  constructor(readonly scope: ApplicationScope, private readonly recorderOwnAction?: (selector:string)=>boolean) { this.directory=path.join(diagnosticRoot(scope),'recordings',this.sessionId); }
  private enqueue<T>(run:()=>Promise<T>):Promise<T> {
    const next=this.work.then(run,run);
    this.work=next.catch(()=>{});
    return next;
  }
  /**
   * Wait for the observation work the page has reported.
   *
   * A round trip to the page first, and it is the load-bearing half: the page no longer
   * waits for a picture, so a report can be in flight on the connection when a caller
   * asks. Messages on one connection are delivered in order, so a reply to a request
   * made AFTER those reports is a barrier - everything already sent has arrived and is
   * on the queue by the time it comes back. The same barrier the navigation journal
   * uses, for the same reason. Bounded by the captures themselves; nothing is guessed.
   */
  async settle(page?:Page):Promise<void> {
    if(page&&!page.isClosed())await page.evaluate(()=>0).catch(()=>{});
    await this.work.catch(()=>{});
  }
  private async picture(page: Page,key:string,type:DiagnosticCapture['captureType'],documentId?:string) {
    const picture=await captureDiagnostic(page,this.directory,key,type,documentId);
    if(picture) picture.artifact=`recordings/${this.sessionId}/${picture.artifact}`;
    return picture;
  }
  async begin(page:Page,name:string,selector:string,before:boolean,documentId:string,focusRef?:string,frameRef?:string,clickCount?:number):Promise<string> {
    if(this.observations.length>=2000) return '';
    // The recorder's own UI is not a step of the test. Refused here rather than filtered
    // at pairing time, so no picture of the tool is written in the first place.
    if(this.recorderOwnAction?.(selector)) return '';
    // Codegen coalesces successive input updates for the same control. Keep the first
    // pre-state and latest post-state, and never retain typed values in this journal.
    const last=this.observations.at(-1);
    const same=last?.selector===selector&&last.documentId===documentId;
    const observation= same && (name==='fill'&&last.name==='fill'||name==='click'&&clickCount===2&&last.name==='click')
      ? last : {id:randomUUID(),name,selector,documentId,captures:[]};
    if(name==='click'&&clickCount===2)observation.name='dblclick';
    if(observation!==last)this.observations.push(observation);
    const focused=focusRef&&this.focusPictures.get(page)?.get(focusRef);
    if(focused&&name==='fill'&&!observation.captures.some(item=>item.captureType==='BEFORE_ACTION'))observation.captures.push({...focused,recordingStepKey:observation.id});
    const frame=frameRef&&this.buffered.get(page)?.get(frameRef);
    if(!before&&!name.startsWith('assert')&&frame&&frame.capture.documentId===documentId&&!observation.captures.some(item=>item.captureType==='BEFORE_ACTION')){
      const captureRef=randomUUID(),artifact=`aura-${captureRef}.png`;fs.writeFileSync(path.join(this.directory,artifact),frame.bytes);
      observation.captures.push({...frame.capture,captureRef,artifact:`recordings/${this.sessionId}/${artifact}`,recordingStepKey:observation.id});
    }
    const capture=await this.picture(page,observation.id,name.startsWith('assert')?'ASSERTION_STATE':before?'BEFORE_ACTION':'AFTER_ACTION',documentId);
    if(capture){if((name==='fill'||observation.name==='dblclick')&&!before)observation.captures=observation.captures.filter(item=>item.captureType!=='AFTER_ACTION');observation.captures.push(capture);}
    return observation.id;
  }
  async end(page:Page,id:string,documentId:string) {
    const observation=this.observations.find(item=>item.id===id);if(!observation)return;
    const capture=await this.picture(page,id,'AFTER_ACTION',documentId);if(capture)observation.captures.push(capture);
  }
  async assertion(page:Page,index:number) {
    const capture=await this.picture(page,`picker:${index}`,'ASSERTION_STATE');if(capture)this.assertionPictures.push(capture);
  }
  /** Pair only a complete, order-preserving action stream. Mismatch is unavailable,
   * never a guessed association based on a filename or an accessible name. */
  finish(actions:RecordedAction[],assertions:RecordedAssertion[]):DiagnosticCapture[] {
    const normal=(name:string)=>({selectOption:'select',press:'press',check:'check',uncheck:'uncheck',click:'click',dblclick:'dblclick',fill:'fill'}[name]??name);
    const actual=actions.map((action,index)=>({action,index})).filter(item=>item.action.type!=='navigate');
    const observed=this.observations.filter(item=>!item.name.startsWith('assert'));
    const result:DiagnosticCapture[]=[];
    const actionsPaired=actual.length===observed.length && actual.every((item,index)=>normal(item.action.type)===normal(observed[index].name));
    if(actionsPaired)
      actual.forEach((item,index)=>result.push(...observed[index].captures.map(capture=>({...capture,recordingStepKey:`action:${item.index}`}))));
    const native=this.observations.filter(item=>item.name.startsWith('assert'));
    // Picker assertions are appended by the established parser after native assertions.
    const assertionsPaired=native.length+this.assertionPictures.length===assertions.length;
    if(assertionsPaired) {
      native.forEach((item,index)=>result.push(...item.captures.map(capture=>({...capture,recordingStepKey:`assertion:${index}`}))));
      this.assertionPictures.forEach((capture,index)=>result.push({...capture,recordingStepKey:`assertion:${native.length+index}`}));
    }
    this.attribution={paired:actionsPaired&&assertionsPaired,
      observed:this.observations.reduce((total,item)=>total+item.captures.length,0)+this.assertionPictures.length,
      attributed:result.length,observedActions:observed.length,recordedActions:actual.length,
      observedAssertions:native.length+this.assertionPictures.length,recordedAssertions:assertions.length};
    return result;
  }
  async install(context:BrowserContext) {
    await context.exposeBinding('__auraPictureWarm',async({page},documentId)=>{
      const capture=await this.picture(page,'pending-interaction','BEFORE_ACTION',String(documentId).slice(0,100));if(!capture)return '';
      const file=path.join(diagnosticRoot(this.scope),capture.artifact),bytes=fs.readFileSync(file);fs.unlinkSync(file);
      const frames=this.buffered.get(page)??new Map();frames.set(capture.captureRef,{capture:{...capture,trigger:'PRE_INTERACTION_BUFFER'},bytes});
      while(frames.size>3)frames.delete(frames.keys().next().value!);this.buffered.set(page,frames);return capture.captureRef;
    });
    await context.exposeBinding('__auraPictureFocus',async({page},documentId)=>{
      const capture=await this.picture(page,'pending-input','BEFORE_ACTION',String(documentId).slice(0,100));
      if(!capture)return '';
      // A focus snapshot is usable only if the browser confirms it completed before
      // the first input event on that very control. Fast input stays unavailable.
      this.focusPictures.set(page,new Map([[capture.captureRef,capture]]));return capture.captureRef;
    });
    // Enqueued, not awaited by the page: the page reports and moves on, and these run
    // in the order the reports arrived so one action's pictures cannot overtake another's.
    await context.exposeBinding('__auraPictureBefore',async({page},payload)=>{
      if(!payload || typeof payload.name!=='string' || typeof payload.selector!=='string')return '';
      return this.enqueue(()=>this.begin(page,payload.name.slice(0,40),payload.selector.slice(0,4000),payload.before===true,String(payload.documentId||'').slice(0,100),typeof payload.focusRef==='string'?payload.focusRef:undefined,typeof payload.frameRef==='string'?payload.frameRef:undefined,Number(payload.clickCount)));
    });
    await context.exposeBinding('__auraPictureAfter',async({page},payload)=>{if(payload && typeof payload.id==='string')await this.enqueue(()=>this.end(page,payload.id,String(payload.documentId||'').slice(0,100)));});
    await context.addInitScript({content:`(${recordingPictureHook.toString()})();`});
  }
}

/** Wrap recorder bindings only. Never intercept, replay or cancel application events. */
function recordingPictureHook() {
  const win=window as any,documentId=`${Date.now()}-${Math.random().toString(36).slice(2)}`;
  // Modern native codegen records ordinary clicks after dispatch. Keep at most a
  // small, masked pre-interaction buffer without cancelling or delaying UI events.
  let readyRef='',readyAt=0,interactionRef='';
  document.addEventListener('DOMContentLoaded',()=>{void(async()=>{for(;;){try{const ref=await win.__auraPictureWarm(documentId);if(ref){readyRef=ref;readyAt=performance.now();}}catch{}await new Promise(resolve=>setTimeout(resolve,750));}})();},{once:true});
  for(const name of ['pointerdown','keydown','beforeinput'])document.addEventListener(name,()=>{interactionRef=performance.now()-readyAt<2000?readyRef:'';},true);
  let focused:Element|null=null,focusRef='',changed=false,token=0;
  document.addEventListener('focusin',event=>{
    const target=event.target;if(!(target instanceof Element)||!target.matches('input,textarea,[contenteditable]'))return;
    focused=target;focusRef='';changed=false;const current=++token;
    win.__auraPictureFocus(documentId).then((ref:string)=>{if(current===token&&!changed)focusRef=ref;}).catch(()=>{});
  },true);
  document.addEventListener('beforeinput',event=>{if(event.target===focused)changed=true;},true);
  for(const [name,before] of [['__pw_recorderPerformAction',true],['__pw_recorderRecordAction',false]] as const) {
    const original=win[name];if(typeof original!=='function')continue;
    win[name]=async function(action:any,...rest:any[]) {
      const payload={name:action.name,selector:action.selector||'',clickCount:action.clickCount,before,documentId,frameRef:interactionRef,focusRef:action.name==='fill'&&focused===document.activeElement?focusRef:undefined};
      // AFTER DISPATCH. The browser has already performed this action, so the document
      // may be on its way out - which is exactly what a click on Log In or a menu item
      // does. Hand the action to the recorder FIRST and report the picture without
      // waiting for it: an observation that never comes back must not be able to delete
      // the action it was only describing. Waiting here is how a navigating click was
      // lost, leaving the navigation it caused standing in the recording with no cause.
      if(!before) { const recorded=original.call(this,action,...rest);try{void win.__auraPictureBefore(payload).catch(()=>{});}catch{}return recorded; }
      // BEFORE DISPATCH. The recorder has not performed the action yet, nothing is
      // navigating, and this is the only moment a true before-action picture exists.
      let id='';
      try{id=await win.__auraPictureBefore(payload);}catch{}
      const result=await original.call(this,action,...rest);
      // Waiting HERE is safe and waiting above was not, and the difference is the whole
      // rule: by this line the recorder already holds the action, so the picture can
      // only delay a report, never delete a step.
      if(id)try{await win.__auraPictureAfter({id,documentId});}catch{}
      return result;
    };
  }
}
