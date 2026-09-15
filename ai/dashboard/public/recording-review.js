/* Recording Review authoring. Catalog filtering is local; only Save Mapping writes. */
((global) => {
  const normalized = value => String(value || '').toLocaleLowerCase('en').normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  function fuzzy(term, text) {
    const query=normalized(term).trim(), value=normalized(text); if(!query)return true;
    return query.split(/\s+/).every(word=>{if(value.includes(word))return true;let at=0;for(const c of value)if(c===word[at])at++;return at===word.length;});
  }
  function onRoute(pattern,route) { const a=(pattern||'').replace(/\/$/,'').split('/'),b=(route||'').replace(/\/$/,'').split('/');return !!pattern&&!!route&&a.length===b.length&&a.every((part,at)=>part.startsWith(':')||part===b[at]); }
  function rankPages(pages,{current='',recent=[],route='',query='',all=false}={}) {
    const rank=page=>page.name===current?0:recent.includes(page.name)?1:onRoute(page.route,route)?2:3;
    return pages.filter(page=>fuzzy(query,`${page.name} ${page.route} ${page.description}`))
      .filter(page=>query||all||!route||rank(page)<3)
      .sort((a,b)=>rank(a)-rank(b)||(rank(a)===1?recent.indexOf(a.name)-recent.indexOf(b.name):0)||a.name.localeCompare(b.name,'en',{numeric:true}));
  }
  function objectsForPage(objects,page,query='') {return objects.filter(object=>(object.pages||[object.page]).includes(page)&&fuzzy(query,`${object.className} ${object.file} ${object.methods.map(method=>method.name).join(' ')}`));}
  /* WHEN the recorded locator is judged - a mirror of the server's condition, never of its
     rule. An existing capability runs its own declared locator, so the recorded chain is not
     authored and not judged; a new method, or recorded-locator execution, authors it. Kept
     top-level and pure so the decision can be exercised without a browser. */
  function judgesRecordedLocator(state,catalog){
    if(state.locatorOverride)return false;
    if(state.executionMode==='RECORDED_LOCATOR')return true;
    if(state.executionMode!=='PAGE_OBJECT_METHOD'||!state.method)return false;
    const object=((catalog||{}).objects||[]).find(object=>object.className===(state.pageObject||{}).name);
    return !((object||{}).methods||[]).some(method=>method.name===state.method);
  }
  /* The verdict the SERVER computed for this step, or null when it does not apply here. The
     browser is told the answer; it never re-states the rule. */
  function locatorRefusal(step,state,catalog){
    const verdict=step.locatorSafety;
    return judgesRecordedLocator(state,catalog)&&verdict&&verdict.ok===false?verdict:null;
  }
  const api={fuzzy,onRoute,rankPages,objectsForPage,judgesRecordedLocator,locatorRefusal};
  if(typeof module!=='undefined')module.exports=api;
  if(typeof document==='undefined')return;
  const el=(tag,text,cls)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(cls)node.className=cls;return node;};
  function highlight(node,text,query) {
    const terms=normalized(query).split(/\s+/).filter(Boolean),value=normalized(text);const marked=new Set();
    for(const term of terms){let at=value.indexOf(term);if(at>=0)for(let n=at;n<at+term.length;n++)marked.add(n);else {at=0;for(let n=0;n<value.length&&at<term.length;n++)if(value[n]===term[at]){marked.add(n);at++;}}}
    let run='',markedRun=false;for(let at=0;at<text.length;at++){const yes=marked.has(at);if(yes!==markedRun&&run){node.append(el(markedRun?'mark':'span',run));run='';}run+=text[at];markedRun=yes;}if(run)node.append(el(markedRun?'mark':'span',run));
  }
  /** Fixed-height virtual rows bound DOM size even for thousands of results. */
  function combobox({host,id,label,selected,placeholder,items,create,onPick,empty,viewAll,disabled=false}) {
    const controller=new AbortController(),signal=controller.signal;
    const wrapper=el('div',undefined,'rr-combobox'),caption=el('label',label);caption.htmlFor=id;
    const input=el('input');input.id=id;input.type='text';input.autocomplete='off';input.value=selected||'';input.placeholder=placeholder||'Search or select';input.disabled=disabled;
    input.setAttribute('role','combobox');input.setAttribute('aria-autocomplete','list');input.setAttribute('aria-expanded','false');input.setAttribute('aria-controls',id+'List');
    const chevron=el('span','⌄','rr-chevron');chevron.setAttribute('aria-hidden','true');wrapper.append(input,chevron);host.append(caption,wrapper);
    const popup=el('div',undefined,'rr-popover');popup.hidden=true;popup.id=id+'Popup';
    const list=el('div');list.id=id+'List';list.setAttribute('role','listbox');list.setAttribute('aria-label',label+' choices');
    const top=el('div'),viewport=el('div',undefined,'rr-options'),content=el('div'),bottom=el('div'),status=el('div',undefined,'rr-option-count');status.setAttribute('aria-live','polite');
    viewport.append(content);list.append(top,viewport,bottom);popup.append(list,status);document.body.append(popup);
    let open=false,query='',rows=[],active=-1,all=false;
    const group=item=>item.group?el('small',item.group,'rr-group'):null;
    function position(){if(!open)return;const r=input.getBoundingClientRect(),height=Math.min(popup.offsetHeight,420),below=innerHeight-r.bottom-8;popup.style.width=Math.min(Math.max(r.width,260),innerWidth-20)+'px';popup.style.left=Math.max(10,Math.min(r.left,innerWidth-popup.offsetWidth-10))+'px';popup.style.top=(below<height&&r.top>height?r.top-height-5:r.bottom+5)+'px';popup.style.maxHeight=Math.max(140,(below<height&&r.top>height?r.top-12:below))+'px';}
    function option(item,index){const node=el('div',undefined,'rr-option'+(index===active?' active':''));node.id=id+'Option'+index;node.setAttribute('role','option');node.setAttribute('aria-selected',String(item.value===selected));node.setAttribute('aria-posinset',String(index+1));node.setAttribute('aria-setsize',String(rows.length));node.dataset.value=item.value;
      if(item.group)node.append(group(item));const title=el('strong');highlight(title,item.label,query);node.append(title);if(item.meta){const meta=el('small');highlight(meta,item.meta,query);node.append(meta);}node.addEventListener('pointerdown',event=>event.preventDefault(),{signal});node.addEventListener('click',()=>pick(index),{signal});return node;}
    function draw(){top.textContent='';bottom.textContent='';content.textContent='';const first=rows[0]?.special==='create'?1:0,last=rows.at(-1)?.special==='all'?rows.length-1:rows.length;
      if(first)top.append(option(rows[0],0));if(last<rows.length)bottom.append(option(rows[last],last));
      const start=Math.max(first,first+Math.floor(viewport.scrollTop/70)-2),end=Math.min(last,start+11);content.style.height=Math.max(0,last-first)*70+'px';
      for(let at=start;at<end;at++){const node=option(rows[at],at);node.style.position='absolute';node.style.top=(at-first)*70+'px';content.append(node);}
      if(last===first){const message=el('div',empty||'No matches found.','rr-empty');message.setAttribute('role','status');content.append(message);content.style.height='80px';}
      status.textContent=`${last-first} ${label==='Page'?'Pages':'Page Objects'}`;
      if(active>=0)input.setAttribute('aria-activedescendant',id+'Option'+active);else input.removeAttribute('aria-activedescendant');position();}
    function update(){rows=[...(create?[{value:'@create',label:create.label,special:'create'}]:[]),...items(query,all),...(viewAll&&!all?[{value:'@all',label:'View all application Pages →',special:'all'}]:[])];active=-1;viewport.scrollTop=0;draw();}
    function show(){if(disabled||open)return;open=true;popup.hidden=false;query='';input.value='';input.setAttribute('aria-expanded','true');update();}
    function close(){open=false;popup.hidden=true;input.value=selected||'';input.setAttribute('aria-expanded','false');input.removeAttribute('aria-activedescendant');}
    function pick(index){const row=rows[index];if(!row)return;if(row.special==='all'){all=true;update();input.focus();return;}close();if(row.special==='create')create.run();else onPick(row.value);}
    input.addEventListener('click',show,{signal});input.addEventListener('input',()=>{const value=input.value;if(!open)show();input.value=value;query=value;update();},{signal});
    input.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();close();return;}if(event.key==='Tab'){close();return;}if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();show();active=event.key==='Home'?0:event.key==='End'?rows.length-1:Math.max(0,Math.min(rows.length-1,active+(event.key==='ArrowDown'?1:-1)));const row=rows[active];if(!row?.special){const at=active-(create?1:0);if(at*70<viewport.scrollTop)viewport.scrollTop=at*70;else if((at+1)*70>viewport.scrollTop+viewport.clientHeight)viewport.scrollTop=(at+1)*70-viewport.clientHeight;}draw();}else if(event.key==='Enter'&&open){event.preventDefault();pick(active);}}, {signal});
    viewport.addEventListener('scroll',draw,{signal});document.addEventListener('pointerdown',event=>{if(!wrapper.contains(event.target)&&!popup.contains(event.target))close();},{signal});
    window.addEventListener('resize',position,{signal});window.addEventListener('scroll',position,{capture:true,signal});
    return ()=>{controller.abort();popup.remove();};
  }
  api.mount=({byId,request,parameters,feedback,resizer,divider})=>{
    let quarantineId=null;
    const originalHost=byId('recReview'),serviceRequest=request;
    request=(url,body)=>{if(!quarantineId)return serviceRequest(url,body);const parsed=new URL(url,location.origin);parsed.pathname=parsed.pathname.replace('/api/record/ownership','/api/quarantine/mapping');parsed.searchParams.set('packageId',quarantineId);return serviceRequest(parsed.pathname+parsed.search,body?{...body,packageId:quarantineId}:undefined);};
    const review=el('section',undefined,'authoring-workspace rr-review');review.id='ownershipWorkspace';
    review.innerHTML=`<div class="aw-head"><div><h3>Step mapping</h3><p>Choose where this step belongs. Save once to make it reusable.</p></div><button type="button" id="ownerReload">Refresh review</button></div><div class="aw-panes"><div class="aw-list"><input id="ownerStepSearch" type="search" aria-label="Search recorded steps" placeholder="Search recorded steps"><div id="ownerSteps"></div></div>${divider}<div class="aw-detail" id="ownerDetail"><p class="rr-empty">Stop a recording to review its steps.</p></div></div><div id="ownerFeedback" class="aw-feedback" role="status" aria-live="polite"></div>`;
    byId('recReview').prepend(review);resizer(review.querySelector('.aw-divider'));
    let ownership=null,selectedStep=null,epoch=0,busy=false,dispose=[],dialog=null;
    const drafts=new Map(),recentKey=()=>`aura.review.recent.${ownership.applicationId}`;
    const key=step=>`${ownership.applicationId}/${quarantineId||'recording'}/${ownership.revision}/${step}`;
    const recents=()=>{try{return JSON.parse(localStorage.getItem(recentKey())||'{}');}catch{return {};}};
    const remember=state=>{const previous=recents();try{localStorage.setItem(recentKey(),JSON.stringify({pages:[state.page?.name,...previous.pages||[]].filter((v,i,a)=>v&&a.indexOf(v)===i).slice(0,20),objects:[state.pageObject?.name,...previous.objects||[]].filter((v,i,a)=>v&&a.indexOf(v)===i).slice(0,40)}));}catch{}};
    /** Mirrors executableBinding() on the server: a method to call, or the recorded locator. */
    function runnable(state){return state.executionMode==='RECORDED_LOCATOR'||!!state.method;}
    /**
     * THE CONTROLS THAT RESOLVE USER_BINDING_INCOMPLETE, where a person can reach them.
     *
     * The safeguard that refuses an incomplete mapping is correct and is untouched. What was
     * wrong is that everything capable of completing one - the method list, the recommended
     * capability, Create method, Use recorded locator - lived inside the collapsed "Advanced"
     * block, below the summary that reported the refusal. So the step said what was missing
     * and the only way to supply it was hidden behind a disclosure triangle nothing pointed at.
     *
     * This renders above the summary, always visible once a Page Object is chosen, and it is
     * the same state the summary and Save read - there is no second source of truth.
     */
    function executionChoice(step,state,catalog,panel){
      if(!state.page||!state.pageObject)return;
      const object=catalog.objects.find(object=>object.className===state.pageObject.name);
      const methods=object?.methods||[];
      const host=el('section',undefined,'rr-execution');host.id='executionChoice';
      host.append(el('h4','Execution choice'));
      // RANKED BY DECLARED LOCATOR, not by name. A method whose declared locator is the one
      // that was recorded is the same element by the application's own statement; a method
      // whose NAME merely resembles the target is a guess, and a guess presented as a
      // recommendation is how the wrong control gets bound. Everything else keeps its order.
      const recorded=(step.locator||'').trim();
      const matches=methods.filter(method=>(method.declaredLocator||'').trim()===recorded&&recorded);
      const ranked=[...matches,...methods.filter(method=>!matches.includes(method))];
      const choose=name=>patch(step,{method:name,executionMode:'PAGE_OBJECT_METHOD'});
      if(state.method){
        const current=el('p','Runs '+state.pageObject.name+'.'+state.method+'()','rr-chosen');
        current.id='executionChosen';host.append(current);
      }else if(state.executionMode==='RECORDED_LOCATOR'){
        const current=el('p','Runs the recorded locator for this step — USER AUTHORED — NOT VALIDATED','rr-chosen');
        current.id='executionChosen';host.append(current);
      }else host.append(el('p','USER_BINDING_INCOMPLETE — '+state.pageObject.name+' is selected but nothing was chosen to run this step.','rr-incomplete'));
      // Exactly one capability whose declared locator matches: offered by name, never applied
      // on its own. A recommendation the framework applies for you is not a user choice.
      if(matches.length===1&&state.method!==matches[0].name){
        const use=el('button','Use '+matches[0].name+'()');use.type='button';use.id='useRecommendedMethod';use.className='primary';
        use.onclick=()=>choose(matches[0].name);
        host.append(el('p','Recommended — its declared locator is the one recorded here.','rr-hint'),use);
      }
      if(ranked.length){
        const label=el('label','Method');label.htmlFor='executionMethod';
        const select=el('select');select.id='executionMethod';
        select.append(new Option(state.method?'Change method…':'Choose a method…',''));
        for(const method of ranked)select.append(new Option(
          method.name+'()'+(matches.includes(method)?' — declared locator matches':'')
            +(method.authoringStatus?' — '+method.authoringStatus:''),method.name));
        select.value=state.method||'';
        select.onchange=()=>{if(select.value)choose(select.value);};
        host.append(label,select);
      }else host.append(el('p',state.pageObject.name+' declares no capabilities yet.','rr-hint'));
      const actions=el('div',undefined,'rr-execution-actions');
      const create=el('button','+ Create method');create.type='button';create.id='executionCreateMethod';
      create.onclick=()=>{
        const name=prompt('Name the capability this step needs on '+state.pageObject.name);
        if(name&&name.trim())choose(name.trim());
      };
      actions.append(create);
      // Recorded-locator execution is supported for ACTIONS. An assertion reads its subject
      // through a capability, so offering it here would offer something that cannot be saved.
      if(step.role==='action'&&recorded){
        const useLocator=el('button','Use recorded locator');useLocator.type='button';useLocator.id='executionUseLocator';
        useLocator.onclick=()=>patch(step,{method:'',executionMode:'RECORDED_LOCATOR'});
        actions.append(useLocator);
      }
      host.append(actions);
      if(step.role==='action'&&recorded)host.append(el('code',recorded,'rr-execution-locator'));
      // The verdict belongs NEXT TO the expression it is about, and before the save rather
      // than after it. A refusal that only arrives from the transaction tells a person their
      // whole mapping failed; this tells them which locator, and which rule.
      if(recorded&&step.locatorSafety){
        const judged=judgesRecordedLocator(state,catalog);
        const bad=step.locatorSafety.ok===false;
        const line=el('p',undefined,bad&&judged?'rr-incomplete':'rr-hint');
        line.id='executionLocatorStatus';
        line.append(el('strong',bad?step.locatorSafety.code:'LOCATOR_ACCEPTED'),document.createTextNode(' - '
          +(bad?step.locatorSafety.message:'This recorded locator can be authored into a capability.')
          +(bad&&!judged?' It is not used by the current choice: the selected capability runs its own declared locator.':'')));
        host.append(line);
      }
      panel.append(host);
    }
    function persisted(step){const b=step.userSelection;return {page:b?.page?{...ownership.authoring.pages.find(p=>p.name===b.page),name:b.page,create:false}:null,pageObject:b?.pageObject?{name:b.pageObject,create:false}:null,method:b?.method||'',locatorOverride:b?.locatorOverride||'',executionMode:b?.executionMode||(b?.method?'PAGE_OBJECT_METHOD':'AUTO')};}
    const signature=state=>JSON.stringify(state);
    const stateFor=step=>drafts.get(key(step.key))||persisted(step);
    const dirty=step=>signature(stateFor(step))!==signature(persisted(step));
    const anyDirty=()=>ownership?.steps.some(dirty);
    function patch(step,change,redraw=true){const next={...structuredClone(stateFor(step)),...change};if(signature(next)===signature(persisted(step)))drafts.delete(key(step.key));else drafts.set(key(step.key),next);if(redraw)render();else summary(step);}
    function notice(text,kind=''){feedback('ownerFeedback',text,kind);}
    /* "None was taken" and "none could be placed" are different facts. Say which. */
    function captureNote(review){const a=review&&review.captureAttribution;
      if(!a||a.paired||!a.observed)return 'No recording screenshot was captured for this step.';
      return a.observed+' recording screenshot(s) were captured but none could be attributed to an individual step: '
        +a.observedActions+' observed action(s) against '+a.recordedActions+' recorded, '
        +a.observedAssertions+' observed assertion(s) against '+a.recordedAssertions+'. Showing none is deliberate; showing the wrong one would be worse.';}
    async function load(){if(busy)return;const turn=++epoch;notice('Loading Pages…');byId('ownerDetail').setAttribute('aria-busy','true');
      try{const result=await request('/api/record/ownership?'+parameters({}));if(turn!==epoch)return;ownership=result;if(!result.steps.some(step=>step.key===selectedStep))selectedStep=result.steps[0]?.key;render();notice(anyDirty()?'Unsaved mapping choices restored.':'Select a step to review its mapping.');}
      catch(error){if(turn!==epoch)return;byId('ownerDetail').textContent='';const box=el('div',undefined,'rr-empty');box.append(el('p','Unable to load Pages. '+error.message));const retry=el('button','Retry');retry.type='button';retry.onclick=load;box.append(retry);byId('ownerDetail').append(box);notice(error.message,'bad');}
      finally{byId('ownerDetail').removeAttribute('aria-busy');}}
    function selectStep(next){if(busy)return;if(anyDirty())notice('Unsaved changes are kept for their step. Save Mapping or Reset when you return.');selectedStep=next;render();}
    function render(){dispose.forEach(fn=>fn());dispose=[];if(!ownership)return;
      const list=byId('ownerSteps');list.textContent='';const query=byId('ownerStepSearch').value;
      for(const step of ownership.steps.filter(step=>fuzzy(query,`${step.label} ${step.screenRoute||''}`))){const button=el('button');button.type='button';button.dataset.stepKey=step.key;button.setAttribute('aria-current',String(step.key===selectedStep));button.append(el('span',step.label),el('small',`${step.screenRoute||'No route captured'}${dirty(step)?' · Unsaved changes':''}`));button.onclick=()=>selectStep(step.key);list.append(button);}
      if(!list.children.length)list.append(el('p','No matching recorded steps.','rr-empty'));
      const panel=byId('ownerDetail');panel.textContent='';const step=ownership.steps.find(step=>step.key===selectedStep);if(!step){panel.append(el('p','No relevant recorded steps.','rr-empty'));return;}
      const state=stateFor(step),catalog=ownership.authoring,recent=recents();panel.append(el('h3',step.label,'rr-step-title'));
      if(window.DiagnosticViewer)window.DiagnosticViewer.mount(panel,{captures:ownership.captures||[],stepKey:step.key,unavailable:captureNote(ownership)});
      const locator=el('div',undefined,'rr-recorded');locator.append(el('small','Recorded locator'),el('code',step.locator));panel.append(locator);
      const context=el('div',undefined,'rr-context');context.append(el('span','Current screen'),el('strong',step.screenRoute||'No route captured'),el('small',step.screenRoute?'Detected from recording':'A route is optional'));panel.append(context);
      const pageHost=el('div'),objectHost=el('div');panel.append(pageHost,objectHost);
      const pageItems=state.page?.create?[...catalog.pages,state.page]:catalog.pages;
      const selectPage=name=>{const page=pageItems.find(page=>page.name===name);patch(step,{page:{...page,create:!!page.create},pageObject:null,method:'',executionMode:'PAGE_OBJECT_METHOD'});byId('ownerPageObject')?.focus();};
      dispose.push(combobox({host:pageHost,id:'logicalPage',label:'Page',selected:state.page?.name,placeholder:'Auto / Recommended',disabled:busy,empty:'No Pages found for this screen or search.',viewAll:true,
        create:{label:'+ Create new Page',run:()=>createPage(step)},items:(query,all)=>rankPages(pageItems,{current:state.page?.name,recent:recent.pages,route:step.screenRoute,query,all}).map(page=>({value:page.name,label:page.name,meta:`${page.route||'No route'} · ${catalog.objects.filter(object=>(object.pages||[object.page]).includes(page.name)).length} Page Objects${page.create?' · NEW':''}`,group:page.name===state.page?.name?'CURRENT':recent.pages?.includes(page.name)?'RECENT':onRoute(page.route,step.screenRoute)?'ON THIS SCREEN':'APPLICATION PAGE'})),onPick:selectPage}));
      const objectItems=state.pageObject?.create?[...catalog.objects,{className:state.pageObject.name,page:state.page.name,pages:[state.page.name],methods:[],file:state.pageObject.name+'.ts',create:true}]:catalog.objects;
      dispose.push(combobox({host:objectHost,id:'ownerPageObject',label:'Page Object',selected:state.pageObject?.name,placeholder:state.page?'Search or create a Page Object':'Select a Page first',disabled:busy||!state.page,
        empty:state.page?`No Page Objects exist in ${state.page.name} yet. Create one to make this mapping reusable.`:'Select a Page first.',
        create:state.page?{label:objectsForPage(objectItems,state.page.name).length?'+ Create new Page Object':'+ Create first Page Object',run:()=>createObject(step)}:null,
        items:query=>objectsForPage(objectItems,state.page?.name,query).sort((a,b)=>{const rank=o=>o.className===state.pageObject?.name?-1:recent.objects?.includes(o.className)?recent.objects.indexOf(o.className):1000;return rank(a)-rank(b)||a.className.localeCompare(b.className,'en');}).map(object=>({value:object.className,label:object.className,meta:`${object.methods.length} capabilities · ${object.file.split('/').pop()}${object.create?' · NEW':''}`,group:object.className===state.pageObject?.name?'CURRENT':recent.objects?.includes(object.className)?'RECENT':`IN ${state.page.name}`})),
        onPick:name=>{const object=objectItems.find(object=>object.className===name);patch(step,{pageObject:{name,create:!!object.create},method:'',executionMode:'PAGE_OBJECT_METHOD'});byId('saveMapping')?.focus();}}));
      if(!state.page)panel.append(el('p','Select a logical Page to choose its Page Objects.','rr-hint'));
      executionChoice(step,state,catalog,panel);
      const sum=el('div');sum.id='mappingSummary';panel.append(sum);
      const advanced=el('details',undefined,'rr-advanced'),heading=el('summary','Advanced');advanced.append(heading);panel.append(advanced);
      const modeLabel=el('label','Execution mode');modeLabel.htmlFor='mappingMode';const mode=el('select');mode.id='mappingMode';mode.setAttribute('aria-label','Execution mode');
      for(const [value,label] of [['AUTO','Auto / Recommended'],['PAGE_OBJECT_METHOD','Page Object method'],...(step.role==='action'?[['RECORDED_LOCATOR','Recorded locator']]:[])])mode.append(new Option(label,value));mode.value=state.executionMode;mode.onchange=()=>{patch(step,{executionMode:mode.value,method:mode.value==='RECORDED_LOCATOR'?'':state.method});byId('ownerDetail').querySelector('details').open=true;};advanced.append(modeLabel,mode);
      // THE METHOD IS NOT OPTIONAL FOR PAGE OBJECT EXECUTION.
      // It used to be labelled optional and to promise it would "automatically reuse" a
      // capability when left blank. Nothing did: a Page Object with no method is context, and
      // the step it belongs to was saved as a completed mapping that could not run.
      const compatible=catalog.objects.find(o=>o.className===state.pageObject?.name)?.methods||[];
      const needsMethod=state.executionMode==='PAGE_OBJECT_METHOD';
      const methodLabel=el('label',needsMethod?'Method (required)':'Method');methodLabel.htmlFor='mappingMethod';const method=el('input');method.id='mappingMethod';
      method.placeholder=compatible.length?'Choose one of this Page Object’s capabilities':'This Page Object has no capabilities yet';
      method.value=state.method;method.setAttribute('list','mappingMethods');method.required=needsMethod;const methodList=el('datalist');methodList.id='mappingMethods';
      for(const item of compatible)methodList.append(new Option(item.name,item.name));
      method.oninput=()=>patch(step,{method:method.value},false);advanced.append(methodLabel,method,methodList);
      // The resolution controls live in the Execution choice section above, where they are
      // visible without expanding anything. Duplicating them here would give one decision two
      // places to be made and two places to drift.
      const locatorLabel=el('label','Locator override (optional)');locatorLabel.htmlFor='mappingLocator';const override=el('textarea');override.id='mappingLocator';override.value=state.locatorOverride;override.placeholder=step.locator;override.rows=3;override.oninput=()=>patch(step,{locatorOverride:override.value},false);advanced.append(locatorLabel,override,el('p','Explicit locators are USER AUTHORED — NOT VALIDATED. Saving does not claim automatic target proof.','rr-hint'));
      advanced.append(el('p',`${step.provenance} · ${step.evidenceDetail}`,'rr-hint'));
      const auto=el('button','Reset to Auto');auto.type='button';auto.id='mappingAuto';auto.onclick=()=>{patch(step,{page:null,pageObject:null,method:'',locatorOverride:'',executionMode:'AUTO'});notice('Auto selected. Save Mapping to apply it; reusable knowledge will be kept.');};advanced.append(auto);
      summary(step);if(busy)panel.querySelectorAll('button,input,select,textarea').forEach(node=>node.disabled=true);
    }
    function summary(step){const state=stateFor(step),changed=dirty(step),box=byId('mappingSummary');if(!box)return;box.textContent='';box.append(el('h4','Mapping summary'));
      // THE SUMMARY REPORTS THE EXECUTION CHOICE, not a guess at it. It used to print
      // 'Locator: Recorded locator' for any mode that was not AUTO - including a step bound to
      // a Page Object method, which runs no recorded locator at all. A summary that describes
      // the wrong mechanism is worse than none: it is the screen a person checks before saving.
      const provenance=runnable(state)?'USER_CONFIRMED':state.pageObject?'USER_BINDING_INCOMPLETE':'AUTO';
      const execution=state.method?'PAGE_OBJECT_METHOD':state.executionMode==='RECORDED_LOCATOR'?'RECORDED_LOCATOR':state.pageObject?'NOT CHOSEN':'AUTO';
      const rows=[['Page',state.page?.name||'Auto',state.page?.create?'NEW':'EXISTING'],
        ['Page Object',state.pageObject?.name||'Not selected',state.pageObject?.create?'NEW':'EXISTING'],
        ['Execution',execution,provenance]];
      if(state.method)rows.push(['Method',state.method+'()',provenance]);
      // A new capability is built FROM the recorded locator, so the summary names the
      // expression that will be written and whether it is acceptable - before Save, not after.
      if(judgesRecordedLocator(state,ownership.authoring)&&state.executionMode==='PAGE_OBJECT_METHOD'){
        rows.push(['Locator candidate',step.locator||'None recorded','FROM RECORDING']);
        rows.push(['Validation',step.locatorSafety?(step.locatorSafety.ok?'Accepted':step.locatorSafety.code):'Not checked','']);
      }
      if(execution==='RECORDED_LOCATOR')rows.push(['Locator',state.locatorOverride||step.locator||'Recorded locator','USER AUTHORED — NOT VALIDATED']);
      else if(state.locatorOverride)rows.push(['Locator',state.locatorOverride,'MANUAL OVERRIDE']);
      rows.push(['Provenance',provenance,'']);
      const table=el('dl',undefined,'rr-summary');for(const [label,value,status] of rows){table.append(el('dt',label));const detail=el('dd');detail.append(el('span',value));if(status&&value!=='Not selected'&&value!=='Auto')detail.append(el('small',status,'rr-chip'));table.append(detail);}box.append(table);
      if(changed){const changes=el('ul',undefined,'rr-changes');if(state.page?.create)changes.append(el('li','Create '+state.page.name));if(state.pageObject?.create)changes.append(el('li','Create '+state.pageObject.name));if(state.executionMode==='PAGE_OBJECT_METHOD')changes.append(el('li',state.method?'Bind '+state.method+'()':'Reuse a compatible capability or add a named method'));changes.append(el('li',state.executionMode==='AUTO'?'Reset this step to Auto; keep reusable knowledge':'Bind the current recorded step'));box.append(changes);}
      box.append(el('p',changed?'Unsaved changes':'No unsaved mapping changes.',changed?'rr-dirty':'rr-hint'));
      const actions=el('div',undefined,'rr-save-actions'),reset=el('button','Reset'),save=el('button',busy?'Saving Mapping…':'Save Mapping','primary');reset.id='resetMapping';reset.type=save.type='button';save.id='saveMapping';reset.disabled=!changed||busy;save.disabled=!changed||busy||(state.executionMode==='PAGE_OBJECT_METHOD'&&(!state.page||!state.pageObject))||(!!state.pageObject&&!runnable(state))||!!locatorRefusal(step,state,ownership.authoring);
      // The visible state must equal the state that would be stored. Save used to be offered
      // for a Page Object with nothing to run, and the server refuses it - so the only thing
      // the old enablement bought was a failed round trip and a step that looked mapped.
      if(state.pageObject&&!runnable(state))box.append(el('p','USER_BINDING_INCOMPLETE — choose how to run this step in Execution choice above.','rr-dirty'));
      // Same principle, applied to the locator: the server would refuse this exact save, so
      // the reason is shown here instead of being spent on a failed transaction.
      const refusal=locatorRefusal(step,state,ownership.authoring);
      if(refusal){const note=el('p',refusal.code+' - '+refusal.message,'rr-dirty');note.id='mappingLocatorRefusal';box.append(note);}
      reset.onclick=()=>{drafts.delete(key(step.key));render();notice('Restored the persisted mapping.');};save.onclick=()=>saveMapping(step);actions.append(reset,save);box.append(actions);
      for(const id of ['recSave','recSaveRun'])if(byId(id))byId(id).disabled=busy||!!anyDirty();
    }
    async function saveMapping(step){if(busy)return;const state=structuredClone(stateFor(step)),turn=++epoch;busy=true;render();notice('Validating and saving mapping…');
      try{const result=await request('/api/record/ownership/save-mapping',{applicationId:ownership.applicationId,revision:ownership.revision,mappingVersion:ownership.mappingVersion,stepKey:step.key,...state});if(turn!==epoch)return;remember(state);drafts.delete(key(step.key));ownership=result;if(quarantineId)window.dispatchEvent(new CustomEvent('quarantine-mapping-saved',{detail:{packageId:quarantineId}}));notice(`✓ Mapping saved\n${result.saved.binding?.page||'Auto'}${result.saved.binding?.pageObject?' → '+result.saved.binding.pageObject:''}\n${result.saved.binding?.method?'Reusable for future recordings in this application.':state.executionMode==='AUTO'?'Reusable knowledge was kept.':'Recording-specific locator choice saved — USER AUTHORED — NOT VALIDATED.'}`,'good');}
      catch(error){notice(error.message+'\nYour unsaved choices are retained. You can retry.','bad');}
      finally{busy=false;render();}}
    function modal(title,trigger){if(dialog)dialog.close();dialog=el('dialog',undefined,'rr-dialog');dialog.setAttribute('aria-label',title);const form=el('form');form.append(el('h3',title));const body=el('div'),error=el('p',undefined,'rr-dialog-error'),actions=el('div',undefined,'rr-save-actions'),cancel=el('button','Cancel'),submit=el('button','Use new '+(title.includes('Page Object')?'Page Object':'Page'),'primary');cancel.type='button';submit.type='submit';cancel.onclick=()=>dialog.close();actions.append(cancel,submit);form.append(body,error,actions);dialog.append(form);document.body.append(dialog);const current=dialog;current.addEventListener('close',()=>{current.remove();if(dialog===current)dialog=null;byId(trigger)?.focus();});current.showModal();return {dialog:current,form,body,error,submit};}
    function field(host,label,id,value='',optional=false){const caption=el('label',label);caption.htmlFor=id;const input=el('input');input.id=id;input.value=value;input.required=!optional;host.append(caption,input);return input;}
    function createPage(step){const box=modal('Create new Page','logicalPage'),name=field(box.body,'Page name','newPageName'),route=field(box.body,'Route (optional)','newPageRoute',step.screenRoute||'',true),description=field(box.body,'Description (optional)','newPageDescription','',true);name.maxLength=80;description.maxLength=240;
      box.body.append(el('p',step.screenRoute?'Detected from recording · Optional. You can edit or clear it.':'Route is optional. Page name identifies the logical Page.','rr-hint'));
      box.body.append(el('p','Added to this mapping now; persisted when you Save Mapping.','rr-hint'));const duplicate=el('div',undefined,'rr-duplicate');duplicate.hidden=true;box.body.append(duplicate);
      const choose=page=>{box.dialog.close();patch(step,{page,pageObject:null,method:'',executionMode:'PAGE_OBJECT_METHOD'});byId('ownerPageObject')?.focus();};
      name.oninput=()=>{const found=ownership.authoring.pages.find(page=>page.name===name.value.trim());duplicate.textContent='';duplicate.hidden=!found;box.submit.disabled=!!found;if(found){duplicate.append(el('strong','Page already exists'),el('p',found.name+'\n'+(found.route||'No route')));const use=el('button','Use Existing Page'),different=el('button','Choose Different Name');use.type=different.type='button';use.onclick=()=>choose({...found,create:false});different.onclick=()=>{name.focus();name.select();};duplicate.append(use,different);}};
      box.form.onsubmit=event=>{event.preventDefault();if(ownership.authoring.pages.some(page=>page.name===name.value.trim())){name.oninput();return;}if(route.value&&(!route.value.startsWith('/')||/[?#\\\r\n]/.test(route.value))){box.error.textContent='Use a route path without query or session values, or leave it empty.';return;}choose({name:name.value.trim(),route:route.value.trim(),description:description.value.trim(),create:true});};name.focus();}
    function createObject(step){const state=stateFor(step);if(!state.page)return;const box=modal('Create new Page Object','ownerPageObject'),name=field(box.body,'Page Object name','newPageObjectName');name.pattern='[A-Z][A-Za-z0-9_]{1,70}';box.body.append(el('p','Selected Page: '+state.page.name,'rr-context'),el('p','Added to this mapping now; persisted when you Save Mapping.','rr-hint'));
      name.oninput=()=>{box.error.textContent=name.value&&!/^[A-Z][A-Za-z0-9_]{1,70}$/.test(name.value)?'Use a PascalCase name such as AccountControls, without parentheses.':'';};
      box.form.onsubmit=event=>{event.preventDefault();if(ownership.authoring.objects.some(object=>object.className===name.value.trim())){box.error.textContent='This Page Object already exists. Select its associated Page to reuse it.';return;}if(['BasePage','Base'].includes(name.value)){box.error.textContent='Choose an application Page Object name.';return;}box.dialog.close();patch(step,{pageObject:{name:name.value.trim(),create:true},method:'',executionMode:'PAGE_OBJECT_METHOD'});byId('saveMapping')?.focus();};name.focus();}
    byId('ownerReload').onclick=load;byId('ownerStepSearch').oninput=render;
    byId('project').addEventListener('change',event=>{if(busy){event.stopImmediatePropagation();byId('project').value=ownership.applicationId;notice('Wait for Save Mapping to finish.');return;}if(anyDirty()&&!confirm('Leave this application? Unsaved mapping choices are kept for this session.')){event.stopImmediatePropagation();byId('project').value=ownership.applicationId;return;}epoch++;ownership=null;dispose.forEach(fn=>fn());dispose=[];byId('ownerSteps').textContent='';byId('ownerDetail').textContent='Reload the review for this application.';},{capture:true});
    byId('recCancel')?.addEventListener('click',event=>{if(busy||anyDirty()&&!confirm('Discard this recording with unsaved mapping choices?')){event.stopImmediatePropagation();event.preventDefault();}},{capture:true});
    byId('recStart')?.addEventListener('click',event=>{if(busy||anyDirty()&&!confirm('Start a new recording with unsaved mapping choices? Save Mapping first to retain them.')){event.stopImmediatePropagation();event.preventDefault();}},{capture:true});
    window.addEventListener('beforeunload',event=>{if(drafts.size){event.preventDefault();event.returnValue='';}});
    window.authoringOwnership={load:()=>{quarantineId=null;originalHost.prepend(review);return load();},openQuarantine:(id,host)=>{quarantineId=id;host.append(review);return load();},revision:()=>ownership?.revision,hasUnsaved:()=>!!anyDirty()};
  };
  global.RecordingReview=api;
})(typeof window==='undefined'?globalThis:window);
