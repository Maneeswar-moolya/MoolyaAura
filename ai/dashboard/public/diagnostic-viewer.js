/* Shared observational screenshot viewer; no mapping or editor state is mutated. */
(() => {
  const node=(tag,text)=>{const item=document.createElement(tag);if(text!==undefined)item.textContent=text;return item;};
  window.DiagnosticViewer={mount(host,{captures=[],stepKey='',onPrevious,onNext,unavailable='No recording screenshot was captured for this step.'}={}){
    const box=node('section');box.className='qd-viewer';box.setAttribute('aria-label','Step screenshots');
    const toolbar=node('div');toolbar.className='qd-viewer-tools';const modes=node('div');modes.setAttribute('role','group');modes.setAttribute('aria-label','Screenshot timing');
    const frame=node('div');frame.className='qd-image-frame';const image=node('img');image.alt='Recorded or runtime state of the selected step';const missing=node('p'),caption=node('p');caption.className='qd-capture-caption';
    let selected=null,zoom=1,fit=true;
    const groups=[['Recorded',['BEFORE_ACTION','AFTER_ACTION','ASSERTION_STATE']],['Pre-step',['PRE_STEP']],['Failure',['FAILURE']]];
    const items=captures.filter(item=>item.recordingStepKey===stepKey&&item.artifact);
    toolbar.hidden=items.length===0;box.classList.toggle('qd-unavailable',items.length===0);
    const timing=node('select');timing.setAttribute('aria-label','Available captures');
    const draw=()=>{image.hidden=!selected;missing.hidden=!!selected;if(selected){image.src='/api/diagnostics/artifact?'+new URLSearchParams({...scopeBody(),artifact:selected.artifact});caption.textContent=`${selected.captureType.replaceAll('_',' ')}${selected.trigger==='PRE_INTERACTION_BUFFER'?' · buffered before interaction':''} · ${selected.capturedAt} · ${selected.route||'No route captured'}`;}else{missing.textContent=unavailable;caption.textContent='';}image.style.width=fit?'100%':`${zoom*100}%`;image.style.maxWidth=fit?'100%':'none';};
    for(const [label,types]of groups){const button=node('button',label);button.type='button';button.disabled=!items.some(item=>types.includes(item.captureType));button.onclick=()=>{const matches=items.filter(item=>types.includes(item.captureType));timing.textContent='';matches.forEach((item,index)=>timing.append(new Option(item.captureType.replaceAll('_',' '),String(index))));selected=matches[0]||null;timing.onchange=()=>{selected=matches[Number(timing.value)];draw();};for(const sibling of modes.children)sibling.setAttribute('aria-pressed',String(sibling===button));draw();};modes.append(button);}
    const range=node('input');range.type='range';range.min='50';range.max='250';range.step='10';range.value='100';range.setAttribute('aria-label','Screenshot zoom');range.oninput=()=>{zoom=Number(range.value)/100;fit=false;draw();};
    const fitButton=node('button','Fit'),full=node('button','Fullscreen');fitButton.type=full.type='button';fitButton.onclick=()=>{fit=true;draw();};full.onclick=()=>{if(document.fullscreenElement)document.exitFullscreen().catch(()=>{});else box.requestFullscreen?.().catch(()=>{caption.textContent='Fullscreen is unavailable in this browser.';});};
    for(const [text,callback]of [['Previous step',onPrevious],['Next step',onNext]])if(callback){const button=node('button',text);button.type='button';button.onclick=callback;toolbar.append(button);}
    toolbar.append(modes,timing,range,fitButton,full);frame.append(image,missing);box.append(toolbar,frame,caption);host.append(box);
    image.onerror=()=>{missing.hidden=false;missing.textContent='The retained screenshot is unavailable.';image.hidden=true;};
    const first=[...modes.children].find(button=>!button.disabled);if(first)first.click();else draw();return box;
  }};
})();
