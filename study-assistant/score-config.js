/* =========================================
   行测配置：每题分值、默认题量都只在这里改。
   成绩估算和成绩记录都读这一份；改了每题分值，历史成绩会按新分值重算。
   ========================================= */
(function(root){
  'use strict';

  const XINGCE_CONFIG={
    /* 「对几题」留空 = 这块没做，按这个正确率估（页面上可临时改） */
    estimateRate:0.65,

    /* 固定 9 行，顺序即页面显示顺序。key 不要改（成绩记录按 key 存） */
    rows:[
      {key:'politics',label:'政治理论',shortLabel:'政治'},
      {key:'commonSense',label:'常识判断',shortLabel:'常识'},
      {key:'verbal',label:'言语',shortLabel:'言语'},
      {key:'quantity',label:'数量',shortLabel:'数量'},
      {key:'graphic',label:'图推',shortLabel:'图推'},
      {key:'definition',label:'定义',shortLabel:'定义'},
      {key:'analogy',label:'类比',shortLabel:'类比'},
      {key:'logic',label:'逻辑',shortLabel:'逻辑'},
      {key:'dataAnalysis',label:'资料',shortLabel:'资料'}
    ],

    exams:{
      guokao:{
        label:'国考',
        paper:'2026 执法卷',
        /* 每题分值 */
        weights:{politics:0.8,commonSense:0.6,verbal:0.8,quantity:0.7,graphic:0.8,definition:0.8,analogy:0.8,logic:0.8,dataAnalysis:0.8},
        /* 默认题量 */
        totals:{politics:20,commonSense:15,verbal:30,quantity:10,graphic:10,definition:10,analogy:5,logic:10,dataAnalysis:20}
      },
      shengkao:{
        label:'省考',
        paper:'2026 C卷',
        weights:{politics:0.65,commonSense:0.65,verbal:0.8,quantity:1.0,graphic:0.75,definition:0.8,analogy:0.75,logic:0.9,dataAnalysis:1.0},
        totals:{politics:10,commonSense:10,verbal:25,quantity:15,graphic:8,definition:7,analogy:10,logic:10,dataAnalysis:15}
      }
    },

    /* 改版前保存的旧记录只存了「对几题」，当时题量是写死的这一组；旧记录一律算省考 */
    legacyExam:'shengkao',
    legacyTotals:{politics:10,commonSense:10,verbal:25,quantity:20,graphic:10,definition:10,analogy:10,logic:10,dataAnalysis:15}
  };

  if(typeof module==='object'&&module.exports)module.exports=XINGCE_CONFIG;
  root.XINGCE_CONFIG=XINGCE_CONFIG;
})(typeof globalThis!=='undefined'?globalThis:this);
