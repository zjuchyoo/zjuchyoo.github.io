(function(root,factory){
  const config=(typeof module==='object'&&module.exports)?require('./score-config.js'):root.XINGCE_CONFIG;
  const api=factory(config);
  if(typeof module==='object'&&module.exports)module.exports=api;
  root.ScoreHistoryUtils=api;
  if(root.document){
    if(root.document.readyState==='loading')root.document.addEventListener('DOMContentLoaded',api.init,{once:true});
    else api.init();
  }
})(typeof globalThis!=='undefined'?globalThis:this,function(CONFIG){
  'use strict';

  /* 每题分值、默认题量都在 score-config.js 里，这里只做计算和界面 */
  const STORAGE_KEY='study-score-history.v1';
  const SCORE_FIELDS=CONFIG.rows;
  const FIELD_BY_KEY=Object.fromEntries(SCORE_FIELDS.map(field=>[field.key,field]));
  const EXAM_KEYS=Object.keys(CONFIG.exams);
  const DEFAULT_EXAM=EXAM_KEYS[0];
  const LEGACY_EXAM=CONFIG.legacyExam;
  const JUDGEMENT_KEYS=['graphic','definition','analogy','logic'];
  const MAX_TOTAL=999;
  const METRICS=[
    {key:'totalScore',label:'总成绩',color:'#7c3aed'},
    {key:'politics',label:'政治',color:'#d35400'},
    {key:'commonSense',label:'常识',color:'#2176ae'},
    {key:'verbal',label:'言语',color:'#008b6b'},
    {key:'quantity',label:'数量',color:'#c0392b'},
    {key:'judgement',label:'判断',color:'#9a6700'},
    {key:'dataAnalysis',label:'资料',color:'#6f52a2'}
  ];

  function parseDuration(value){
    const text=String(value||'').trim();
    const match=/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/i.exec(text);
    if(!match||(!match[1]&&!match[2]&&!match[3]))return null;
    const hours=Number(match[1]||0),minutes=Number(match[2]||0),seconds=Number(match[3]||0);
    if(minutes>=60||seconds>=60)return null;
    const total=hours*3600+minutes*60+seconds;
    return Number.isSafeInteger(total)&&total>0?total:null;
  }

  function formatDuration(totalSeconds){
    const total=Math.max(0,Math.floor(Number(totalSeconds)||0));
    const hours=Math.floor(total/3600),minutes=Math.floor((total%3600)/60),seconds=total%60;
    return (hours?hours+'h':'')+(minutes?minutes+'m':'')+(seconds?seconds+'s':'')||'0s';
  }

  function isValidDate(value){
    const match=/^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value||''));
    if(!match)return false;
    const year=Number(match[1]),month=Number(match[2]),day=Number(match[3]);
    const date=new Date(Date.UTC(year,month-1,day));
    return date.getUTCFullYear()===year&&date.getUTCMonth()===month-1&&date.getUTCDate()===day;
  }

  function localToday(){
    const now=new Date(),pad=value=>String(value).padStart(2,'0');
    return now.getFullYear()+'-'+pad(now.getMonth()+1)+'-'+pad(now.getDate());
  }

  function round2(value){return Math.round((Number(value)+Number.EPSILON)*100)/100;}
  function formatScore(value){return round2(value).toFixed(2).replace(/\.?0+$/,'');}
  function formatFixed(value){return round2(value).toFixed(2);}

  function formatPercent(value){
    const rounded=Math.round((Number(value)+Number.EPSILON)*10)/10;
    return rounded.toFixed(1).replace(/\.0$/,'')+'%';
  }

  function percent(correct,total){return total>0?Number(correct||0)/total*100:0;}
  function clampRate(value){
    const rate=Number(value);
    return value!==null&&value!==undefined&&value!==''&&Number.isFinite(rate)&&rate>=0&&rate<=1?rate:CONFIG.estimateRate;
  }

  /* 核心计算。rows = {key:{correct:数字|null,total:数字}}
     换算系数 = 100 ÷ Σ(共几题 × 每题分值)
     每行满分 = 共几题 × 每题分值 × 换算系数；每行得分 = 对几题 × 每题分值 × 换算系数
     共几题为 0 的行不参与；对几题为 null（没做）的行按 estimateRate 估 */
  function computeScore(examKey,rows,estimateRate){
    const exam=CONFIG.exams[examKey]||CONFIG.exams[LEGACY_EXAM],rate=clampRate(estimateRate);
    const countOf=key=>{const row=rows&&rows[key];return row?Math.max(0,Number(row.total)||0):0;};
    const weighted=SCORE_FIELDS.reduce((sum,field)=>sum+countOf(field.key)*exam.weights[field.key],0);
    const coef=weighted>0?100/weighted:0;
    const out={};let total=0,hasEstimate=false,answered=0,questions=0;
    SCORE_FIELDS.forEach(field=>{
      const count=countOf(field.key),weight=exam.weights[field.key];
      if(count<=0){out[field.key]={active:false,total:0,correct:null,estimated:false,accuracy:null,full:0,earned:0};return;}
      const raw=rows[field.key].correct,estimated=raw===null||raw===undefined;
      const correct=estimated?count*rate:Number(raw);
      const full=count*weight*coef,earned=correct*weight*coef;
      out[field.key]={active:true,total:count,correct:estimated?null:correct,estimated,accuracy:estimated?rate:correct/count,full,earned};
      total+=earned;questions+=count;
      if(estimated)hasEstimate=true;else answered+=correct;
    });
    return {coef,total:round2(total),hasEstimate,answered,questions,rows:out};
  }

  /* 校验并整理 9 行的 对/共；任何一行不合法返回 null */
  function normalizeRows(raw){
    if(!raw||typeof raw!=='object')return null;
    const rows={};
    for(const field of SCORE_FIELDS){
      const item=raw[field.key]||{};
      const total=item.total===undefined||item.total===null||item.total===''?0:Number(item.total);
      if(!Number.isInteger(total)||total<0||total>MAX_TOTAL)return null;
      let correct=item.correct;
      if(correct===undefined||correct===null||correct==='')correct=null;
      else{correct=Number(correct);if(!Number.isInteger(correct)||correct<0||correct>total)return null;}
      rows[field.key]={correct:total>0?correct:null,total};
    }
    return rows;
  }

  /* 旧记录：9 个「对几题」平铺在记录上，题量是当时写死的那组 */
  function legacyRows(record){
    const rows={};
    for(const field of SCORE_FIELDS){
      const total=CONFIG.legacyTotals[field.key],value=record[field.key];
      if(value===undefined||value===null||value==='')return null;
      const correct=Number(value);
      if(!Number.isInteger(correct)||correct<0||correct>total)return null;
      rows[field.key]={correct,total};
    }
    return rows;
  }

  function hasEstimate(record){
    return Boolean(record&&record.rows)&&SCORE_FIELDS.some(field=>{const row=record.rows[field.key];return row&&row.total>0&&row.correct===null;});
  }

  function judgementStats(record){
    if(!record||!record.rows)return null;
    let correct=0,total=0;
    JUDGEMENT_KEYS.forEach(key=>{const row=record.rows[key];if(!row||row.total<=0||row.correct===null)return;correct+=row.correct;total+=row.total;});
    return total>0?{correct,total}:null;
  }

  function compareAscending(a,b){
    return String(a.date).localeCompare(String(b.date))||String(a.createdAt||'').localeCompare(String(b.createdAt||''))||String(a.id||'').localeCompare(String(b.id||''));
  }
  function sortRecordsAscending(records){return [...records].sort(compareAscending);}
  function sortRecordsDescending(records){return sortRecordsAscending(records).reverse();}
  function recentRecords(records,limit){return sortRecordsAscending(records).slice(-Math.max(0,Number(limit)||0));}
  function removeRecordById(records,id){return records.filter(record=>record.id!==id);}
  function recordsOfExam(records,examKey){return records.filter(record=>record.exam===examKey);}

  function getStats(records){
    if(!records.length)return {latest:null,highest:null,average:null};
    const sorted=sortRecordsAscending(records),scores=records.map(record=>Number(record.totalScore));
    return {latest:scores.length?Number(sorted[sorted.length-1].totalScore):null,highest:Math.max(...scores),average:scores.reduce((sum,value)=>sum+value,0)/scores.length};
  }

  function fingerprint(payload){
    return JSON.stringify({exam:payload.exam,date:payload.date,durationSeconds:payload.durationSeconds,note:payload.note||'',estimateRate:payload.estimateRate,
      rows:SCORE_FIELDS.map(field=>{const row=(payload.rows||{})[field.key]||{};return [row.correct===undefined?null:row.correct,row.total||0];})});
  }

  /* 趋势图取值；没有数据（没原始数 / 共 0 题 / 没做）返回 null，图上跳过这个点 */
  function metricValue(record,key){
    if(key==='totalScore')return Number(record.totalScore);
    if(key==='judgement'){const stats=judgementStats(record);return stats?percent(stats.correct,stats.total):null;}
    const row=record.rows&&record.rows[key];
    return row&&row.total>0&&row.correct!==null?percent(row.correct,row.total):null;
  }

  /* 读入一条记录。有原始数的按当前每题分值重算总分；
     旧记录算省考；连原始数都没有的保留原总分。 */
  function normalizeRecord(record){
    if(!record||typeof record!=='object'||!isValidDate(record.date))return null;
    const rows=record.rows?normalizeRows(record.rows):legacyRows(record);
    const saved=Number(record.totalScore);
    const savedOk=record.totalScore!==null&&record.totalScore!==undefined&&record.totalScore!==''&&Number.isFinite(saved)&&saved>=0&&saved<=100;
    if(!rows&&!savedOk)return null;
    const exam=CONFIG.exams[record.exam]?record.exam:LEGACY_EXAM;
    const duration=Number(record.durationSeconds),estimateRate=clampRate(record.estimateRate);
    return {
      id:String(record.id||''),exam,date:record.date,
      durationSeconds:Number.isFinite(duration)&&duration>0?Math.floor(duration):0,
      rows,estimateRate,
      totalScore:rows?computeScore(exam,rows,estimateRate).total:round2(saved),
      note:String(record.note||'').slice(0,200),
      createdAt:String(record.createdAt||''),updatedAt:String(record.updatedAt||record.createdAt||'')
    };
  }

  function loadRecords(storage){
    try{
      const parsed=JSON.parse(storage.getItem(STORAGE_KEY)||'[]');
      return Array.isArray(parsed)?parsed.map(normalizeRecord).filter(Boolean):[];
    }catch(error){return [];}
  }

  function saveRecords(storage,records){storage.setItem(STORAGE_KEY,JSON.stringify(records));}

  function init(){
    const doc=document;
    const saveButton=doc.getElementById('scoreSaveBtn'),panelsHost=doc.getElementById('scoreExamPanels');
    if(!saveButton||!panelsHost)return;

    const elements={
      date:doc.getElementById('scoreDateInput'),duration:doc.getElementById('scoreDurationInput'),note:doc.getElementById('scoreNoteInput'),
      message:doc.getElementById('scoreSaveMessage'),clear:doc.getElementById('scoreClearBtn'),
      subTitle:doc.getElementById('scoreSubTitle'),summary:doc.getElementById('scoreSummaryText'),topBarFill:doc.getElementById('scoreTopBarFill'),
      saveTitle:doc.getElementById('scoreSaveTitle'),tabs:[...doc.querySelectorAll('[data-exam-tab]')],
      latest:doc.getElementById('scoreLatestStat'),highest:doc.getElementById('scoreHighestStat'),average:doc.getElementById('scoreAverageStat'),
      chart:doc.getElementById('scoreChartWrap'),chartCount:doc.getElementById('scoreChartCount'),toggles:doc.getElementById('scoreChartToggles'),
      recordCount:doc.getElementById('scoreRecordCount'),tableBody:doc.getElementById('scoreHistoryTableBody'),cards:doc.getElementById('scoreHistoryCards'),empty:doc.getElementById('scoreRecordsEmpty'),
      editOverlay:doc.getElementById('scoreEditOverlay'),editTitle:doc.getElementById('scoreEditTitle'),editGrid:doc.getElementById('scoreEditGrid'),editDate:doc.getElementById('scoreEditDate'),
      editDuration:doc.getElementById('scoreEditDuration'),editNote:doc.getElementById('scoreEditNote'),editError:doc.getElementById('scoreEditError'),
      editCancel:doc.getElementById('scoreEditCancel'),editSave:doc.getElementById('scoreEditSave')
    };
    const state={exam:DEFAULT_EXAM,records:loadRecords(localStorage),activeMetrics:new Set(['totalScore']),lastSavedFingerprint:null,expandedId:null,editingId:null};
    const panels={};
    elements.date.value=localToday();

    function el(tag,className,text){
      const node=doc.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node;
    }
    function svgEl(tag,attrs,text){
      const node=doc.createElementNS('http://www.w3.org/2000/svg',tag);
      Object.entries(attrs||{}).forEach(([key,value])=>node.setAttribute(key,String(value)));
      if(text!==undefined)node.textContent=text;return node;
    }
    function setMessage(text,success){elements.message.textContent=text;elements.message.classList.toggle('is-success',Boolean(success));}
    function markDirty(){saveButton.disabled=false;setMessage('',false);}
    function makeId(){return window.crypto&&typeof window.crypto.randomUUID==='function'?window.crypto.randomUUID():'score-'+Date.now()+'-'+Math.random().toString(16).slice(2);}
    function persist(){
      try{saveRecords(localStorage,state.records);return true;}
      catch(error){setMessage('浏览器存储空间不足，成绩未保存。',false);return false;}
    }
    function examLabel(key){return CONFIG.exams[key].label;}
    function visibleRecords(){return recordsOfExam(state.records,state.exam);}

    /* ---------- 成绩估算：国考 / 省考 两块，各管各的 ---------- */
    function numberInput(label,max){
      const input=el('input','score-input');input.type='number';input.min='0';if(max)input.max=String(max);input.step='1';input.inputMode='numeric';input.autocomplete='off';input.setAttribute('aria-label',label);return input;
    }

    function buildPanel(examKey){
      const exam=CONFIG.exams[examKey],panel=el('div','score-exam-panel');panel.dataset.examPanel=examKey;
      const wrap=el('div','score-table-wrap'),table=el('table','score-table');table.setAttribute('aria-label',exam.label+'成绩估算表');
      const thead=el('thead'),headRow=el('tr');
      ['模块','对几题','共几题','正确率'].forEach(text=>headRow.appendChild(el('th','',text)));
      const pointsHead=el('th'),pointsPair=el('span','score-pair-heading');pointsPair.append(el('span','','得分'),el('span','score-divider','/'),el('span','','满分'));pointsHead.appendChild(pointsPair);headRow.appendChild(pointsHead);
      thead.appendChild(headRow);table.appendChild(thead);
      const tbody=el('tbody'),ui={panel,rows:{}};
      const onChange=()=>{renderEstimator(examKey);markDirty();};
      SCORE_FIELDS.forEach(field=>{
        const tr=el('tr','score-data-row');
        const correctInput=numberInput(exam.label+field.label+'对几题'),totalInput=numberInput(exam.label+field.label+'共几题',MAX_TOTAL);
        correctInput.placeholder='没做';totalInput.value=String(exam.totals[field.key]);
        const rateOut=el('output','score-rate'),earnedOut=el('output','score-earned'),fullOut=el('span','score-fraction');
        const correctCell=el('td','score-count-cell'),totalCell=el('td','score-count-cell'),rateCell=el('td','score-count-cell'),pointsCell=el('td','score-points-cell'),pair=el('span','score-pair');
        correctCell.appendChild(correctInput);totalCell.appendChild(totalInput);rateCell.appendChild(rateOut);
        pair.append(earnedOut,el('span','score-divider','/'),fullOut);pointsCell.appendChild(pair);
        tr.append(el('td','score-section-cell',field.label),correctCell,totalCell,rateCell,pointsCell);tbody.appendChild(tr);
        [correctInput,totalInput].forEach(input=>{input.addEventListener('input',onChange);input.addEventListener('change',onChange);});
        /* 「共几题」填 0 的行，等输入框失焦后再收起，免得打字打到一半行就没了 */
        totalInput.addEventListener('blur',()=>setTimeout(()=>renderEstimator(examKey),0));
        ui.rows[field.key]={tr,correctInput,totalInput,rateOut,earnedOut,fullOut};
      });
      const totalRow=el('tr','score-total-row'),totalCell=el('td','score-points-cell'),totalPair=el('span','score-pair'),totalFull=el('span','score-fraction','100');
      const spacer=el('td');spacer.colSpan=3;
      ui.totalOut=el('output','score-total-output','0.00');ui.badge=el('em','score-est-badge','含估算');ui.badge.hidden=true;totalFull.appendChild(ui.badge);
      totalPair.append(ui.totalOut,el('span','score-divider','/'),totalFull);totalCell.appendChild(totalPair);
      totalRow.append(el('td','score-section-cell','总分'),spacer,totalCell);tbody.appendChild(totalRow);
      table.appendChild(tbody);wrap.appendChild(table);

      const tools=el('div','score-tools'),rateLabel=el('label','score-rate-setting');
      ui.rateInput=numberInput(exam.label+'估算正确率',100);ui.rateInput.value=String(Math.round(CONFIG.estimateRate*100));
      rateLabel.append(doc.createTextNode('「对几题」留空的按'),ui.rateInput,doc.createTextNode('% 正确率估'));
      ui.rateInput.addEventListener('input',onChange);ui.rateInput.addEventListener('change',onChange);
      const resetButton=el('button','score-clear-btn','恢复默认题量');resetButton.type='button';
      resetButton.addEventListener('click',()=>{SCORE_FIELDS.forEach(field=>{ui.rows[field.key].totalInput.value=String(exam.totals[field.key]);});onChange();});
      tools.append(rateLabel,resetButton);
      panel.append(wrap,tools);panelsHost.appendChild(panel);panels[examKey]=ui;
    }

    /* 读出一块当前填的内容，顺手把不合法的输入框标红 */
    function readPanel(examKey){
      const ui=panels[examKey],rows={},zeroRows=[];let hasInvalid=false;
      SCORE_FIELDS.forEach(field=>{
        const row=ui.rows[field.key];
        const totalRaw=row.totalInput.value.trim(),totalNumber=Number(totalRaw);
        const totalValid=totalRaw!==''&&Number.isInteger(totalNumber)&&totalNumber>=0&&totalNumber<=MAX_TOTAL,total=totalValid?totalNumber:0;
        const correctRaw=row.correctInput.value.trim(),correctNumber=Number(correctRaw);
        let correct=null,correctValid=!row.correctInput.validity.badInput;
        if(total>0&&correctValid&&correctRaw!==''){correctValid=Number.isInteger(correctNumber)&&correctNumber>=0&&correctNumber<=total;correct=correctValid?correctNumber:0;}
        row.totalInput.classList.toggle('is-invalid',!totalValid);
        row.correctInput.classList.toggle('is-invalid',total>0&&!correctValid);
        if(!totalValid||(total>0&&!correctValid))hasInvalid=true;
        if(totalValid&&total===0)zeroRows.push(field.key);
        rows[field.key]={correct:total>0?correct:null,total};
      });
      const rateRaw=ui.rateInput.value.trim(),rateNumber=Number(rateRaw),rateValid=rateRaw!==''&&Number.isFinite(rateNumber)&&rateNumber>=0&&rateNumber<=100;
      ui.rateInput.classList.toggle('is-invalid',!rateValid);if(!rateValid)hasInvalid=true;
      const estimateRate=rateValid?rateNumber/100:CONFIG.estimateRate;
      return {exam:examKey,rows,estimateRate,hasInvalid,zeroRows,result:computeScore(examKey,rows,estimateRate)};
    }

    function renderEstimator(examKey){
      const ui=panels[examKey],snapshot=readPanel(examKey),result=snapshot.result;let hiddenCount=0;
      SCORE_FIELDS.forEach(field=>{
        const row=ui.rows[field.key],info=result.rows[field.key];
        const hide=snapshot.zeroRows.includes(field.key)&&doc.activeElement!==row.totalInput;
        row.tr.hidden=hide;if(hide)hiddenCount++;
        row.tr.classList.toggle('is-estimated',info.estimated);
        row.rateOut.textContent=info.active?formatPercent(info.accuracy*100)+(info.estimated?'（估）':''):'--';
        row.earnedOut.textContent=formatFixed(info.earned);row.fullOut.textContent=formatFixed(info.full);
      });
      ui.totalOut.textContent=formatFixed(result.total);ui.badge.hidden=!result.hasEstimate;
      if(examKey!==state.exam)return;
      const exam=CONFIG.exams[examKey];
      elements.subTitle.textContent=exam.label+' · '+exam.paper+'默认题量 · 总分 / 100';
      elements.summary.textContent='已填答对 '+result.answered+' 题 · 共 '+result.questions+' 题 · 估算 '+formatFixed(result.total)+' / 100 分'+(result.hasEstimate?'（含估算）':'')
        +(hiddenCount?' · 有 '+hiddenCount+' 行共 0 题已收起，点「恢复默认题量」找回':'');
      if(elements.topBarFill)elements.topBarFill.style.width=Math.min(100,Math.max(0,result.total))+'%';
    }

    function setExam(examKey){
      if(!CONFIG.exams[examKey])return;
      state.exam=examKey;state.expandedId=null;
      elements.tabs.forEach(tab=>{const active=tab.dataset.examTab===examKey;tab.setAttribute('aria-selected',String(active));tab.classList.toggle('active',active);});
      EXAM_KEYS.forEach(key=>{panels[key].panel.hidden=key!==examKey;});
      elements.saveTitle.textContent='保存本次'+examLabel(examKey)+'成绩';saveButton.textContent='保存本次'+examLabel(examKey)+'成绩';
      renderEstimator(examKey);markDirty();renderAll();
    }

    function saveCurrentScore(){
      const snapshot=readPanel(state.exam);
      if(snapshot.hasInvalid){setMessage('有填错的格子（标红）：对几题不能超过共几题，题量须为整数。',false);return;}
      if(snapshot.result.questions<=0){setMessage('所有行的「共几题」都是 0，没法算分。',false);return;}
      if(!SCORE_FIELDS.some(field=>snapshot.rows[field.key].correct!==null)){setMessage('至少填一行「对几题」再保存。',false);return;}
      if(!isValidDate(elements.date.value)){setMessage('请选择有效的考试日期。',false);elements.date.classList.add('is-invalid');return;}
      elements.date.classList.remove('is-invalid');
      const durationSeconds=parseDuration(elements.duration.value);
      if(durationSeconds===null){setMessage('请输入合法用时，例如 1h45m43s、45m 或 2h。',false);elements.duration.classList.add('is-invalid');return;}
      elements.duration.classList.remove('is-invalid');
      if(elements.note.value.length>200){setMessage('备注不能超过 200 个字符。',false);return;}
      const payload={exam:snapshot.exam,date:elements.date.value,durationSeconds,rows:snapshot.rows,estimateRate:snapshot.estimateRate,totalScore:snapshot.result.total,note:elements.note.value.trim()};
      const currentFingerprint=fingerprint(payload);
      if(currentFingerprint===state.lastSavedFingerprint){setMessage('当前数据已经保存，请修改后再保存。',false);return;}
      const now=new Date().toISOString();
      state.records.push(Object.assign({id:makeId(),createdAt:now,updatedAt:now},payload));
      if(!persist()){state.records.pop();return;}
      state.lastSavedFingerprint=currentFingerprint;saveButton.disabled=true;setMessage(examLabel(snapshot.exam)+'成绩已保存',true);
      if(typeof window.showToast==='function')window.showToast('成绩已保存');
      renderAll();
    }

    /* 只清当前这块的「对几题」，题量不动 */
    function clearEstimator(){
      const ui=panels[state.exam];
      SCORE_FIELDS.forEach(field=>{ui.rows[field.key].correctInput.value='';});
      renderEstimator(state.exam);state.lastSavedFingerprint=null;saveButton.disabled=false;setMessage(examLabel(state.exam)+'的「对几题」已清空',true);
    }

    /* ---------- 成绩记录：统计、列表、趋势图都只看当前标签 ---------- */
    function renderStats(){
      const stats=getStats(visibleRecords());
      elements.latest.textContent=stats.latest===null?'--':formatScore(stats.latest);
      elements.highest.textContent=stats.highest===null?'--':formatScore(stats.highest);
      elements.average.textContent=stats.average===null?'--':formatScore(stats.average);
    }

    function appendTextCell(row,text,className){const cell=el('td',className,text);row.appendChild(cell);return cell;}
    function fractionText(correct,total){return correct+'/'+total+' · '+formatPercent(percent(correct,total));}
    function fieldText(record,key){
      const row=record.rows&&record.rows[key];
      if(!row||row.total<=0)return '--';
      if(row.correct===null)return '没做/'+row.total+' · 估';
      return fractionText(row.correct,row.total);
    }
    function judgementText(record){const stats=judgementStats(record);return stats?fractionText(stats.correct,stats.total):'--';}
    function durationText(record){return record.durationSeconds>0?formatDuration(record.durationSeconds):'--';}
    function totalText(record){return formatScore(record.totalScore)+(hasEstimate(record)?'（含估算）':'');}
    function toggleDetails(id){state.expandedId=state.expandedId===id?null:id;renderRecords();}

    function makeDetailContent(record){
      const content=el('div','score-detail-content');
      if(record.rows)JUDGEMENT_KEYS.forEach(key=>{
        const item=el('div');item.append(el('strong','',FIELD_BY_KEY[key].label),doc.createTextNode(fieldText(record,key)));content.appendChild(item);
      });
      else{const item=el('div','score-detail-note');item.append(el('strong','','没有原始题数'),doc.createTextNode('这条记录只保留了当时的总分。'));content.appendChild(item);}
      if(record.note){const note=el('div','score-detail-note');note.append(el('strong','','完整备注'),doc.createTextNode(record.note));content.appendChild(note);}
      return content;
    }

    function makeActionButton(label,className,handler){const button=el('button','score-action-btn '+(className||''),label);button.type='button';button.addEventListener('click',handler);return button;}

    function renderTable(records){
      elements.tableBody.replaceChildren();
      records.forEach(record=>{
        const row=el('tr');appendTextCell(row,record.date);appendTextCell(row,durationText(record));
        const totalCell=appendTextCell(row,formatScore(record.totalScore),'score-total-cell');
        if(hasEstimate(record)){totalCell.appendChild(el('em','score-est-badge','含估算'));totalCell.title='有没做的模块，按 '+formatPercent(record.estimateRate*100)+' 正确率估算';}
        appendTextCell(row,fieldText(record,'politics'));appendTextCell(row,fieldText(record,'commonSense'));appendTextCell(row,fieldText(record,'verbal'));appendTextCell(row,fieldText(record,'quantity'));
        const judgementCell=el('td'),judgementButton=el('button','score-judgement-toggle',judgementText(record));judgementButton.type='button';judgementButton.title='查看判断推理四项明细';judgementButton.addEventListener('click',()=>toggleDetails(record.id));judgementCell.appendChild(judgementButton);row.appendChild(judgementCell);
        appendTextCell(row,fieldText(record,'dataAnalysis'));
        const noteCell=el('td'),noteButton=el('button','score-note-preview',record.note||'--');noteButton.type='button';noteButton.title=record.note||'无备注';noteButton.addEventListener('click',()=>toggleDetails(record.id));noteCell.appendChild(noteButton);row.appendChild(noteCell);
        const actions=el('td'),actionWrap=el('div','score-actions');actionWrap.append(makeActionButton('编辑','',()=>openEditor(record.id)),makeActionButton('删除','is-danger',()=>deleteRecord(record.id)));actions.appendChild(actionWrap);row.appendChild(actions);
        elements.tableBody.appendChild(row);
        if(state.expandedId===record.id){const detailRow=el('tr','score-detail-row'),detailCell=el('td');detailCell.colSpan=11;detailCell.appendChild(makeDetailContent(record));detailRow.appendChild(detailCell);elements.tableBody.appendChild(detailRow);}
      });
    }

    function addCardMetric(grid,label,value){const item=el('div');item.append(el('span','',label+' '),el('strong','',value));grid.appendChild(item);}
    function renderCards(records){
      elements.cards.replaceChildren();
      records.forEach(record=>{
        const card=el('article','score-record-card'),head=el('div','score-card-head'),title=el('div');
        title.append(el('div','score-card-score',totalText(record)+' 分'),el('div','score-card-meta',record.date+' · '+durationText(record)));head.appendChild(title);card.appendChild(head);
        const grid=el('div','score-card-grid');
        addCardMetric(grid,'政治',fieldText(record,'politics'));addCardMetric(grid,'常识',fieldText(record,'commonSense'));addCardMetric(grid,'言语',fieldText(record,'verbal'));
        addCardMetric(grid,'数量',fieldText(record,'quantity'));addCardMetric(grid,'判断',judgementText(record));addCardMetric(grid,'资料',fieldText(record,'dataAnalysis'));card.appendChild(grid);
        const details=el('details','score-card-details'),summary=el('summary','', '查看判断推理明细');details.append(summary,makeDetailContent(record));card.appendChild(details);
        if(record.note){const note=el('div','score-card-note','备注：'+record.note);note.title=record.note;card.appendChild(note);}
        const actions=el('div','score-card-actions');actions.append(makeActionButton('编辑','',()=>openEditor(record.id)),makeActionButton('删除','is-danger',()=>deleteRecord(record.id)));card.appendChild(actions);elements.cards.appendChild(card);
      });
    }

    function renderRecords(){
      const records=sortRecordsDescending(visibleRecords()),hasRecords=records.length>0;
      elements.recordCount.textContent=examLabel(state.exam)+' '+records.length+' 条';elements.empty.hidden=hasRecords;
      elements.empty.textContent='暂无'+examLabel(state.exam)+'成绩记录';
      renderTable(records);renderCards(records);
    }

    function tooltipText(record,metric){
      if(metric.key==='totalScore')return record.date+'\n总成绩：'+totalText(record)+'\n用时：'+durationText(record);
      let correct,total,label;
      if(metric.key==='judgement'){const stats=judgementStats(record);correct=stats.correct;total=stats.total;label='判断推理';}
      else{const row=record.rows[metric.key];correct=row.correct;total=row.total;label=FIELD_BY_KEY[metric.key].label;}
      return record.date+'\n'+label+'\n'+correct+'/'+total+'\n正确率：'+formatPercent(percent(correct,total));
    }

    function chartEmpty(title,subtitle){const empty=el('div','score-chart-empty');empty.append(el('strong','',title),el('span','',subtitle));elements.chart.appendChild(empty);}

    function renderChart(){
      elements.chart.replaceChildren();
      const records=recentRecords(visibleRecords(),10),metrics=METRICS.filter(metric=>state.activeMetrics.has(metric.key));
      elements.chartCount.textContent=records.length?examLabel(state.exam)+' '+records.length+' 次':'';
      if(!records.length){chartEmpty('暂无'+examLabel(state.exam)+'成绩记录','在成绩估算里保存一次'+examLabel(state.exam)+'成绩后，即可查看趋势。');return;}
      if(!metrics.length){chartEmpty('请选择下方指标查看趋势。','可同时开启多条折线进行比较。');return;}
      const rect=elements.chart.getBoundingClientRect(),width=Math.max(320,Math.round(rect.width||900)),height=Math.max(230,Math.round(rect.height||320));
      const margin={left:42,right:18,top:20,bottom:42},plotWidth=width-margin.left-margin.right,plotHeight=height-margin.top-margin.bottom;
      const values=[];records.forEach(record=>metrics.forEach(metric=>{const value=metricValue(record,metric.key);if(value!==null)values.push(value);}));
      if(!values.length){chartEmpty('所选指标没有数据。','这些记录没有对应模块的原始题数。');return;}
      let min=Math.min(...values),max=Math.max(...values);
      if(max-min<8){const center=(max+min)/2;min=center-5;max=center+5;}else{const padding=(max-min)*.14;min-=padding;max+=padding;}
      min=Math.max(0,Math.floor(min));max=Math.min(100,Math.ceil(max));if(max-min<10){min=Math.max(0,max-10);max=Math.min(100,min+10);}
      const xAt=index=>records.length===1?margin.left+plotWidth/2:margin.left+plotWidth*index/(records.length-1);
      const yAt=value=>margin.top+(max-value)/(max-min)*plotHeight;
      const svg=svgEl('svg',{viewBox:'0 0 '+width+' '+height,role:'img','aria-label':examLabel(state.exam)+'成绩趋势折线图'});
      for(let index=0;index<5;index++){
        const value=max-(max-min)*index/4,y=yAt(value);
        svg.append(svgEl('line',{x1:margin.left,y1:y,x2:width-margin.right,y2:y,stroke:'rgba(90,80,70,.12)','stroke-width':1}),svgEl('text',{x:margin.left-7,y:y+3,'text-anchor':'end',fill:'currentColor','font-size':9,opacity:.58},formatScore(value)));
      }
      const labelStep=records.length<=5?1:Math.ceil((records.length-1)/4);
      records.forEach((record,index)=>{
        if(index%labelStep!==0&&index!==records.length-1)return;
        const label=record.date.slice(5);svg.appendChild(svgEl('text',{x:xAt(index),y:height-16,'text-anchor':'middle',fill:'currentColor','font-size':9,opacity:.58},label));
      });
      const tooltip=el('div','score-chart-tooltip');tooltip.hidden=true;elements.chart.appendChild(tooltip);
      function showTooltip(record,metric,x,y){
        tooltip.textContent=tooltipText(record,metric);tooltip.hidden=false;
        requestAnimationFrame(()=>{const maxLeft=elements.chart.clientWidth-tooltip.offsetWidth-6,maxTop=elements.chart.clientHeight-tooltip.offsetHeight-6;tooltip.style.left=Math.max(6,Math.min(x+10,maxLeft))+'px';tooltip.style.top=Math.max(6,Math.min(y-tooltip.offsetHeight-8,maxTop))+'px';});
      }
      metrics.forEach(metric=>{
        const points=[];records.forEach((record,index)=>{const value=metricValue(record,metric.key);if(value!==null)points.push({record,x:xAt(index),y:yAt(value)});});
        if(points.length>1){const path=points.map((point,index)=>(index?'L':'M')+point.x.toFixed(2)+' '+point.y.toFixed(2)).join(' ');svg.appendChild(svgEl('path',{d:path,fill:'none',stroke:metric.color,'stroke-width':2.2,'stroke-linecap':'round','stroke-linejoin':'round','vector-effect':'non-scaling-stroke'}));}
        points.forEach(point=>{
          const circle=svgEl('circle',{cx:point.x,cy:point.y,r:4.2,fill:metric.color,stroke:'rgba(255,255,255,.92)','stroke-width':2,tabindex:0,role:'button','aria-label':tooltipText(point.record,metric).replace(/\n/g,'，')});
          const show=()=>showTooltip(point.record,metric,point.x,point.y);circle.addEventListener('mouseenter',show);circle.addEventListener('focus',show);circle.addEventListener('mouseleave',()=>{tooltip.hidden=true;});circle.addEventListener('blur',()=>{tooltip.hidden=true;});
          circle.addEventListener('click',event=>{event.stopPropagation();show();});svg.appendChild(circle);
        });
      });
      elements.chart.prepend(svg);
      elements.chart.onclick=event=>{if(event.target===elements.chart||event.target===svg)tooltip.hidden=true;};
      if(records.length===1)elements.chart.appendChild(el('div','score-chart-note','再记录一次成绩后即可形成趋势。'));
    }

    function buildToggles(){
      elements.toggles.replaceChildren();
      METRICS.forEach(metric=>{
        const button=el('button','score-chart-toggle');button.type='button';button.style.setProperty('--line-color',metric.color);button.setAttribute('aria-pressed',String(state.activeMetrics.has(metric.key)));
        button.append(el('span','score-chart-toggle-dot'),doc.createTextNode(metric.label));
        button.addEventListener('click',()=>{if(state.activeMetrics.has(metric.key))state.activeMetrics.delete(metric.key);else state.activeMetrics.add(metric.key);button.setAttribute('aria-pressed',String(state.activeMetrics.has(metric.key)));renderChart();});
        elements.toggles.appendChild(button);
      });
    }

    /* 编辑弹窗：每行改 对/共 原始数；对几题留空 = 没做 */
    function buildEditFields(){
      elements.editGrid.replaceChildren();
      SCORE_FIELDS.forEach(field=>{
        const wrap=el('div','score-form-field score-edit-field'),pair=el('div','score-edit-pair');
        const correct=el('input'),total=el('input');
        [correct,total].forEach(input=>{input.type='number';input.min='0';input.step='1';input.inputMode='numeric';});
        correct.dataset.editCorrect=field.key;correct.placeholder='没做';correct.setAttribute('aria-label',field.label+'对几题');
        total.dataset.editTotal=field.key;total.max=String(MAX_TOTAL);total.setAttribute('aria-label',field.label+'共几题');
        pair.append(correct,el('span','score-divider','/'),total);wrap.append(el('span','',field.label+'（对 / 共）'),pair);elements.editGrid.appendChild(wrap);
      });
    }

    function openEditor(id){
      const record=state.records.find(item=>item.id===id);if(!record)return;
      state.editingId=id;elements.editTitle.textContent='编辑'+examLabel(record.exam)+'成绩记录';
      elements.editDate.value=record.date;elements.editDuration.value=record.durationSeconds>0?formatDuration(record.durationSeconds):'';elements.editNote.value=record.note;elements.editError.textContent='';
      elements.editGrid.hidden=!record.rows;
      if(record.rows)SCORE_FIELDS.forEach(field=>{
        const row=record.rows[field.key];
        elements.editGrid.querySelector('[data-edit-correct="'+field.key+'"]').value=row.correct===null?'':String(row.correct);
        elements.editGrid.querySelector('[data-edit-total="'+field.key+'"]').value=String(row.total);
      });
      elements.editOverlay.classList.add('show');
    }
    function closeEditor(){elements.editOverlay.classList.remove('show');state.editingId=null;elements.editError.textContent='';}
    function saveEditedRecord(){
      const record=state.records.find(item=>item.id===state.editingId);if(!record)return;
      if(!isValidDate(elements.editDate.value)){elements.editError.textContent='请选择有效的考试日期。';return;}
      let durationSeconds=parseDuration(elements.editDuration.value);
      if(durationSeconds===null&&record.durationSeconds===0&&elements.editDuration.value.trim()==='')durationSeconds=0;
      if(durationSeconds===null){elements.editError.textContent='请输入合法用时，例如 1h45m43s、45m 或 2h。';return;}
      let rows=record.rows,totalScore=record.totalScore;
      if(record.rows){
        const raw={};
        for(const field of SCORE_FIELDS){
          const correctInput=elements.editGrid.querySelector('[data-edit-correct="'+field.key+'"]'),totalInput=elements.editGrid.querySelector('[data-edit-total="'+field.key+'"]');
          const item={correct:correctInput.value.trim(),total:totalInput.value.trim()};
          if(correctInput.validity.badInput||totalInput.validity.badInput||item.total===''||!normalizeRows({[field.key]:item})){
            elements.editError.textContent=field.label+'：共几题须为 0 到 '+MAX_TOTAL+' 的整数，对几题须为 0 到共几题之间的整数（没做就留空）。';return;
          }
          raw[field.key]=item;
        }
        rows=normalizeRows(raw);
        const result=computeScore(record.exam,rows,record.estimateRate);
        if(result.questions<=0){elements.editError.textContent='所有行的「共几题」都是 0，没法算分。';return;}
        totalScore=result.total;
      }
      if(elements.editNote.value.length>200){elements.editError.textContent='备注不能超过 200 个字符。';return;}
      const updated=Object.assign({},record,{rows,date:elements.editDate.value,durationSeconds,totalScore,note:elements.editNote.value.trim(),updatedAt:new Date().toISOString()});
      const index=state.records.findIndex(item=>item.id===record.id);state.records[index]=updated;
      if(!persist()){state.records[index]=record;return;}
      closeEditor();renderAll();if(typeof window.showToast==='function')window.showToast('成绩记录已更新');
    }

    function deleteRecord(id){
      const record=state.records.find(item=>item.id===id);if(!record)return;
      if(!window.confirm('确定删除 '+record.date+'，'+formatScore(record.totalScore)+' 分的'+examLabel(record.exam)+'成绩记录吗？'))return;
      const previousRecords=state.records;state.records=removeRecordById(state.records,id);
      if(!persist()){state.records=previousRecords;return;}
      if(state.expandedId===id)state.expandedId=null;renderAll();if(typeof window.showToast==='function')window.showToast('成绩记录已删除');
    }

    function renderAll(){renderStats();renderRecords();renderChart();}
    window.scoreHistoryRefresh=renderAll;
    window.scoreHistoryApp={getRecords:()=>state.records.map(record=>Object.assign({},record)),render:renderAll};

    EXAM_KEYS.forEach(buildPanel);buildToggles();buildEditFields();
    EXAM_KEYS.forEach(renderEstimator);setExam(state.exam);
    elements.tabs.forEach(tab=>tab.addEventListener('click',()=>setExam(tab.dataset.examTab)));
    saveButton.addEventListener('click',saveCurrentScore);elements.clear.addEventListener('click',clearEstimator);
    [elements.date,elements.duration,elements.note].forEach(input=>input.addEventListener('input',markDirty));
    elements.editCancel.addEventListener('click',closeEditor);elements.editSave.addEventListener('click',saveEditedRecord);
    elements.editOverlay.addEventListener('click',event=>{if(event.target===elements.editOverlay)closeEditor();});
    doc.addEventListener('keydown',event=>{if(event.key==='Escape'&&elements.editOverlay.classList.contains('show'))closeEditor();});
    window.addEventListener('storage',event=>{if(event.key===STORAGE_KEY){state.records=loadRecords(localStorage);renderAll();}});
    let resizeTimer=null;window.addEventListener('resize',()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(renderChart,120);});
  }

  return {STORAGE_KEY,CONFIG,SCORE_FIELDS,METRICS,parseDuration,formatDuration,isValidDate,formatScore,formatPercent,percent,computeScore,normalizeRows,hasEstimate,judgementStats,sortRecordsAscending,sortRecordsDescending,recentRecords,removeRecordById,recordsOfExam,getStats,fingerprint,metricValue,normalizeRecord,init};
});
