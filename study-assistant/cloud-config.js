/* =========================================================
   Supabase 连接配置

   这两个值可以安全地提交到公开仓库：anon key 本来就是设计成公开的，
   真正的访问控制在数据库的行级安全策略（RLS）上 —— 没登录读不到任何数据，
   登录后也只能读写自己那一行。具体建表语句见 SUPABASE-SETUP.md。

   ！！配置必须写在这个文件里，不能只存在浏览器里 ！！
   因为浏览器清数据时会把 localStorage 一起清掉，配置要是也存在那儿，
   清完就登不上去，也就找不回数据了 —— 那正是这套同步要解决的问题。

   没填的话整套同步保持关闭，网站其余部分照常工作。
   ========================================================= */
window.CLOUD_CONFIG={
  url:'https://vrdpdvxyjrtlqrdmiorz.supabase.co',
  /* Publishable key（新版体系，取代旧的 anon key）。
     Project Settings → API Keys → Publishable key。
     绝不要换成下面 Secret keys 里的值 —— 那个能绕过 RLS。 */
  anonKey:'sb_publishable_Q4YeaFuW_6gEFeMCOmY7mg_u56GIbGp'
};
