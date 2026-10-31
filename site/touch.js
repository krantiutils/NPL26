// Touch HUD calls engine inputs directly; desktop and netplay keep their existing paths.
(() => {
  'use strict';
  if (!matchMedia('(pointer: coarse)').matches || !navigator.maxTouchPoints) return;
  const stage = document.getElementById('stage'), panel = document.getElementById('panel'), canvas = document.getElementById('canvas');
  if (!stage || !panel || !canvas) throw new Error('Touch HUD requires stage, canvas and launcher');
  const style = document.createElement('style');
  style.textContent = `
    body.touch-game main{padding:0;gap:0}body.touch-game #stage{width:100vw!important;height:100dvh;aspect-ratio:auto;border-radius:0}
    body.touch-game .credit,body.touch-game #kbd,body.touch-game #kbd-show,body.touch-game #fs{display:none!important}
    #touch-controls{position:absolute;inset:0;z-index:4;pointer-events:none;user-select:none;-webkit-user-select:none}
    #touch-controls[hidden]{display:none}#touch-controls button{pointer-events:auto;touch-action:none;-webkit-tap-highlight-color:transparent;
      display:grid;place-content:center;gap:2px;width:64px;height:64px;padding:5px;border:1px solid #ebcd8277;border-radius:50%;
      background:linear-gradient(145deg,#192d4aac,#081425aa);color:#fff7df;font:600 11px system-ui;transition:transform .08s,background .08s,opacity .18s}
    @keyframes touch-appear{from{opacity:0;transform:scale(.94)}to{opacity:1;transform:scale(1)}}
    #touch-controls button{animation:touch-appear .18s ease-out}#touch-controls button b{font:500 23px system-ui}#touch-controls button[aria-pressed=true]{transform:scale(.91);background:#a82846b8;box-shadow:0 0 18px #e5c26e88}
    #touch-controls .main-action{width:86px;height:86px;border:2px solid #e6c675aa;font-size:13px;background:#76233e99}
    #touch-actions{position:absolute;right:max(16px,env(safe-area-inset-right));bottom:max(18px,env(safe-area-inset-bottom));width:240px;height:202px}
    #touch-actions button{position:absolute}#touch-actions button:nth-child(1){right:5px;bottom:0}#touch-actions button:nth-child(2){right:102px;bottom:4px}
    #touch-actions button:nth-child(3){right:121px;bottom:80px}#touch-actions button:nth-child(4){right:64px;bottom:137px}
    #touch-actions button:nth-child(5){right:0;bottom:102px}#touch-actions button:nth-child(6){right:178px;bottom:13px}
    #touch-menu{position:absolute;left:max(14px,env(safe-area-inset-left));bottom:18px}#touch-menu button{width:52px;height:52px;font-size:10px}
    #touch-field{position:absolute;left:max(14px,env(safe-area-inset-left));bottom:18px}#touch-field[hidden]{display:none}
    #touch-stick-zone{position:absolute;left:0;bottom:0;width:43%;height:65%;pointer-events:auto;touch-action:none}
    #touch-stick-zone[hidden],#touch-actions[hidden]{display:none}
    #touch-stick{position:absolute;display:none;width:116px;height:116px;border:1px solid #e8c57166;border-radius:50%;background:#0b203b55;pointer-events:none}
    #touch-stick i{position:absolute;left:34px;top:34px;width:48px;height:48px;border:1px solid #ebce83aa;border-radius:50%;background:#e7c78055}
    @media(max-height:360px){#touch-actions{transform:scale(.83);transform-origin:right bottom}}
  `;
  document.head.append(style); document.body.classList.add('touch-game');
  const overlay = document.createElement('div'); overlay.id = 'touch-controls';
  overlay.innerHTML = '<div id="touch-stick-zone" hidden><div id="touch-stick"><i></i></div></div><div id="touch-actions" hidden></div><div id="touch-menu"></div><div id="touch-field" hidden></div>';
  stage.append(overlay);
  const actions = overlay.querySelector('#touch-actions'), menu = overlay.querySelector('#touch-menu');
  const field = overlay.querySelector('#touch-field');
  const zone = overlay.querySelector('#touch-stick-zone'), stick = overlay.querySelector('#touch-stick'), nub = stick.querySelector('i');
  const hid = {KeyS:22,KeyD:7,KeyA:4,KeyW:26,ShiftLeft:225,AltLeft:226,Escape:41,ArrowUp:82,ArrowDown:81,ArrowLeft:80,ArrowRight:79};
  let M = null, mode = '', signature = '', joystick = null, menuPointer = null, lastFacts = '', lastFactTime = 0;
  const pointers = new Map(), held = new Set(), keyStarts = new Map(), keyReleases = new Set();
  const gameFrame = () => M ? M._input_touch_state(22) >>> 0 : 0;
  const elapsedFrames = (now, start) => (now - start) >>> 0;
  function updateHeld() {
    const next = new Set([...pointers.values()].flat());
    const ordered = [...new Set([...held,...next])].sort((a,b)=>Number(!a.endsWith('Left'))-Number(!b.endsWith('Left')));
    for (const code of ordered) if (held.has(code) !== next.has(code)) M._input_key_hid(hid[code],next.has(code)?1:0);
    held.clear(); for (const code of next) held.add(code);
    for (const b of overlay.querySelectorAll('[data-code]')) b.setAttribute('aria-pressed',String(held.has(b.dataset.code)));
  }
  function releaseAll() {
    pointers.clear(); keyStarts.clear();keyReleases.clear();if(M) updateHeld(); joystick=null;stick.style.display='none';
    if (menuPointer) { M._input_mouse_button(0,0);menuPointer=null; }
  }
  function advanceTouches(frame) {
    let changed = false;
    for (const id of keyReleases) {
      if (elapsedFrames(frame,keyStarts.get(id)) < 2) continue;
      pointers.delete(id);keyStarts.delete(id);keyReleases.delete(id);changed=true;
    }
    if (changed) updateHeld();
    const press = menuPointer;
    if (!press) return;
    // The absolute cursor is applied by the next Present. Do not race its native hit-test.
    if (press.downFrame === null && elapsedFrames(frame,press.startFrame) >= 1) {
      M._input_mouse_button(0,1);press.downFrame=frame;press.downTime=performance.now();
    }
    // At low match FPS, a wall-clock tap can otherwise begin and end between polls.
    // DirectInput also keeps mouse presses held for 50 ms. At 120 fps, three
    // frames alone would release/park before its native minimum hold expires.
    if (press.released && press.downFrame !== null && elapsedFrames(frame,press.downFrame) >= 3 && performance.now()-press.downTime >= 60) {
      M._input_mouse_button(0,0);M._input_mouse_set(-100,-100);menuPointer=null;
    }
  }
  const button = ([code,label,icon],i) => `<button type="button" data-code="${code}" aria-label="${label}" class="${i===0?'main-action':''}"><b aria-hidden="true">${icon}</b>${label}</button>`;
  function show(next,state) {
    const deliveries = state.style<2?['Leg break','Googly','Top spin','Flight','Zooter','Flipper']:
      state.style<4?['Off break','Arm ball','Doosra','Flight','Teesra']:['Bowl','Outswing','Inswing','Leg cut','Off cut','Yorker'];
    const sets = {
      batting:[['KeyS','Shot','◒'],['ShiftLeft','Loft','↗'],['KeyD','Advance','⇧'],['KeyA','Leave','◌'],['KeyW','Back foot','↶']],
      bowling:['KeyS','KeyA','KeyD','KeyW','ShiftLeft','AltLeft'].slice(0,deliveries.length).map((k,i)=>[k,deliveries[i],i===0?'●':'◔']).filter((_,i)=>i===0||(state.repertoire&(1<<i))),
      placement:[['KeyS','Release','●']], running:[['KeyD','Run','⇄'],['KeyA','Cancel run','×']],
      // FM ctor f_005b6e20: +1384=1 (S/bowler), +1390=0x4000 (W/keeper).
      // f_005ad540 tests 0x800 (Alt) for the human direct-hit attempt; movement is automatic.
      fielding:[['KeyS','Bowler','➤'],['KeyW','Keeper','▥'],['AltLeft','Direct hit','◎']],
      fieldPreset:[['KeyS','Select field','✓'],['KeyW','Close','×'],['ArrowUp','Previous field','↑'],['ArrowDown','Next field','↓']],
      interval:[['KeyS','Continue','▶']], replay:[['KeyS','Skip replay','▷']], cutscene:[['KeyS','Skip scene','▷']], menu:[], pause:[]
    };
    const spec = sets[next], key = next+JSON.stringify(spec);
    const snapshot={mode:next,...state,buttons:spec.map(s=>s[1])};window.NPLTouch.state=snapshot;overlay.dataset.state=JSON.stringify(snapshot);
    if(signature===key)return; signature=key;releaseAll();mode=next;
    overlay.dataset.mode=next;actions.innerHTML=spec.map(button).join('');actions.hidden=!spec.length;
    const isMenu=next==='menu'||next==='pause';menu.innerHTML=button([isMenu?'KeyW':'Escape',isMenu?'Back':'Pause',isMenu?'‹':'Ⅱ'],1);
    zone.hidden=!['batting','placement'].includes(next);
    field.hidden=next!=='bowling';field.innerHTML=next==='bowling'?button(['ArrowUp','Field','▥'],1):'';
    // Pause stays in one thumb-independent corner through deliveries and intervals.
    menu.style.bottom=isMenu?'18px':'auto';menu.style.top=isMenu?'auto':'20px';
    console.log('[touch-state]',JSON.stringify(snapshot));window.dispatchEvent(new CustomEvent('npl-touch-state',{detail:snapshot}));
  }
  function sample() {
    if(M){
      advanceTouches(gameFrame());
      const f=M._input_touch_state;
      const s={screen:f(0),ready:f(1),batCPU:f(2),bowlCPU:f(3),phase:f(4),bat:f(5),bowler:f(6),style:f(7),paused:f(8),overlay:f(9),side:f(10),replay:f(11),repertoire:f(12),mouseX:f(13),mouseY:f(14),mouseMaxX:f(15),mouseMaxY:f(16),cursor:f(17),cutscene:f(18),nativeMode:f(19),timing:f(20),window:f(23),innings:f(24),runs:f(25),wickets:f(26),overs:f(27),balls:f(28),matchOver:f(29),maxOvers:f(30)};
      const facts=JSON.stringify(s),now=performance.now();
      if(facts!==lastFacts||now-lastFactTime>2000){lastFacts=facts;lastFactTime=now;console.log('[touch-facts]',facts);}
      let next='menu';
      // drive_match() and recorded browser traces verify screen1=play, 3/4/5=intervals,
      // 27=start, 51=highlights, 126=the native pre-delivery presentation.
      if(s.ready&&[1,3,4,5,27,51,126].includes(s.screen)){
        if(s.paused)next='pause';
        else if(s.replay||s.screen===51||s.overlay===16)next='replay';
        else if([3,4,5,27,126].includes(s.screen)||[6,7,8,9].includes(s.overlay))next='interval';
        else if(s.window===720)next='fieldPreset';
        else if(s.cutscene===1)next='cutscene';
        else if(s.overlay!==3)next='menu'; // toss, bowling order, popups: tap native items directly
        else if(s.batCPU===0)next=([9,11,12].includes(s.phase)||s.bat===10||s.bat===14)?'running':'batting';
        else if(s.bowlCPU===0)next=s.phase===1?(s.bowler===1?'bowling':'placement'):'fielding';
        else next='interval';
      }
      show(next,s);
    }
    requestAnimationFrame(sample);
  }
  function visible(){overlay.hidden=!panel.classList.contains('hidden');if(overlay.hidden)releaseAll();}
  new MutationObserver(visible).observe(panel,{attributes:true,attributeFilter:['class']});visible();
  function vibrate(){if(navigator.vibrate)navigator.vibrate(9);}
  overlay.addEventListener('pointerdown',e=>{
    if(!M||e.pointerType==='mouse')return;
    const target=e.target.closest('[data-code]');if(!target)return;
    e.preventDefault();target.setPointerCapture(e.pointerId);keyReleases.delete(e.pointerId);keyStarts.set(e.pointerId,gameFrame());
    pointers.set(e.pointerId,[target.dataset.code]);updateHeld();vibrate();
  });
  function finish(e){
    if(!pointers.has(e.pointerId))return;e.preventDefault();
    if(e.type==='lostpointercapture'&&keyReleases.has(e.pointerId))return;
    if(e.type==='pointerup'&&keyStarts.has(e.pointerId)&&elapsedFrames(gameFrame(),keyStarts.get(e.pointerId))<2){keyReleases.add(e.pointerId);return;}
    pointers.delete(e.pointerId);keyStarts.delete(e.pointerId);keyReleases.delete(e.pointerId);updateHeld();
    if(joystick?.id===e.pointerId){joystick=null;stick.style.display='none';}
  }
  for(const type of ['pointerup','pointercancel','lostpointercapture'])overlay.addEventListener(type,finish);
  function aim(e){
    const dx=e.clientX-joystick.x,dy=e.clientY-joystick.y,r=Math.hypot(dx,dy),scale=r>40?40/r:1;
    nub.style.transform=`translate(${dx*scale}px,${dy*scale}px)`;
    pointers.set(e.pointerId,[Math.abs(dx)>12?(dx<0?'ArrowLeft':'ArrowRight'):null,Math.abs(dy)>12?(dy<0?'ArrowUp':'ArrowDown'):null].filter(Boolean));updateHeld();
  }
  zone.addEventListener('pointerdown',e=>{
    if(!M||joystick||e.pointerType==='mouse')return;e.preventDefault();zone.setPointerCapture(e.pointerId);
    const r=zone.getBoundingClientRect();joystick={id:e.pointerId,x:e.clientX,y:e.clientY};
    stick.style.left=`${e.clientX-r.left-58}px`;stick.style.top=`${e.clientY-r.top-58}px`;stick.style.display='block';aim(e);vibrate();
  });
  zone.addEventListener('pointermove',e=>{if(joystick?.id===e.pointerId){e.preventDefault();aim(e);}});
  function point(e){const r=canvas.getBoundingClientRect(),w=Math.min(r.width,r.height*4/3),h=w*3/4;
    const x=(e.clientX-r.left-(r.width-w)/2)*640/w,y=(e.clientY-r.top-(r.height-h)/2)*480/h;
    return x>=0&&x<=640&&y>=0&&y<=480?{x:Math.round(x),y:Math.round(y)}:null;}
  canvas.style.touchAction='none';
  canvas.addEventListener('pointerdown',e=>{
    if(!M||e.pointerType==='mouse'||!['menu','pause','interval','replay','cutscene'].includes(mode)||menuPointer)return;
    const p=point(e);if(!p)return;e.preventDefault();canvas.setPointerCapture(e.pointerId);M._input_mouse_set(p.x,p.y);vibrate();
    menuPointer={id:e.pointerId,startFrame:gameFrame(),downFrame:null,released:false};
  });
  function endMenu(e){
    if(menuPointer?.id!==e.pointerId)return;e.preventDefault();const press=menuPointer;
    if(e.type==='lostpointercapture'&&press.released)return;
    if(e.type!=='pointerup'){releaseAll();return;}
    press.released=true;advanceTouches(gameFrame());
  }
  for(const type of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(type,endMenu);
  overlay.addEventListener('contextmenu',e=>e.preventDefault());
  window.addEventListener('blur',releaseAll);window.addEventListener('pagehide',releaseAll);document.addEventListener('visibilitychange',()=>{if(document.hidden)releaseAll();});
  window.NPLTouch={state:null,releaseAll,attach(module){
    if(!module._input_mouse_set||!module._input_touch_state)throw new Error('Touch requires the rebuilt engine input exports');
    M=module;M._input_mouse_set(-100,-100);sample();return true;
  }};
})();
