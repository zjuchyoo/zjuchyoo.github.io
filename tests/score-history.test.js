'use strict';

const assert=require('node:assert/strict');
const utils=require('../study-assistant/score-history.js');

const tests=[];
function test(name,fn){tests.push({name,fn});}

test('parses supported duration formats into seconds',()=>{
  assert.equal(utils.parseDuration('1h45m43s'),6343);
  assert.equal(utils.parseDuration('1h30m'),5400);
  assert.equal(utils.parseDuration('52m18s'),3138);
  assert.equal(utils.parseDuration('45m'),2700);
  assert.equal(utils.parseDuration('2h'),7200);
});

test('rejects empty, zero, malformed, and overflow duration values',()=>{
  ['', '0s', '1:30', '1h60m', '12m60s', '-1h', 'abc'].forEach(value=>assert.equal(utils.parseDuration(value),null,value));
});

test('formats seconds for display',()=>{
  assert.equal(utils.formatDuration(6343),'1h45m43s');
  assert.equal(utils.formatDuration(5400),'1h30m');
  assert.equal(utils.formatDuration(2700),'45m');
});

test('validates real calendar dates',()=>{
  assert.equal(utils.isValidDate('2026-08-30'),true);
  assert.equal(utils.isValidDate('2026-02-29'),false);
  assert.equal(utils.isValidDate('2024-02-29'),true);
  assert.equal(utils.isValidDate(''),false);
});

const KEYS=utils.SCORE_FIELDS.map(field=>field.key);
function rowsOf(totals,correct){
  return Object.fromEntries(KEYS.map(key=>[key,{total:totals[key],correct:correct==='all'?totals[key]:(correct&&key in correct?correct[key]:null)}]));
}
const SHENGKAO=utils.CONFIG.exams.shengkao.totals,GUOKAO=utils.CONFIG.exams.guokao.totals;
const SHENGKAO_A={...SHENGKAO,quantity:20,graphic:10,definition:10};
const GUOKAO_OLD={...GUOKAO,politics:0,commonSense:20,verbal:40,graphic:10,definition:10,analogy:10,logic:10,dataAnalysis:20};

test('省考默认题量全对 = 100，数量满分约 16.47',()=>{
  const result=utils.computeScore('shengkao',rowsOf(SHENGKAO,'all'));
  assert.equal(result.total,100);
  assert.equal(result.hasEstimate,false);
  assert.equal(result.rows.quantity.full.toFixed(2),'16.47');
});

test('省考 A卷题量全对 = 100，数量满分 = 20',()=>{
  const result=utils.computeScore('shengkao',rowsOf(SHENGKAO_A,'all'));
  assert.equal(result.total,100);
  assert.equal(result.rows.quantity.full.toFixed(2),'20.00');
});

test('数量对几题改成 0，言语得分不变',()=>{
  const all=rowsOf(SHENGKAO,'all'),before=utils.computeScore('shengkao',all);
  const after=utils.computeScore('shengkao',{...all,quantity:{total:15,correct:0}});
  assert.equal(after.rows.verbal.earned,before.rows.verbal.earned);
  assert.equal(after.rows.quantity.earned,0);
  assert.equal(after.hasEstimate,false);
  assert.equal(after.total,83.53);
});

test('国考旧版题量（政治 0 题）全对 = 100，0 题的行不参与',()=>{
  const result=utils.computeScore('guokao',rowsOf(GUOKAO_OLD,'all'));
  assert.equal(result.total,100);
  assert.equal(result.rows.politics.active,false);
});

test('对几题留空按 65% 估并标含估算，估算正确率可改',()=>{
  const blank=utils.computeScore('shengkao',rowsOf(SHENGKAO,null));
  assert.equal(blank.total,65);
  assert.equal(blank.hasEstimate,true);
  assert.equal(utils.computeScore('shengkao',rowsOf(SHENGKAO,null),0.5).total,50);
  const zero=utils.computeScore('shengkao',rowsOf(SHENGKAO,Object.fromEntries(KEYS.map(key=>[key,0]))));
  assert.equal(zero.total,0);
  assert.equal(zero.hasEstimate,false);
});

test('validates raw correct/total rows',()=>{
  assert.ok(utils.normalizeRows(rowsOf(SHENGKAO,'all')));
  assert.equal(utils.normalizeRows(rowsOf(SHENGKAO,null)).verbal.correct,null);
  assert.equal(utils.normalizeRows(rowsOf(SHENGKAO,{verbal:26})),null);
  assert.equal(utils.normalizeRows(rowsOf(SHENGKAO,{quantity:-1})),null);
  assert.equal(utils.normalizeRows(rowsOf(SHENGKAO,{politics:1.5})),null);
  assert.equal(utils.normalizeRows(rowsOf({...SHENGKAO,politics:-1},null)),null);
});

test('sorts by exam date and preserves creation order within a date',()=>{
  const records=[
    {id:'c',date:'2026-08-30',createdAt:'2026-08-30T12:00:00Z'},
    {id:'a',date:'2026-08-20',createdAt:'2026-08-30T13:00:00Z'},
    {id:'b',date:'2026-08-30',createdAt:'2026-08-30T10:00:00Z'}
  ];
  assert.deepEqual(utils.sortRecordsAscending(records).map(record=>record.id),['a','b','c']);
  assert.deepEqual(utils.sortRecordsDescending(records).map(record=>record.id),['c','b','a']);
});

test('takes the latest ten records after chronological sorting',()=>{
  const records=Array.from({length:12},(_,index)=>({id:String(index+1),date:'2026-08-'+String(index+1).padStart(2,'0'),createdAt:''})).reverse();
  assert.deepEqual(utils.recentRecords(records,10).map(record=>record.id),['3','4','5','6','7','8','9','10','11','12']);
});

test('removes only the requested record without mutating the source array',()=>{
  const records=[{id:'a'},{id:'b'},{id:'c'}];
  const next=utils.removeRecordById(records,'b');
  assert.deepEqual(next.map(record=>record.id),['a','c']);
  assert.deepEqual(records.map(record=>record.id),['a','b','c']);
});

test('computes latest, highest, and average from all records',()=>{
  const stats=utils.getStats([
    {id:'late-created-old-exam',date:'2026-08-20',createdAt:'2026-08-30T12:00:00Z',totalScore:90},
    {id:'latest-exam',date:'2026-08-30',createdAt:'2026-08-21T12:00:00Z',totalScore:75},
    {id:'middle',date:'2026-08-25',createdAt:'2026-08-25T12:00:00Z',totalScore:60}
  ]);
  assert.equal(stats.latest,75);
  assert.equal(stats.highest,90);
  assert.equal(stats.average,75);
});

test('combines four judgement fields for the judgement trend',()=>{
  const record={rows:rowsOf(SHENGKAO_A,{graphic:8,definition:9,analogy:9,logic:8})};
  assert.deepEqual(utils.judgementStats(record),{correct:34,total:40});
  assert.equal(utils.metricValue(record,'judgement'),85);
  assert.equal(utils.metricValue(record,'verbal'),null);
});

test('旧记录算省考，按原始数用当前分值重算',()=>{
  const old={politics:8,commonSense:6,verbal:20,quantity:10,graphic:8,definition:9,analogy:9,logic:8,dataAnalysis:12};
  const record=utils.normalizeRecord({...old,id:'one',date:'2026-08-30',durationSeconds:3600,totalScore:1,note:'test',createdAt:'2026-08-30T00:00:00Z'});
  assert.equal(record.exam,'shengkao');
  assert.deepEqual(record.rows.quantity,{correct:10,total:20});
  /* 8*.65+6*.65+20*.8+10*1+8*.75+9*.8+9*.75+8*.9+12*1，旧题量下换算系数恰为 1 */
  assert.equal(record.totalScore,74.25);
});

test('没有原始数的旧记录保留原总分',()=>{
  const record=utils.normalizeRecord({id:'two',date:'2026-08-30',totalScore:80.55});
  assert.equal(record.exam,'shengkao');
  assert.equal(record.rows,null);
  assert.equal(record.totalScore,80.55);
  assert.equal(utils.normalizeRecord({id:'three',date:'2026-08-30'}),null);
});

test('新记录存 国考/省考 + 原始数，读回后总分按当前分值算',()=>{
  const saved={id:'n',exam:'guokao',date:'2026-11-11',durationSeconds:7200,rows:rowsOf(GUOKAO,'all'),estimateRate:0.65,totalScore:12.3};
  const record=utils.normalizeRecord(JSON.parse(JSON.stringify(saved)));
  assert.equal(record.exam,'guokao');
  assert.equal(record.totalScore,100);
  assert.deepEqual(utils.recordsOfExam([record],'shengkao'),[]);
  assert.equal(utils.recordsOfExam([record],'guokao').length,1);
});

test('fingerprint changes when any save input changes',()=>{
  const base={exam:'shengkao',date:'2026-08-30',durationSeconds:3600,note:'',estimateRate:0.65,rows:rowsOf(SHENGKAO,null)};
  assert.notEqual(utils.fingerprint(base),utils.fingerprint({...base,note:'changed'}));
  assert.notEqual(utils.fingerprint(base),utils.fingerprint({...base,exam:'guokao'}));
  assert.notEqual(utils.fingerprint(base),utils.fingerprint({...base,rows:rowsOf(SHENGKAO,{politics:1})}));
  assert.notEqual(utils.fingerprint(base),utils.fingerprint({...base,rows:rowsOf(SHENGKAO_A,null)}));
});

let failures=0;
for(const {name,fn} of tests){
  try{fn();process.stdout.write('PASS '+name+'\n');}
  catch(error){failures++;process.stderr.write('FAIL '+name+'\n'+error.stack+'\n');}
}
if(failures)process.exitCode=1;
else process.stdout.write('\n'+tests.length+' tests passed\n');
