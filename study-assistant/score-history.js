(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  root.ScoreHistoryUtils=api;
  if(root.document){
    if(root.document.readyState==='loading')root.document.addEventListener('DOMContentLoaded',api.init,{once:true});
    else api.init();
  }
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';

  const STORAGE_KEY='study-score-history.v1';
  const SCORE_FIELDS=[
    {key:'politics',label:'政治理论',shortLabel:'政治',total:10},
    {key:'commonSense',label:'常识判断',shortLabel:'常识',total:10},
    {key:'verbal',label:'言语理解',shortLabel:'言语',total:25},
    {key:'quantity',label:'数量关系',shortLabel:'数量',total:20},
    {key:'graphic',label:'图形推理',shortLabel:'图形',total:10},
    {key:'definition',label:'定义判断',shortLabel:'定义',total:10},
    {key:'analogy',label:'类比推理',shortLabel:'类比',total:10},
    {key:'logic',label:'逻辑判断',shortLabel:'逻辑',total:10},
    {key:'dataAnalysis',label:'资料分析',shortLabel:'资料',total:15}
  ];
  const FIELD_BY_KEY=Object.fromEntries(SCORE_FIELDS.map(field=>[field.key,field]));
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

  function formatScore(value){
    const rounded=Math.round((Number(value)+Number.EPSILON)*100)/100;
    return rounded.toFixed(2).replace(/\.?0+$/,'');
  }

  function formatPercent(value){
    const rounded=Math.round((Number(value)+Number.EPSILON)*10)/10;
    return rounded.toFixed(1).replace(/\.0$/,'')+'%';
  }

  function percent(correct,total){return total>0?Number(correct||0)/total*100:0;}
  function judgementCorrect(record){return ['graphic','definition','analogy','logic'].reduce((sum,key)=>sum+Number(record[key]||0),0);}

  function validateScoreValues(values){
    for(const field of SCORE_FIELDS){
      const value=Number(values[field.key]);
      if(!Number.isInteger(value)||value<0||value>field.total)return {valid:false,field};
    }
    return {valid:true,field:null};
  }

  function compareAscending(a,b){
    return String(a.date).localeCompare(String(b.date))||String(a.createdAt||'').localeCompare(String(b.createdAt||''))||String(a.id||'').localeCompare(String(b.id||''));
  }
  function sortRecordsAscending(records){return [...records].sort(compareAscending);}
  function sortRecordsDescending(records){return sortRecordsAscending(records).reverse();}
  function recentRecords(records,limit){return sortRecordsAscending(records).slice(-Math.max(0,Number(limit)||0));}
  function removeRecordById(records,id){return records.filter(record=>record.id!==id);}

  function getStats(records){
    if(!records.length)return {latest:null,highest:null,average:null};
    const sorted=sortRecordsAscending(records),scores=records.map(record=>Number(record.totalScore));
    return {latest:scores.length?Number(sorted[sorted.length-1].totalScore):null,highest:Math.max(...scores),average:scores.reduce((sum,value)=>sum+value,0)/scores.length};
  }

  function fingerprint(payload){
    const normalized={date:payload.date,durationSeconds:payload.durationSeconds,note:payload.note||''};
    SCORE_FIELDS.forEach(field=>{normalized[field.key]=Number(payload[field.key]);});
    return JSON.stringify(normalized);
  }

  function metricValue(record,key){
    if(key==='totalScore')return Number(record.totalScore);
    if(key==='judgement')return percent(judgementCorrect(record),40);
    return percent(record[key],FIELD_BY_KEY[key].total);
  }

  function normalizeRecord(record){
    if(!record||typeof record!=='object'||!isValidDate(record.date))return null;
    const values={};
    SCORE_FIELDS.forEach(field=>{values[field.key]=Number(record[field.key]);});
    if(!validateScoreValues(values).valid)return null;
    const durationSeconds=Number(record.durationSeconds),totalScore=Number(record.totalScore);
    if(!Number.isFinite(durationSeconds)||durationSeconds<=0||!Number.isFinite(totalScore)||totalScore<0||totalScore>100)return null;
    return Object.assign(values,{
      id:String(record.id||''),date:record.date,durationSeconds:Math.floor(durationSeconds),
      totalScore:Math.round((totalScore+Number.EPSILON)*100)/100,note:String(record.note||'').slice(0,200),
      createdAt:String(record.createdAt||''),updatedAt:String(record.updatedAt||record.createdAt||'')
    });
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
    const estimator=window.scoreEstimator;
    const saveButton=doc.getElementById('scoreSaveBtn');
    if(!estimator||!saveButton)return;

    const elements={
      date:doc.getElementById('scoreDateInput'),duration:doc.getElementById('scoreDurationInput'),note:doc.getElementById('scoreNoteInput'),
      message:doc.getElementById('scoreSaveMessage'),clear:doc.getElementById('scoreClearBtn'),
      latest:doc.getElementById('scoreLatestStat'),highest:doc.getElementById('scoreHighestStat'),average:doc.getElementById('scoreAverageStat'),
      chart:doc.getElementById('scoreChartWrap'),chartCount:doc.getElementById('scoreChartCount'),toggles:doc.getElementById('scoreChartToggles'),
      recordCount:doc.getElementById('scoreRecordCount'),tableBody:doc.getElementById('scoreHistoryTableBody'),cards:doc.getElementById('scoreHistoryCards'),empty:doc.getElementById('scoreRecordsEmpty'),
      editOverlay:doc.getElementById('scoreEditOverlay'),editGrid:doc.getElementById('scoreEditGrid'),editDate:doc.getElementById('scoreEditDate'),
      editDuration:doc.getElementById('scoreEditDuration'),editNote:doc.getElementById('scoreEditNote'),editError:doc.getElementById('scoreEditError'),
      editCancel:doc.getElementById('scoreEditCancel'),editSave:doc.getElementById('scoreEditSave')
    };
    const state={records:loadRecords(localStorage),activeMetrics:new Set(['totalScore']),lastSavedFingerprint:null,expandedId:null,editingId:null};
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

    function recordPayload(snapshot,durationSeconds){
      return Object.assign({},snapshot.values,{date:elements.date.value,durationSeconds,totalScore:snapshot.totalScore,note:elements.note.value.trim()});
    }

    function saveCurrentScore(){
      const snapshot=estimator.getSnapshot();
      if(!snapshot.complete){
        setMessage(snapshot.hasInvalid?'正确题数必须是题型范围内的整数。':'请先完成全部 120 题成绩录入。',false);return;
      }
      if(!isValidDate(elements.date.value)){setMessage('请选择有效的考试日期。',false);elements.date.classList.add('is-invalid');return;}
      elements.date.classList.remove('is-invalid');
      const durationSeconds=parseDuration(elements.duration.value);
      if(durationSeconds===null){setMessage('请输入合法用时，例如 1h45m43s、45m 或 2h。',false);elements.duration.classList.add('is-invalid');return;}
      elements.duration.classList.remove('is-invalid');
      if(elements.note.value.length>200){setMessage('备注不能超过 200 个字符。',false);return;}
      const payload=recordPayload(snapshot,durationSeconds),currentFingerprint=fingerprint(payload);
      if(currentFingerprint===state.lastSavedFingerprint){setMessage('当前数据已经保存，请修改后再保存。',false);return;}
      const now=new Date().toISOString();
      state.records.push(Object.assign({id:makeId(),createdAt:now,updatedAt:now},payload));
      if(!persist()){state.records.pop();return;}
      state.lastSavedFingerprint=currentFingerprint;saveButton.disabled=true;setMessage('成绩已保存',true);
      if(typeof window.showToast==='function')window.showToast('成绩已保存');
      renderAll();
    }

    function clearEstimator(){
      estimator.clear();state.lastSavedFingerprint=null;saveButton.disabled=false;setMessage('成绩估算已清空',true);
    }

    function renderStats(){
      const stats=getStats(state.records);
      elements.latest.textContent=stats.latest===null?'--':formatScore(stats.latest);
      elements.highest.textContent=stats.highest===null?'--':formatScore(stats.highest);
      elements.average.textContent=stats.average===null?'--':formatScore(stats.average);
    }

    function appendTextCell(row,text,className){const cell=el('td',className,text);row.appendChild(cell);return cell;}
    function fractionText(correct,total){return correct+'/'+total+' · '+formatPercent(percent(correct,total));}
    function judgementText(record){return fractionText(judgementCorrect(record),40);}
    function toggleDetails(id){state.expandedId=state.expandedId===id?null:id;renderRecords();}

    function makeDetailContent(record){
      const content=el('div','score-detail-content');
      ['graphic','definition','analogy','logic'].forEach(key=>{
        const field=FIELD_BY_KEY[key],item=el('div');item.append(el('strong','',field.label),doc.createTextNode(fractionText(record[key],field.total)));content.appendChild(item);
      });
      if(record.note){const note=el('div','score-detail-note');note.append(el('strong','','完整备注'),doc.createTextNode(record.note));content.appendChild(note);}
      return content;
    }

    function makeActionButton(label,className,handler){const button=el('button','score-action-btn '+(className||''),label);button.type='button';button.addEventListener('click',handler);return button;}

    function renderTable(records){
      elements.tableBody.replaceChildren();
      records.forEach(record=>{
        const row=el('tr');appendTextCell(row,record.date);appendTextCell(row,formatDuration(record.durationSeconds));appendTextCell(row,formatScore(record.totalScore),'score-total-cell');
        appendTextCell(row,fractionText(record.politics,10));appendTextCell(row,fractionText(record.commonSense,10));appendTextCell(row,fractionText(record.verbal,25));appendTextCell(row,fractionText(record.quantity,20));
        const judgementCell=el('td'),judgementButton=el('button','score-judgement-toggle',judgementText(record));judgementButton.type='button';judgementButton.title='查看判断推理四项明细';judgementButton.addEventListener('click',()=>toggleDetails(record.id));judgementCell.appendChild(judgementButton);row.appendChild(judgementCell);
        appendTextCell(row,fractionText(record.dataAnalysis,15));
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
        title.append(el('div','score-card-score',formatScore(record.totalScore)+' 分'),el('div','score-card-meta',record.date+' · '+formatDuration(record.durationSeconds)));head.appendChild(title);card.appendChild(head);
        const grid=el('div','score-card-grid');
        addCardMetric(grid,'政治',fractionText(record.politics,10));addCardMetric(grid,'常识',fractionText(record.commonSense,10));addCardMetric(grid,'言语',fractionText(record.verbal,25));
        addCardMetric(grid,'数量',fractionText(record.quantity,20));addCardMetric(grid,'判断',judgementText(record));addCardMetric(grid,'资料',fractionText(record.dataAnalysis,15));card.appendChild(grid);
        const details=el('details','score-card-details'),summary=el('summary','', '查看判断推理明细');details.append(summary,makeDetailContent(record));card.appendChild(details);
        if(record.note){const note=el('div','score-card-note','备注：'+record.note);note.title=record.note;card.appendChild(note);}
        const actions=el('div','score-card-actions');actions.append(makeActionButton('编辑','',()=>openEditor(record.id)),makeActionButton('删除','is-danger',()=>deleteRecord(record.id)));card.appendChild(actions);elements.cards.appendChild(card);
      });
    }

    function renderRecords(){
      const records=sortRecordsDescending(state.records),hasRecords=records.length>0;
      elements.recordCount.textContent=records.length+' 条';elements.empty.hidden=hasRecords;
      renderTable(records);renderCards(records);
    }

    function tooltipText(record,metric){
      if(metric.key==='totalScore')return record.date+'\n总成绩：'+formatScore(record.totalScore)+'\n用时：'+formatDuration(record.durationSeconds);
      let correct,total,label;
      if(metric.key==='judgement'){correct=judgementCorrect(record);total=40;label='判断推理';}
      else{const field=FIELD_BY_KEY[metric.key];correct=record[metric.key];total=field.total;label=field.label;}
      return record.date+'\n'+label+'\n'+correct+'/'+total+'\n正确率：'+formatPercent(percent(correct,total));
    }

    function chartEmpty(title,subtitle){const empty=el('div','score-chart-empty');empty.append(el('strong','',title),el('span','',subtitle));elements.chart.appendChild(empty);}

    function renderChart(){
      elements.chart.replaceChildren();
      const records=recentRecords(state.records,10),metrics=METRICS.filter(metric=>state.activeMetrics.has(metric.key));
      elements.chartCount.textContent=records.length?records.length+' 次':'';
      if(!records.length){chartEmpty('暂无成绩记录','完成一次成绩估算并保存后，即可查看成绩趋势。');return;}
      if(!metrics.length){chartEmpty('请选择下方指标查看趋势。','可同时开启多条折线进行比较。');return;}
      const rect=elements.chart.getBoundingClientRect(),width=Math.max(320,Math.round(rect.width||900)),height=Math.max(230,Math.round(rect.height||320));
      const margin={left:42,right:18,top:20,bottom:42},plotWidth=width-margin.left-margin.right,plotHeight=height-margin.top-margin.bottom;
      const values=[];records.forEach(record=>metrics.forEach(metric=>values.push(metricValue(record,metric.key))));
      let min=Math.min(...values),max=Math.max(...values);
      if(max-min<8){const center=(max+min)/2;min=center-5;max=center+5;}else{const padding=(max-min)*.14;min-=padding;max+=padding;}
      min=Math.max(0,Math.floor(min));max=Math.min(100,Math.ceil(max));if(max-min<10){min=Math.max(0,max-10);max=Math.min(100,min+10);}
      const xAt=index=>records.length===1?margin.left+plotWidth/2:margin.left+plotWidth*index/(records.length-1);
      const yAt=value=>margin.top+(max-value)/(max-min)*plotHeight;
      const svg=svgEl('svg',{viewBox:'0 0 '+width+' '+height,role:'img','aria-label':'成绩趋势折线图'});
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
        const points=records.map((record,index)=>({record,x:xAt(index),y:yAt(metricValue(record,metric.key))}));
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

    function buildEditFields(){
      elements.editGrid.replaceChildren();
      SCORE_FIELDS.forEach(field=>{
        const label=el('label','score-form-field score-edit-field'),caption=el('span','',field.label),input=el('input');input.type='number';input.min='0';input.max=String(field.total);input.step='1';input.inputMode='numeric';input.dataset.editField=field.key;
        label.append(caption,input,el('span','score-edit-max','/ '+field.total));elements.editGrid.appendChild(label);
      });
    }

    function openEditor(id){
      const record=state.records.find(item=>item.id===id);if(!record)return;
      state.editingId=id;elements.editDate.value=record.date;elements.editDuration.value=formatDuration(record.durationSeconds);elements.editNote.value=record.note;elements.editError.textContent='';
      elements.editGrid.querySelectorAll('[data-edit-field]').forEach(input=>{input.value=String(record[input.dataset.editField]);input.classList.remove('is-invalid');});
      elements.editOverlay.classList.add('show');
    }
    function closeEditor(){elements.editOverlay.classList.remove('show');state.editingId=null;elements.editError.textContent='';}
    function saveEditedRecord(){
      const record=state.records.find(item=>item.id===state.editingId);if(!record)return;
      if(!isValidDate(elements.editDate.value)){elements.editError.textContent='请选择有效的考试日期。';return;}
      const durationSeconds=parseDuration(elements.editDuration.value);if(durationSeconds===null){elements.editError.textContent='请输入合法用时，例如 1h45m43s、45m 或 2h。';return;}
      const values={};elements.editGrid.querySelectorAll('[data-edit-field]').forEach(input=>{const raw=input.value.trim();values[input.dataset.editField]=raw===''?Number.NaN:Number(raw);});
      const validation=validateScoreValues(values);if(!validation.valid){elements.editError.textContent=validation.field.label+'正确题数须为 0 到 '+validation.field.total+' 的整数。';return;}
      if(elements.editNote.value.length>200){elements.editError.textContent='备注不能超过 200 个字符。';return;}
      const totalScore=estimator.calculateScore(values),updated=Object.assign({},record,values,{date:elements.editDate.value,durationSeconds,totalScore,note:elements.editNote.value.trim(),updatedAt:new Date().toISOString()});
      const index=state.records.findIndex(item=>item.id===record.id);state.records[index]=updated;
      if(!persist()){state.records[index]=record;return;}
      closeEditor();renderAll();if(typeof window.showToast==='function')window.showToast('成绩记录已更新');
    }

    function deleteRecord(id){
      const record=state.records.find(item=>item.id===id);if(!record)return;
      if(!window.confirm('确定删除 '+record.date+'，'+formatScore(record.totalScore)+' 分的成绩记录吗？'))return;
      const previousRecords=state.records;state.records=removeRecordById(state.records,id);
      if(!persist()){state.records=previousRecords;return;}
      if(state.expandedId===id)state.expandedId=null;renderAll();if(typeof window.showToast==='function')window.showToast('成绩记录已删除');
    }

    function renderAll(){renderStats();renderRecords();renderChart();}
    window.scoreHistoryRefresh=renderAll;
    window.scoreHistoryApp={getRecords:()=>state.records.map(record=>Object.assign({},record)),render:renderAll};

    buildToggles();buildEditFields();renderAll();
    saveButton.addEventListener('click',saveCurrentScore);elements.clear.addEventListener('click',clearEstimator);
    [elements.date,elements.duration,elements.note].forEach(input=>input.addEventListener('input',markDirty));
    doc.addEventListener('score-estimator-change',markDirty);
    elements.editCancel.addEventListener('click',closeEditor);elements.editSave.addEventListener('click',saveEditedRecord);
    elements.editOverlay.addEventListener('click',event=>{if(event.target===elements.editOverlay)closeEditor();});
    doc.addEventListener('keydown',event=>{if(event.key==='Escape'&&elements.editOverlay.classList.contains('show'))closeEditor();});
    window.addEventListener('storage',event=>{if(event.key===STORAGE_KEY){state.records=loadRecords(localStorage);renderAll();}});
    let resizeTimer=null;window.addEventListener('resize',()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(renderChart,120);});
  }

  return {STORAGE_KEY,SCORE_FIELDS,METRICS,parseDuration,formatDuration,isValidDate,formatScore,formatPercent,percent,judgementCorrect,validateScoreValues,sortRecordsAscending,sortRecordsDescending,recentRecords,removeRecordById,getStats,fingerprint,metricValue,normalizeRecord,init};
});
