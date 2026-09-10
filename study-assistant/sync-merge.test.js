/* 合并逻辑单元测试： node sync-merge.test.js */
const M=require('./sync-merge.js');
const NOW='2026-09-10T12:00:00.000Z';

let pass=0,fail=0;
function eq(name,got,want){
  const g=JSON.stringify(got),w=JSON.stringify(want);
  if(g===w){pass++;console.log('  ✓ '+name);}
  else{fail++;console.log('  ✗ '+name+'\n      得到 '+g+'\n      期望 '+w);}
}
function group(n){console.log('\n'+n);}

const SCORE='study-score-history.v1';
const TIMER='study_records_2026_9_10';
const SHEET='study-compose-sheet.v1';
const MARKS='idiomMemoryMarks.ipad.v1';
const rec=(id,ts,v)=>({id,updatedAt:ts,totalScore:v});

/* ============ 最关键的场景：浏览器清空了本地数据 ============ */
group('浏览器清空 localStorage 后不能反向抹掉云端');
{
  // 清空后：base 没了、local 没了，云端还有 3 条
  const remote={v:[rec('a','1',60),rec('b','2',70),rec('c','3',80)],del:{},ts:'2026-09-01'};
  const r=M.mergeKey(SCORE,undefined,undefined,remote,'',NOW);
  eq('成绩记录整份找回',r.value.map(x=>x.id),['a','b','c']);
  eq('不会把空推上云端',r.changedRemote,false);
  eq('本地需要写回',r.changedLocal,true);
}
{
  const remote={v:{t:'一段一千两百字的申论',l:1200},del:{},ts:'2026-09-01'};
  const r=M.mergeKey(SHEET,undefined,undefined,remote,'',NOW);
  eq('答题卡正文找回',r.value,{t:'一段一千两百字的申论',l:1200});
  eq('不会把空推上云端',r.changedRemote,false);
}
{
  const remote={v:{'画蛇添足':'red','守株待兔':'green'},del:{},ts:'2026-09-01'};
  const r=M.mergeKey(MARKS,undefined,undefined,remote,'',NOW);
  eq('成语标记找回',r.value,{'画蛇添足':'red','守株待兔':'green'});
}

/* ============ 删除要能传播，而不是被并集复活 ============ */
group('删除传播');
{
  // base 有 a,b；本地删了 b；云端还是 a,b
  const base=[rec('a','1',60),rec('b','2',70)];
  const local=[rec('a','1',60)];
  const remote={v:[rec('a','1',60),rec('b','2',70)],del:{},ts:'2026-09-01'};
  const r=M.mergeKey(SCORE,base,local,remote,'2026-09-10',NOW);
  eq('本地删的不会被云端复活',r.value.map(x=>x.id),['a']);
  eq('立了墓碑',Object.keys(r.del),['b']);
  eq('要推云端',r.changedRemote,true);
}
{
  // 云端已有墓碑，本地还留着那条（本机没同步到删除）
  const base=[rec('a','1',60),rec('b','2',70)];
  const local=[rec('a','1',60),rec('b','2',70)];
  const remote={v:[rec('a','1',60)],del:{'b':'2026-09-09'},ts:'2026-09-09'};
  const r=M.mergeKey(SCORE,base,local,remote,'2026-09-08',NOW);
  eq('云端的删除同步到本地',r.value.map(x=>x.id),['a']);
  eq('本地要写回',r.changedLocal,true);
}
{
  // 没有 base（新设备首次同步）时，本地"没有"只是没拉下来，绝不能当成删除
  const remote={v:[rec('a','1',60),rec('b','2',70)],del:{},ts:'2026-09-01'};
  const r=M.mergeKey(SCORE,undefined,[rec('c','9',90)],remote,'',NOW);
  eq('新设备不会误删云端条目',r.value.map(x=>x.id).sort(),['a','b','c']);
  eq('没有误立墓碑',Object.keys(r.del),[]);
}

/* ============ 两台设备各自新增 ============ */
group('多设备并集');
{
  const base=[rec('a','1',60)];
  const local=[rec('a','1',60),rec('local','5',75)];
  const remote={v:[rec('a','1',60),rec('remote','6',85)],del:{},ts:'2026-09-09'};
  const r=M.mergeKey(SCORE,base,local,remote,'2026-09-10',NOW);
  eq('两边新增都保留',r.value.map(x=>x.id).sort(),['a','local','remote']);
}
{
  // 同一条记录两边都改过：取 updatedAt 新的
  const base=[rec('a','1',60)];
  const local=[rec('a','2026-09-10',99)];
  const remote={v:[rec('a','2026-09-09',11)],del:{},ts:'2026-09-09'};
  const r=M.mergeKey(SCORE,base,local,remote,'2026-09-10',NOW);
  eq('同条冲突取较新',r.value[0].totalScore,99);
}
{
  const base=[rec('a','1',60)];
  const local=[rec('a','2026-09-08',11)];
  const remote={v:[rec('a','2026-09-11',99)],del:{},ts:'2026-09-11'};
  const r=M.mergeKey(SCORE,base,local,remote,'2026-09-08',NOW);
  eq('反向冲突也取较新',r.value[0].totalScore,99);
}

/* ============ 计时记录靠指纹去重（没有 id） ============ */
group('计时记录去重');
{
  const s={start:'09:00',end:'10:00',duration:3600};
  const t={start:'11:00',end:'11:30',duration:1800};
  const r=M.mergeKey(TIMER,undefined,[s],{v:[s,t],del:{},ts:'2026-09-09'},'',NOW);
  eq('同一次学习不会重复两条',r.value.length,2);
  eq('内容正确',r.value.map(x=>x.start).sort(),['09:00','11:00']);
}

/* ============ 整体覆盖类的时间戳裁决与空值保护 ============ */
group('答题卡正文');
{
  const base={t:'旧稿',l:1200};
  const r=M.mergeKey(SHEET,base,{t:'本地新稿',l:1200},{v:base,del:{},ts:'2026-09-01'},'2026-09-10',NOW);
  eq('只有本地改过就用本地',r.value.t,'本地新稿');
  eq('要推云端',r.changedRemote,true);
}
{
  const base={t:'旧稿',l:1200};
  const r=M.mergeKey(SHEET,base,base,{v:{t:'云端新稿',l:1200},del:{},ts:'2026-09-11'},'2026-09-01',NOW);
  eq('只有云端改过就用云端',r.value.t,'云端新稿');
  eq('本地要写回',r.changedLocal,true);
}
{
  const base={t:'旧稿',l:1200};
  const r=M.mergeKey(SHEET,base,{t:'本地稿',l:1200},{v:{t:'云端稿',l:1200},del:{},ts:'2026-09-01'},'2026-09-11',NOW);
  eq('都改过取时间戳新的（本地）',r.value.t,'本地稿');
}
{
  // 用户主动点了"清空"：正文为空字符串，但对象本身非空 —— 这个清空应该同步出去
  const base={t:'旧稿',l:1200};
  const r=M.mergeKey(SHEET,base,{t:'',l:1200},{v:{t:'云端稿',l:1200},del:{},ts:'2026-09-01'},'2026-09-11',NOW);
  eq('主动清空能同步出去（不被空值保护误拦）',r.value.t,'');
}
{
  const base={t:'旧稿',l:1200};
  const r=M.mergeKey(SHEET,base,undefined,{v:{t:'云端稿',l:1200},del:{},ts:'2026-09-01'},'2026-09-11',NOW);
  eq('本地整个 key 消失时用云端',r.value.t,'云端稿');
}

/* ============ 无变化时不该产生多余读写 ============ */
group('稳定性');
{
  const v=[rec('a','1',60)];
  const r=M.mergeKey(SCORE,v,v,{v:v,del:{},ts:'2026-09-01'},'2026-09-01',NOW);
  eq('三方一致时本地不写',r.changedLocal,false);
  eq('三方一致时云端不推',r.changedRemote,false);
}
{
  const v={t:'稿',l:1200};
  const r=M.mergeKey(SHEET,v,v,{v:v,del:{},ts:'2026-09-01'},'2026-09-01',NOW);
  eq('整体覆盖类三方一致也不动',[r.changedLocal,r.changedRemote],[false,false]);
}

/* ============ 墓碑清理 ============ */
group('墓碑过期清理');
{
  const old=new Date(Date.now()-100*86400000).toISOString();
  const fresh=new Date(Date.now()-3*86400000).toISOString();
  const out=M.pruneTombstones({a:old,b:fresh},Date.now());
  eq('90 天前的墓碑被清掉',Object.keys(out),['b']);
}

console.log('\n'+(fail?'✗':'✓')+' 通过 '+pass+' 项，失败 '+fail+' 项');
process.exit(fail?1:0);
