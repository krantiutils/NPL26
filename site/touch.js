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
    #touch-controls{position:absolute;inset:0;z-index:4;pointer-events:none;user-select:none;-webkit-user-select:none;
      --gold:#f7c948;--ink:#01040d;--glint:rgba(120,160,230,.35);--sub:#9fb3d9;
      --strip:linear-gradient(#2b3f6e 0%,#15264c 45%,#0a1531 50%,#060d22 100%);
      --crimson:linear-gradient(#e2213f 0%,#a80d27 45%,#7a0719 50%,#4d0410 100%);
      font:italic 700 13px/1 "Arial Narrow","Roboto Condensed","sans-serif-condensed","Helvetica Neue",Arial,sans-serif}
    #touch-controls[hidden]{display:none}
    /* every control is a piece of the score bar's strip (web/scorebar.js .nsb-bar) */
    #touch-controls button{pointer-events:auto;touch-action:none;-webkit-tap-highlight-color:transparent;
      display:grid;grid-template-columns:28px 1fr;grid-template-rows:auto auto;align-content:center;column-gap:6px;row-gap:2px;
      height:40px;min-width:0;padding:0 6px 0 5px;border:2px solid var(--ink);border-radius:2px;background:var(--strip);
      box-shadow:0 0 0 1px var(--glint) inset,0 3px 8px rgba(0,0,0,.6);color:#fff;font:inherit;text-align:left;
      text-transform:uppercase;letter-spacing:.03em;text-shadow:0 1px 1px #000;transition:transform .06s,filter .06s}
    #touch-controls button.plain{grid-template-columns:1fr;padding:0 12px;text-align:center}
    #touch-controls button img{grid-row:1/3;width:28px;height:28px;image-rendering:pixelated}
    #touch-controls button .n{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    #touch-controls button .s{font-size:9.5px;color:var(--sub);text-transform:none;letter-spacing:.01em;white-space:nowrap;
      overflow:hidden;text-overflow:ellipsis}
    #touch-controls button[aria-pressed=true]{transform:translateY(1px);filter:brightness(1.3);border-color:var(--gold)}
    #touch-controls .main-action{grid-column:1/-1;height:48px;font-size:17px;background:var(--crimson);border-color:var(--ink);
      box-shadow:0 0 0 1px rgba(255,190,190,.35) inset,0 0 0 2px var(--gold),0 3px 10px rgba(0,0,0,.7)}
    #touch-controls .main-action .s{color:#ffd9d9}
    #touch-controls .main-action img{width:34px;height:34px}
    #touch-actions{position:absolute;right:max(10px,env(safe-area-inset-right));bottom:max(8px,env(safe-area-inset-bottom));
      width:min(30%,280px);display:grid;grid-template-columns:1fr 1fr;gap:4px;align-content:end}
    #touch-actions .main-action{order:99}
    #touch-menu{position:absolute;left:max(10px,env(safe-area-inset-left));top:10px}
    #touch-menu button,#touch-field button{height:36px;font-size:13px}
    #touch-field{position:absolute;left:max(10px,env(safe-area-inset-left));top:52px}#touch-field[hidden]{display:none}
    #touch-stick-zone{position:absolute;left:0;bottom:0;width:43%;height:70%;pointer-events:auto;touch-action:none}
    #touch-stick-zone[hidden],#touch-actions[hidden]{display:none}
    #touch-stick{position:absolute;display:none;width:120px;height:120px;border:2px solid var(--ink);border-radius:50%;
      background:radial-gradient(circle,rgba(21,38,76,.45),rgba(6,13,34,.75));box-shadow:0 0 0 1px var(--glint) inset;pointer-events:none}
    #touch-stick i{position:absolute;left:35px;top:35px;width:50px;height:50px;border:2px solid var(--ink);border-radius:50%;
      background:var(--strip);box-shadow:0 0 0 1px var(--gold) inset,0 2px 8px #000a}
    #touch-stick span{position:absolute;left:50%;top:-24px;transform:translateX(-50%);padding:3px 8px;border:2px solid var(--ink);
      background:var(--strip);box-shadow:0 0 0 1px var(--glint) inset;color:#fff;font-size:12px;letter-spacing:.05em;white-space:nowrap;
      text-transform:uppercase}
    #touch-hint{position:absolute;left:max(18px,env(safe-area-inset-left));bottom:64px;color:#fff;font-size:12px;
      letter-spacing:.05em;text-transform:uppercase;text-shadow:0 1px 2px #000,0 0 6px #000;pointer-events:none}#touch-hint[hidden]{display:none}
    @media(max-height:360px){#touch-actions{transform:scale(.86);transform-origin:right bottom}}
  `;
  document.head.append(style); document.body.classList.add('touch-game');
  const overlay = document.createElement('div'); overlay.id = 'touch-controls';
  overlay.innerHTML = '<div id="touch-stick-zone" hidden><div id="touch-hint"></div><div id="touch-stick"><i></i><span></span></div></div><div id="touch-actions" hidden></div><div id="touch-menu"></div><div id="touch-field" hidden></div>';
  stage.append(overlay);
  const actions = overlay.querySelector('#touch-actions'), menu = overlay.querySelector('#touch-menu');
  const field = overlay.querySelector('#touch-field');
  const zone = overlay.querySelector('#touch-stick-zone'), stick = overlay.querySelector('#touch-stick'), nub = stick.querySelector('i');
  const aimLabel = stick.querySelector('span'), hint = overlay.querySelector('#touch-hint');
  const hid = {KeyS:22,KeyD:7,KeyA:4,KeyW:26,ShiftLeft:225,AltLeft:226,ControlLeft:224,Space:44,Escape:41,ArrowUp:82,ArrowDown:81,ArrowLeft:80,ArrowRight:79};
  let M = null, mode = '', signature = '', joystick = null, menuPointer = null, lastFacts = '', lastFactTime = 0;
  const pointers = new Map(), held = new Set(), keyStarts = new Map(), keyReleases = new Set();
  // One-tap shots (batting): the game reads a shot as the shot key pressed while direction and modifiers are
  // already held (director/re/batting/FINDINGS.md: hold arrow/Shift 1-2 frames before S, keys held 4 frames).
  // A tap holds the modifiers (Loft = Shift) for one game frame, then adds the key for four, then lets go:
  // no two-finger chords, and every shot fires with the same one-frame delay so timing feels the same.
  const taps = new Map();
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
    pointers.clear(); keyStarts.clear();keyReleases.clear();taps.clear();if(M) updateHeld(); joystick=null;stick.style.display='none';
    if (menuPointer) { M._input_mouse_button(0,0);menuPointer=null; }
  }
  function advanceTouches(frame) {
    let changed = false;
    for (const [id,t] of taps) {
      if (t.fired === null && elapsedFrames(frame,t.start) >= 1) { t.fired = frame; pointers.set(id,t.codes); changed = true; }
      else if (t.fired !== null && elapsedFrames(frame,t.fired) >= 4) { taps.delete(id); pointers.delete(id); changed = true; }
    }
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
  // [code, name, what it does, icon (game tile bwldlvNN) or '', tap] - the main action is the first of a set
  const esc=t=>String(t).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const button = ([code,name,sub,icon,tap],i) => `<button type="button" data-code="${code}"${tap?' data-tap="1"':''} aria-label="${esc(name)}"`+
    ` class="${[i===0?'main-action':'',icon?'':'plain'].join(' ').trim()}">`+
    (icon?`<img src="dlv/${icon}.png" alt="" draggable="false">`:'')+`<span class="n">${esc(name)}</span>`+(sub?`<span class="s">${esc(sub)}</span>`:'')+'</button>';
  // Bowling, from the game's own tables: for each repertoire bit (player +0x160, in this order) the slot button
  // the delivery is bowled with (f_004aea00), its key (the PC glyph f_004b1cf0 draws for that button) and the
  // picker's icon for the delivery (f_004ae810 -> f_004b2170). One row per repertoire bit, per bowling style.
  const SLOT_KEYS=['KeyS','KeyA','KeyD','KeyW','ShiftLeft','Space','ControlLeft','AltLeft'];   // f_004b1cf0: bits 1 2 0x8000 0x4000 0x100 0x800 0x200 0x1000
  const DELIVERIES={
    leg:[['Leg Break','turns away','bwldlv03'],['Googly','turns in','bwldlv04'],['Top Spin','dips, kicks','bwldlv12'],
      ['Flight','tossed up','bwldlv10'],['Zooter','slides on','bwldlv14'],['Flipper','skids low','bwldlv13']],
    off:[['Off Break','turns in','bwldlv04'],['Arm Ball','drifts in','bwldlv05'],['Doosra','turns away','bwldlv15'],
      ['Flight','tossed up','bwldlv10'],['Teesra','skids on','bwldlv11']],
    pace:[['Stock Ball','standard','bwldlv05'],['Outswing','swings away','bwldlv03'],['Inswing','swings in','bwldlv04'],
      ['Leg Cutter','cuts away','bwldlv01'],['Off Cutter','cuts in','bwldlv02'],['Yorker','at the toes','bwldlv08'],
      ['Bouncer','short','bwldlv06'],['Slower','off pace','bwldlv09']],
  };

  function deliveries(style,repertoire){
    const group=style<2?'leg':style<4?'off':'pace',rows=DELIVERIES[group].slice();
    if(style>=8)rows[7]=['Reverse','late swing','bwldlv07'];   // fast bowlers: type 27 REVERSE
    return rows.map((r,i)=>(repertoire&(1<<i))?[SLOT_KEYS[i],r[0],r[1],r[2]]:null).filter(Boolean);
  }
  function show(next,state) {
    const sets = {
      // S shot (no aim = block), Shift+S lofted, D charge down the pitch, A leave. W has no verified batting role.
      batting:[['KeyS','Shot','aim: left thumb','bwldlv05',1],['ShiftLeft+KeyS','Loft','in the air','bwldlv10',1],
        ['KeyD','Charge','advance','bwldlv12',1],['KeyA','Leave','let it go','bwldlv08',1]],
      bowling:deliveries(state.style,state.repertoire),
      placement:[['KeyS','Release','aim, then let go','']], running:[['KeyD','Run','go for it',''],['KeyA','Stay','cancel the run','']],
      // FM ctor f_005b6e20: +1384=1 (S/bowler), +1390=0x4000 (W/keeper).
      // f_005ad540 tests 0x800 (Alt) for the human direct-hit attempt; movement is automatic.
      fielding:[['KeyS','To Bowler','throw','',],['KeyW','To Keeper','throw',''],['AltLeft','Direct Hit','at the stumps','']],
      fieldPreset:[['KeyS','Select Field','','',],['KeyW','Close','',''],['ArrowUp','Previous','',''],['ArrowDown','Next','','']],
      interval:[['KeyS','Continue','','']], replay:[['KeyS','Skip Replay','','']], cutscene:[['KeyS','Skip Scene','','']], menu:[], pause:[]
    };
    const spec = sets[next], key = next+JSON.stringify(spec);
    const snapshot={mode:next,...state,buttons:spec.map(s=>s[1])};window.NPLTouch.state=snapshot;overlay.dataset.state=JSON.stringify(snapshot);
    if(signature===key)return; signature=key;releaseAll();mode=next;
    overlay.dataset.mode=next;actions.innerHTML=spec.map(button).join('');actions.hidden=!spec.length;
    const isMenu=next==='menu'||next==='pause';menu.innerHTML=button([isMenu?'KeyW':'Escape',isMenu?'Back':'Pause','',''],1);
    zone.hidden=!['batting','placement'].includes(next);hint.hidden=false;
    hint.textContent=next==='batting'?'Hold to aim · no aim = block':'Hold to place the ball';
    field.hidden=next!=='bowling';field.innerHTML=next==='bowling'?button(['ArrowUp','Field','set fielders',''],1):'';
    console.log('[touch-state]',JSON.stringify(snapshot));window.dispatchEvent(new CustomEvent('npl-touch-state',{detail:snapshot}));
  }
  function sample() {
    if(M){
      advanceTouches(gameFrame());
      const f=M._input_touch_state;
      const s={screen:f(0),ready:f(1),batCPU:f(2),bowlCPU:f(3),phase:f(4),bat:f(5),bowler:f(6),style:f(7),paused:f(8),overlay:f(9),side:f(10),replay:f(11),repertoire:f(12),mouseX:f(13),mouseY:f(14),mouseMaxX:f(15),mouseMaxY:f(16),cursor:f(17),cutscene:f(18),nativeMode:f(19),timing:f(20),window:f(23),innings:f(24),runs:f(25),wickets:f(26),overs:f(27),balls:f(28),matchOver:f(29),maxOvers:f(30),delivery:f(32),length:f(33)};
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
    e.preventDefault();target.setPointerCapture(e.pointerId);keyReleases.delete(e.pointerId);
    const codes=target.dataset.code.split('+');
    if(target.dataset.tap){
      // pressed look for the tap's whole length; the keys themselves follow advanceTouches()
      taps.set(e.pointerId,{codes,start:gameFrame(),fired:null});pointers.set(e.pointerId,codes.slice(0,-1));
      target.setAttribute('aria-pressed','true');setTimeout(()=>target.setAttribute('aria-pressed',String(held.has(target.dataset.code))),160);
    }else{keyStarts.set(e.pointerId,gameFrame());pointers.set(e.pointerId,codes);}
    updateHeld();vibrate();
  });
  function finish(e){
    if(taps.has(e.pointerId)){e.preventDefault();return;}   // a tap runs its course whatever the finger does
    if(!pointers.has(e.pointerId))return;e.preventDefault();
    if(e.type==='lostpointercapture'&&keyReleases.has(e.pointerId))return;
    if(e.type==='pointerup'&&keyStarts.has(e.pointerId)&&elapsedFrames(gameFrame(),keyStarts.get(e.pointerId))<2){keyReleases.add(e.pointerId);return;}
    pointers.delete(e.pointerId);keyStarts.delete(e.pointerId);keyReleases.delete(e.pointerId);updateHeld();
    if(joystick?.id===e.pointerId){joystick=null;stick.style.display='none';hint.hidden=false;}
  }
  for(const type of ['pointerup','pointercancel','lostpointercapture'])overlay.addEventListener(type,finish);
  function aim(e){
    const dx=e.clientX-joystick.x,dy=e.clientY-joystick.y,r=Math.hypot(dx,dy),scale=r>40?40/r:1;
    nub.style.transform=`translate(${dx*scale}px,${dy*scale}px)`;
    const keys=[Math.abs(dx)>12?(dx<0?'ArrowLeft':'ArrowRight'):null,Math.abs(dy)>12?(dy<0?'ArrowUp':'ArrowDown'):null].filter(Boolean);
    pointers.set(e.pointerId,keys);updateHeld();
    // the broadcast camera looks from the bowler's end: down = towards the bowler = straight, up = behind square
    const v=keys.includes('ArrowDown')?'Straight':keys.includes('ArrowUp')?'Behind':'',h=keys.includes('ArrowLeft')?'◀':keys.includes('ArrowRight')?'▶':'';
    aimLabel.textContent=mode==='batting'?(v||h?[h==='◀'?h:'',v,h==='▶'?h:''].filter(Boolean).join(' '):'Block'):'Place';
  }
  zone.addEventListener('pointerdown',e=>{
    if(!M||joystick||e.pointerType==='mouse')return;e.preventDefault();zone.setPointerCapture(e.pointerId);
    const r=zone.getBoundingClientRect();joystick={id:e.pointerId,x:e.clientX,y:e.clientY};
    stick.style.left=`${e.clientX-r.left-60}px`;stick.style.top=`${e.clientY-r.top-60}px`;stick.style.display='block';hint.hidden=true;aim(e);vibrate();
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
