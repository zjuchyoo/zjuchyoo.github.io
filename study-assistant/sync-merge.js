/* =========================================================
   同步合并逻辑（纯函数，不碰网络也不碰 DOM）
   单独成文件是为了能脱离 Supabase 直接跑单元测试。

   核心是三方合并：base（上次同步成功时的快照）/ local（本地现值）/ remote（云端现值）。
   有 base 才能区分「本地删了一条」和「本地还没同步到这条」——只比 local 和 remote
   是分不出来的，而这正是最容易丢数据的地方。

   云端每个 key 存成一行：{ v: <本地原值>, del: {<id>: <ISO 时间>}, ts: <ISO 最后修改时间> }
   ========================================================= */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports) module.exports=api;
  root.SyncMerge=api;
})(typeof self!=='undefined'?self:this,function(){

  const TOMBSTONE_TTL_DAYS=90;   /* 墓碑留 90 天，够任何一台设备重新上线同步了 */

  /* 判空：主要用来识别「浏览器把 localStorage 清了」——那种情况下 key 整个不存在。
     注意不能把「用户主动清空答卷」误判成空，那时值是 {t:'',l:1200}，是个非空对象。 */
  function isEmpty(v){
    if(v===null||v===undefined) return true;
    if(typeof v==='string') return v.trim()==='';
    if(Array.isArray(v)) return v.length===0;
    if(typeof v==='object') return Object.keys(v).length===0;
    return false;
  }

  function same(a,b){ return JSON.stringify(a===undefined?null:a)===JSON.stringify(b===undefined?null:b); }

  /* key 的合并方式。带 id 的流水账走并集合并，其余整体覆盖。 */
  function specOf(key){
    if(key==='study-score-history.v1'){
      return {kind:'list',
        idOf:r=>String((r&&r.id)||''),
        tsOf:r=>String((r&&(r.updatedAt||r.createdAt))||'')};
    }
    if(/^study_records_/.test(key)){
      /* 计时记录没有 id，用 start|end|duration 当指纹：同一次学习不可能重复 */
      return {kind:'list',
        idOf:r=>r?[r.start,r.end,r.duration].join('|'):'',
        tsOf:()=>''};
    }
    return {kind:'blob'};
  }

  function pruneTombstones(del,nowMs){
    const out={},cut=nowMs-TOMBSTONE_TTL_DAYS*86400000;
    for(const id of Object.keys(del||{})){
      const t=Date.parse(del[id]);
      if(!Number.isFinite(t)||t>=cut) out[id]=del[id];
    }
    return out;
  }

  /* 流水账合并：并集 + 双方墓碑，同 id 冲突时取 updatedAt 新的那条 */
  function mergeList(base,local,remote,spec,nowIso){
    const baseArr=Array.isArray(base)?base:[];
    const localArr=Array.isArray(local)?local:[];
    const remoteArr=(remote&&Array.isArray(remote.v))?remote.v:[];

    const localIds=new Set(localArr.map(spec.idOf));
    const remoteIds=new Set(remoteArr.map(spec.idOf));

    const del=Object.assign({},(remote&&remote.del)||{});
    /* base 里有、本地没了 => 本地删过，立墓碑。只有 base 存在时这个推断才成立：
       base 缺失说明这台设备根本没同步过，"没有"只是没拉下来，不能当成删除。 */
    if(base!==undefined&&base!==null){
      for(const r of baseArr){
        const id=spec.idOf(r);
        if(!localIds.has(id)&&!del[id]) del[id]=nowIso;
      }
    }
    /* 云端墓碑里的条目，如果本地在 base 之后又新增了同 id，视为复活，撤销墓碑 */
    for(const id of Object.keys(del)){
      const inBase=baseArr.some(r=>spec.idOf(r)===id);
      if(localIds.has(id)&&!inBase) delete del[id];
    }

    const byId=new Map();
    for(const r of remoteArr) byId.set(spec.idOf(r),r);
    for(const l of localArr){
      const id=spec.idOf(l);
      if(!byId.has(id)){ byId.set(id,l); continue; }
      const r=byId.get(id);
      byId.set(id, spec.tsOf(l)>=spec.tsOf(r) ? l : r);
    }
    for(const id of Object.keys(del)) byId.delete(id);

    /* 云端有、本地没有、也没有墓碑 —— 这是别的设备新增的，保留（上面已经并进来了） */
    return {value:[...byId.values()], del:pruneTombstones(del,Date.parse(nowIso)||Date.now())};
  }

  /* 整体覆盖合并：只有一方变过就听那一方；都变过按时间戳，但空值永远不许覆盖非空 */
  function mergeBlob(base,local,remote,localTs){
    const rv=remote?remote.v:undefined;
    const rts=(remote&&remote.ts)||'';
    const localChanged=!same(local,base);
    const remoteChanged=!same(rv,base);

    if(!localChanged&&!remoteChanged) return {value:local,del:{}};
    if(!localChanged&&remoteChanged)  return {value:rv,del:{}};
    if(localChanged&&!remoteChanged)  return {value:local,del:{}};

    /* 双方都改过。浏览器清数据后本地是空的，这时绝不能把空推上去覆盖云端。 */
    if(isEmpty(local)&&!isEmpty(rv))  return {value:rv,del:{}};
    if(!isEmpty(local)&&isEmpty(rv))  return {value:local,del:{}};
    return {value:(String(localTs||'')>=rts)?local:rv,del:{}};
  }

  /* 合并单个 key。
     base/local/remote 均为已解析的值；remote 是云端整行 {v,del,ts}（没有则传 null）。
     返回 {value, del, changedLocal, changedRemote} —— 调用方据此决定写本地 / 推云端。 */
  function mergeKey(key,base,local,remote,localTs,nowIso){
    const spec=specOf(key);
    const merged = spec.kind==='list'
      ? mergeList(base,local,remote,spec,nowIso)
      : mergeBlob(base,local,remote,localTs);
    const remoteVal=remote?remote.v:undefined;
    const remoteDel=(remote&&remote.del)||{};
    return {
      value:merged.value,
      del:merged.del,
      changedLocal:!same(merged.value,local),
      changedRemote:!same(merged.value,remoteVal)||!same(merged.del,remoteDel)
    };
  }

  return {isEmpty,specOf,mergeKey,mergeList,mergeBlob,pruneTombstones,TOMBSTONE_TTL_DAYS};
});
