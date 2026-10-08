/* =========================================================
   申论答题卡排版引擎（纯函数，不碰 DOM）
   单独成文件是为了能脱离页面直接跑单元测试： node sheet-layout.test.js

   输入一段文字，输出一格一格的排版结果：
     out[i]   = {pad:1}                空格子（换段补齐、前括号推行）
              | {s, sq?, half?, wide?} 有内容的格子；s 是第一个字，sq 是挤进同一格的其余字
     posOf[k] = 源文字第 k 个字符落在第几格（光标定位、点格子回填都靠它）
     uc       = 字数（占格字位数，挤压的标点照算一位）

   规则（GB/T 15834-2011 第 5.1 节 + 方格纸通行写法）：
   · 汉字、全角标点各占一格；半角字符两个占一格，空格一个占一格。段首缩进由答题人自己空格。
   · 点号、后半标点不落行首：挤进上一行最后一格，连着两个也一起挤。
   · 前半标点不落行末：要落在最后一格时，和后面一个字合占这一格。
   · 省略号、破折号占两格且不拆行：只剩一格时整个挤进这一格。
   · 一个点号和一个引号挨着，不论谁在前，合占一格；三个连着时前两个合、第三个单独；
     两个标号挨着（”“、》，、）。、……” 等）不合并。
   · 合并格落在行首：以点号/后半标点开头的整格挤进上一行末格；「点号＋前引号」只挤点号，
     前引号作下一行第一格。「点号＋前引号」要落在行末：不合并，点号留在末格，前引号换行。
   · 半角 , : ; ? ! ( ) 和直引号 " 先按全角排（只影响排版，不改原文）。
   ========================================================= */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports) module.exports=api;
  root.SheetLayout=api;
})(typeof self!=='undefined'?self:this,function(){

  const COLS=25;
  const HALF=c=>c>' '&&c<='~';   /* 空格不配对，独占一格 */

  /* 点号 */
  const DOT=new Set(['，','。','、','：','；','？','！']);
  /* 引号 */
  const QUOTE=new Set(['“','”','‘','’']);
  const OPEN_QUOTE=new Set(['“','‘']);

  /* 不能出现在行首（句末点号、后括号、后引号等） */
  const NO_HEAD=new Set([
    '。','，','、','；','：','？','！','·','…','—','～',
    '）','〕','〉','》','」','』','】','〗','］','｝',
    '”','’','〞','%','‰','℃'
  ]);
  /* 不能出现在行末（前括号、前引号） */
  const NO_TAIL=new Set([
    '（','〔','〈','《','「','『','【','〖','［','｛',
    '“','‘','〝','￥','＄','＃'
  ]);
  /* 省略号、破折号：成对出现时作一个两格宽的整体 */
  const WIDE=new Set(['…','—']);

  /* 一格最多容纳几个字位。原规则是一个字 + 挤进来的两个标点（3 个）；
     前半标点和字合格（“周）后还可能再挤进两个后半标点（“周”，），所以放到 4，
     保证点号无论如何不落行首。 */
  const CELL_CAP=4;

  /* 半角标点按全角排。逐字替换，长度不变，posOf 下标仍与原文一一对应。
     数字中间的 , : 不转（1,000、10:30）。 */
  const HALF_PUNCT={',':'，',':':'：',';':'；','?':'？','!':'！','(':'（',')':'）'};
  const DIGIT=c=>c>='0'&&c<='9';
  function normalize(text){
    const a=text.split(''); let openQ=true;
    for(let i=0;i<a.length;i++){
      const c=a[i];
      if(c==='"'){ a[i]=openQ?'“':'”'; openQ=!openQ; continue; }
      if(c==='\n'){ openQ=true; continue; }   /* 换段后重新配对，前一段漏了后引号不会把整篇带歪 */
      const f=HALF_PUNCT[c]; if(!f) continue;
      if((c===','||c===':') && DIGIT(a[i-1]||'') && DIGIT(a[i+1]||'')) continue;
      a[i]=f;
    }
    return a.join('');
  }

  /* 第一步：切成字位单元 */
  function units(text){
    const u=[]; let i=0;
    while(i<text.length){
      const ch=text[i];
      if(ch==='\n'){ u.push({br:1, idxs:[i]}); i++; }
      else if(HALF(ch)){
        const idxs=[i]; let s=ch;
        if(i+1<text.length&&HALF(text[i+1])){ s+=text[i+1]; idxs.push(i+1); i+=2; } else i++;
        u.push({s, half:1, idxs});
      }
      else if(WIDE.has(ch) && text[i+1]===ch){ u.push({s:ch+ch, wide:1, idxs:[i,i+1]}); i+=2; }
      else{ u.push({s:ch, idxs:[i]}); i++; }
    }
    return u;
  }

  const plain=u=>u && !u.br && !u.half && !u.wide;
  /* 一个点号 + 一个引号，谁在前都行 */
  const pairable=(a,b)=>plain(a)&&plain(b)&&
    ((DOT.has(a.s)&&QUOTE.has(b.s))||(QUOTE.has(a.s)&&DOT.has(b.s)));

  /* 第二步：点号和引号挨着的合成一组（一个组 = 不考虑行首行末时的一格），左起贪心两两合 */
  function groups(us){
    const g=[];
    for(let i=0;i<us.length;i++){
      if(pairable(us[i],us[i+1])){ g.push([us[i],us[i+1]]); i++; }
      else g.push([us[i]]);
    }
    return g;
  }

  /* 能和前半标点合占行末一格的“字”：普通全角字符，不是任何标点 */
  const isWord=u=>plain(u) && !NO_HEAD.has(u.s) && !NO_TAIL.has(u.s) && !DOT.has(u.s) && !QUOTE.has(u.s) && u.s!==' ' && u.s!=='　';

  function size(cell){ return cell.wide ? 2 : 1+(cell.sq?cell.sq.length:0); }

  function build(rawText){
    const text=normalize(rawText);
    const us=units(text), gs=groups(us);
    const out=[]; const posOf=new Array(text.length+1);
    const col=()=>out.length%COLS;
    let lastContent=false, justBroke=false;

    const put=(list)=>{          /* 一组字位放进一个新格子 */
      const at=out.length;
      list.forEach(u=>u.idxs.forEach(x=>posOf[x]=at));
      const cell={s:list[0].s};
      if(list[0].half) cell.half=1;
      if(list[0].wide) cell.wide=1;
      if(list.length>1) cell.sq=list.slice(1).map(u=>u.s);
      out.push(cell);
      lastContent=true; justBroke=false;
    };
    /* 挤进上一格；放不下返回 false */
    const squeeze=(list)=>{
      const prev=out[out.length-1];
      if(!prev || prev.pad) return false;
      if(size(prev)+list.length>CELL_CAP) return false;
      prev.sq=(prev.sq||[]).concat(list.map(u=>u.s));
      list.forEach(u=>u.idxs.forEach(x=>posOf[x]=out.length-1));
      return true;
    };

    for(let k=0;k<gs.length;k++){
      const grp=gs[k], first=grp[0];

      if(first.br){
        posOf[first.idxs[0]]=out.length;
        if(out.length%COLS!==0){ while(out.length%COLS!==0) out.push({pad:1}); }
        else if(!lastContent){ for(let n=0;n<COLS;n++) out.push({pad:1}); }
        lastContent=false; justBroke=true;
        continue;
      }

      /* 半角：照旧，不参与避头尾 */
      if(first.half){ put(grp); continue; }

      /* 省略号、破折号：两格，只剩一格时整个挤进去；可以出现在行首 */
      if(first.wide){
        if(col()===COLS-1){ put(grp); }
        else{
          const [a,b]=first.idxs, c1=first.s[0];
          posOf[a]=out.length; out.push({s:c1});
          posOf[b]=out.length; out.push({s:c1});
          lastContent=true; justBroke=false;
        }
        continue;
      }

      const atHead = col()===0 && out.length>0 && !justBroke;

      /* 行首：点号、后半标点开头的格子挤进上一行末格 */
      if(atHead && NO_HEAD.has(first.s)){
        if(grp.length===2 && DOT.has(first.s) && OPEN_QUOTE.has(grp[1].s)){
          /* 点号＋前引号：点号挤上去，前引号作本行第一格 */
          if(squeeze([first])){ put([grp[1]]); continue; }
        }else if(squeeze(grp)) continue;
      }

      /* 行末 */
      if(col()===COLS-1){
        if(grp.length===2 && DOT.has(first.s) && OPEN_QUOTE.has(grp[1].s)){
          /* 点号＋前引号：拆开，点号留末格，前引号换行 */
          put([first]); put([grp[1]]); continue;
        }
        if(grp.length===1 && NO_TAIL.has(first.s)){
          const next=gs[k+1];
          if(next && next.length===1 && isWord(next[0])){ put([first,next[0]]); k++; continue; }
          out.push({pad:1});       /* 后面不是一个字（标点、半角、段尾等）：照旧推到下一行 */
        }
      }

      put(grp);
    }
    posOf[text.length]=out.length;
    let uc=0; for(const u of us) if(!u.br) uc+=u.wide?2:1;
    return {out,posOf,uc};
  }

  /* 把排版结果转成按行的文字，测试和比对用：格子用 | 分隔，空格子记作 □ */
  function toLines(out){
    const lines=[];
    for(let i=0;i<out.length;i+=COLS){
      const row=out.slice(i,i+COLS);
      let end=row.length; while(end>0&&row[end-1].pad) end--;
      lines.push(row.slice(0,end).map(c=>c.pad?'□':(c.s===' '||c.s==='　')?'□':c.s+(c.sq?c.sq.join(''):'')).join('|'));
    }
    while(lines.length&&lines[lines.length-1]==='') lines.pop();
    return lines;
  }

  return {build,normalize,toLines,COLS,DOT,QUOTE,NO_HEAD,NO_TAIL};
});
