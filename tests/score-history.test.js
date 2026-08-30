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

test('accepts zero correct answers and rejects invalid score values',()=>{
  const zeroes=Object.fromEntries(utils.SCORE_FIELDS.map(field=>[field.key,0]));
  assert.equal(utils.validateScoreValues(zeroes).valid,true);
  assert.equal(utils.validateScoreValues({...zeroes,verbal:25}).valid,true);
  assert.equal(utils.validateScoreValues({...zeroes,verbal:26}).valid,false);
  assert.equal(utils.validateScoreValues({...zeroes,quantity:-1}).valid,false);
  assert.equal(utils.validateScoreValues({...zeroes,politics:1.5}).valid,false);
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
  const record={graphic:8,definition:9,analogy:9,logic:8};
  assert.equal(utils.judgementCorrect(record),34);
  assert.equal(utils.metricValue(record,'judgement'),85);
});

test('normalization keeps the saved total score snapshot',()=>{
  const values=Object.fromEntries(utils.SCORE_FIELDS.map(field=>[field.key,0]));
  const record=utils.normalizeRecord({...values,id:'one',date:'2026-08-30',durationSeconds:3600,totalScore:80.55,note:'test',createdAt:'2026-08-30T00:00:00Z'});
  assert.equal(record.totalScore,80.55);
});

test('fingerprint changes when any save input changes',()=>{
  const values=Object.fromEntries(utils.SCORE_FIELDS.map(field=>[field.key,0]));
  const base={...values,date:'2026-08-30',durationSeconds:3600,note:''};
  assert.notEqual(utils.fingerprint(base),utils.fingerprint({...base,note:'changed'}));
  assert.notEqual(utils.fingerprint(base),utils.fingerprint({...base,politics:1}));
});

let failures=0;
for(const {name,fn} of tests){
  try{fn();process.stdout.write('PASS '+name+'\n');}
  catch(error){failures++;process.stderr.write('FAIL '+name+'\n'+error.stack+'\n');}
}
if(failures)process.exitCode=1;
else process.stdout.write('\n'+tests.length+' tests passed\n');
