/* =========================================================
   云同步（Supabase）

   目的很具体：浏览器自动清理数据时，学习记录不会跟着没。
   合并规则全部在 sync-merge.js 里（纯函数，有单元测试），这里只负责
   拉取、写回、推送和那一小块界面。

   接入方式是拦截 localStorage 写入，而不是去改那四个已有模块 —— 它们
   一行都不用动。拉取合并后再通过各自的刷新钩子让界面重新读一遍。
   ========================================================= */
(function(){
'use strict';

/* 必须用较新的版本：Supabase 已换成 sb_publishable_ 新版 key，
   老客户端（2.4x 那批）对新格式的支持没有保证。 */
const SDK='https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.116.0/dist/umd/supabase.js';
const TABLE='study_state';
const META_KEY='study-sync-meta.v1';
const PUSH_DELAY=3000;          /* 本地改动后攒 3 秒再推，避免边打字边发请求 */

/* study-theme 和尺寸存的是裸字符串，不是 JSON */
const RAW_KEYS=new Set(['study-theme','study-compose-size.v1']);

function isSynced(key){
  if(key===META_KEY) return false;
  return key==='study-score-history.v1'
      || key==='idiomMemoryMarks.ipad.v1'
      || key==='idiomCustomMeanings.ipad.v1'
      || key==='study-compose-sheet.v1'
      || key==='study-compose-size.v1'
      || key==='study-theme'
      || /^study_records_\d+_\d+_\d+$/.test(key);
}

/* ---------- 本地读写（写入走原始方法，绕开自己的拦截） ---------- */
const rawSetItem=Storage.prototype.setItem;
let applying=false;

function readLocal(key){
  const raw=localStorage.getItem(key);
  if(raw===null) return undefined;
  if(RAW_KEYS.has(key)) return raw;
  try{ return JSON.parse(raw); }catch(e){ return raw; }
}
function writeLocal(key,val){
  if(val===undefined||val===null) return;
  rawSetItem.call(localStorage,key,RAW_KEYS.has(key)?String(val):JSON.stringify(val));
}
function localSyncedKeys(){
  const out=[];
  for(let i=0;i<localStorage.length;i++){
    const k=localStorage.key(i);
    if(k&&isSynced(k)) out.push(k);
  }
  return out;
}
function loadMeta(){ try{ return JSON.parse(localStorage.getItem(META_KEY)||'{}')||{}; }catch(e){ return {}; } }
function saveMeta(m){ try{ rawSetItem.call(localStorage,META_KEY,JSON.stringify(m)); }catch(e){} }

/* ---------- 状态 ---------- */
let sb=null,user=null,syncing=false,syncAgain=false,pushTimer=null,ui=null;
let lastSyncedAt=null,lastError=null;

const cfg=window.CLOUD_CONFIG||{};
const enabled=!!(cfg.url&&cfg.anonKey);

/* ---------- 拉取合并后让各模块重新读一遍 ---------- */
function notify(keys){
  if(!keys.length) return;
  const has=re=>keys.some(k=>re.test(k));
  /* 成绩记录自己监听了 storage 事件，但同标签页内不会触发，补发一个合成事件 */
  if(keys.indexOf('study-score-history.v1')>=0){
    try{
      window.dispatchEvent(new StorageEvent('storage',{
        key:'study-score-history.v1',
        newValue:localStorage.getItem('study-score-history.v1')
      }));
    }catch(e){ if(typeof window.scoreHistoryRefresh==='function') window.scoreHistoryRefresh(); }
  }
  if(has(/^idiom/)&&typeof window.idiomAppRefresh==='function') window.idiomAppRefresh();
  if(has(/^study_records_/)&&typeof window.timerRecordsRefresh==='function') window.timerRecordsRefresh();
  if(keys.indexOf('study-compose-sheet.v1')>=0&&typeof window.composeReload==='function') window.composeReload();
  if(keys.indexOf('study-theme')>=0&&typeof window.applyTheme==='function'){
    window.applyTheme(localStorage.getItem('study-theme')||'');
  }
}

/* ---------- 同步主流程 ---------- */
async function sync(reason){
  if(!sb||!user) return;
  /* 同步进行中又来了新请求：不能直接丢，否则这期间的改动要等下一次触发才补上。
     记一笔，等当前这轮跑完再补一轮。 */
  if(syncing){ syncAgain=true; return; }
  syncing=true; lastError=null; paint('同步中…');
  try{
    const {data,error}=await sb.from(TABLE).select('key,value,updated_at').eq('user_id',user.id);
    if(error) throw error;

    const remote={};
    (data||[]).forEach(r=>{
      const v=r.value||{};
      remote[r.key]={v:v.v,del:v.del||{},ts:r.updated_at||''};
    });

    const meta=loadMeta();
    const nowIso=new Date().toISOString();
    const keys=new Set(localSyncedKeys().concat(Object.keys(remote)));

    const pushes=[],written=[];
    keys.forEach(key=>{
      if(!isSynced(key)) return;
      const local=readLocal(key);
      const m=meta[key]||{};
      const res=window.SyncMerge.mergeKey(key,m.base,local,remote[key]||null,m.ts||'',nowIso);
      if(res.changedLocal){ writeLocal(key,res.value); written.push(key); }
      if(res.changedRemote){
        pushes.push({user_id:user.id,key:key,value:{v:res.value,del:res.del},updated_at:nowIso});
      }
      meta[key]={ts:nowIso,base:res.value};
    });

    if(pushes.length){
      const {error:pe}=await sb.from(TABLE).upsert(pushes,{onConflict:'user_id,key'});
      if(pe) throw pe;
    }
    saveMeta(meta);

    applying=true;
    try{ notify(written); } finally{ applying=false; }

    lastSyncedAt=new Date();
    paint();
  }catch(e){
    lastError=(e&&e.message)||String(e);
    paint();
  }finally{
    syncing=false;
  }
  if(syncAgain){ syncAgain=false; return sync('coalesced'); }
}

function schedulePush(){
  if(!user) return;
  clearTimeout(pushTimer);
  pushTimer=setTimeout(()=>sync('local-change'),PUSH_DELAY);
  paint();
}

/* 拦截本地写入。注意 applying 期间是同步流程自己在写，不能再触发推送。 */
Storage.prototype.setItem=function(k,v){
  rawSetItem.call(this,k,v);
  if(this===localStorage&&!applying&&isSynced(k)) schedulePush();
};

/* 别的标签页改了数据也跟着推一次 */
window.addEventListener('storage',e=>{ if(e.key&&isSynced(e.key)) schedulePush(); });
/* 关标签页 / 切后台前把攒着的改动尽快推掉 */
document.addEventListener('visibilitychange',()=>{
  if(document.visibilityState==='hidden'&&user&&pushTimer){ clearTimeout(pushTimer); sync('hidden'); }
});

/* 登录邮件的回跳地址。必须归一化掉结尾的 index.html：
   从 /study-assistant/ 和从 /study-assistant/index.html 进站会算出两个不同地址，
   能否匹配就取决于 Supabase 的 ** 通配符是否匹配空串 —— 不如直接抹平，
   让它恒等于后台设置的 Site URL，那个地址一定是被允许的。 */
function redirectTarget(){
  return location.origin+location.pathname.replace(/index\.html$/,'');
}

/* ---------- 界面 ---------- */
function fmtTime(d){
  if(!d) return '还没同步过';
  return d.toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'});
}
function paint(override){
  if(!ui) return;
  const {dot,status,mail,signedIn,signedOut,syncBtn}=ui;
  const on=!!user;
  signedIn.hidden=!on; signedOut.hidden=on;
  if(on) mail.textContent=user.email||'已登录';
  let text,cls;
  if(override){ text=override; cls='is-busy'; }
  else if(lastError){ text='同步失败：'+lastError; cls='is-bad'; }
  else if(!enabled){ text='未配置云同步'; cls=''; }
  else if(!on){ text='未登录，数据只存在这台设备上'; cls='is-warn'; }
  else if(pushTimer){ text='有改动待同步'; cls='is-busy'; }
  else { text='已同步 · '+fmtTime(lastSyncedAt); cls='is-ok'; }
  status.textContent=text;
  dot.className='cloud-dot '+cls;
  if(syncBtn) syncBtn.disabled=!on||syncing;
}

function buildUI(){
  const btn=document.createElement('button');
  btn.className='cloud-toggle-btn'; btn.id='cloudToggleBtn'; btn.title='云同步';
  btn.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/></svg>';

  const panel=document.createElement('div');
  panel.className='cloud-panel'; panel.id='cloudPanel';
  panel.innerHTML=
    '<div class="cloud-panel-title"><span class="cloud-dot"></span>云同步</div>'+
    '<div class="cloud-status" id="cloudStatus"></div>'+
    '<div id="cloudSignedOut">'+
      '<p class="cloud-hint">用邮箱收一封登录链接。换设备或清了浏览器数据后，重新登录即可找回记录。</p>'+
      '<input class="cloud-input" id="cloudEmail" type="email" placeholder="你的邮箱" autocomplete="email">'+
      '<button class="cloud-btn is-primary" id="cloudSendLink" type="button">发送登录链接</button>'+
    '</div>'+
    '<div id="cloudSignedIn" hidden>'+
      '<p class="cloud-mail" id="cloudMail"></p>'+
      '<button class="cloud-btn" id="cloudSyncNow" type="button">立即同步</button>'+
      '<button class="cloud-btn is-quiet" id="cloudSignOut" type="button">退出登录</button>'+
    '</div>';

  document.body.appendChild(btn);
  document.body.appendChild(panel);

  ui={
    dot:panel.querySelector('.cloud-dot'),
    status:panel.querySelector('#cloudStatus'),
    mail:panel.querySelector('#cloudMail'),
    signedIn:panel.querySelector('#cloudSignedIn'),
    signedOut:panel.querySelector('#cloudSignedOut'),
    syncBtn:panel.querySelector('#cloudSyncNow')
  };

  btn.addEventListener('click',e=>{e.stopPropagation();panel.classList.toggle('show');paint();});
  document.addEventListener('click',e=>{
    if(!panel.contains(e.target)&&e.target!==btn&&!btn.contains(e.target)) panel.classList.remove('show');
  });

  panel.querySelector('#cloudSendLink').addEventListener('click',async function(){
    const input=panel.querySelector('#cloudEmail');
    const email=(input.value||'').trim();
    if(!email||email.indexOf('@')<0){ paint('请填一个有效邮箱'); return; }
    if(!sb){ paint('云同步未就绪'); return; }
    this.disabled=true; paint('正在发送…');
    const {error}=await sb.auth.signInWithOtp({
      email:email,
      options:{emailRedirectTo:redirectTarget()}
    });
    this.disabled=false;
    if(error){ lastError=error.message; paint(); }
    else{ lastError=null; paint('登录链接已发到 '+email+'，去邮箱点开它'); }
  });
  panel.querySelector('#cloudSyncNow').addEventListener('click',()=>sync('manual'));
  panel.querySelector('#cloudSignOut').addEventListener('click',async ()=>{
    if(!sb) return;
    await sb.auth.signOut();
    user=null; lastSyncedAt=null;
    /* 本地数据一律保留：退出登录不该等于删数据 */
    paint();
  });
}

/* ---------- 启动 ---------- */
function loadScript(src){
  return new Promise((res,rej)=>{
    const s=document.createElement('script');
    s.src=src; s.onload=res; s.onerror=()=>rej(new Error('CDN 加载失败'));
    document.head.appendChild(s);
  });
}

async function boot(){
  buildUI();
  if(!enabled){ paint(); return; }
  if(cfg.client){
    sb=cfg.client;          /* 注入现成客户端：供测试，也留给以后换别的后端 */
  }else{
    try{
      await loadScript(SDK);
      sb=window.supabase.createClient(cfg.url,cfg.anonKey,{
        auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}
      });
    }catch(e){
      lastError='Supabase 加载失败（离线？）'; paint(); return;
    }
  }
  const {data}=await sb.auth.getSession();
  user=(data&&data.session&&data.session.user)||null;
  paint();
  if(user) sync('boot');

  sb.auth.onAuthStateChange((event,session)=>{
    const next=(session&&session.user)||null;
    const changed=(next&&next.id)!==(user&&user.id);
    user=next;
    paint();
    if(user&&changed) sync('auth');
  });
}

window.cloudSync={sync:()=>sync('api'),isEnabled:()=>enabled,status:()=>({user:user&&user.email,lastSyncedAt,lastError})};

if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',boot);
else boot();
})();
