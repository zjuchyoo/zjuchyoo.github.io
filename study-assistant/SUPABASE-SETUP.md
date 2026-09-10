# 云同步配置指南

目标：浏览器自动清理数据时，学习记录不会跟着消失。配好之后，清了数据或换台设备，
用同一个邮箱登录就能把记录整份拉回来。

配置前同步是关闭的，网站其余部分照常工作 —— 不填也不会报错。

---

## 一、建 Supabase 项目

1. 打开 <https://supabase.com>，注册后新建一个项目（Free 套餐够用）。
2. 记下项目所在区域，选离你近的（比如 Northeast Asia (Tokyo)）。
3. 项目建好要等 1–2 分钟。

## 二、建表和权限

进入项目左侧的 **SQL Editor**，新建一个 query，把下面整段贴进去执行：

```sql
-- 一张表就够：每个用户的每个存储键存一行
create table if not exists public.study_state (
  user_id    uuid        not null references auth.users(id) on delete cascade,
  key        text        not null,
  value      jsonb       not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, key)
);

-- 行级安全：这是真正的访问控制，anon key 公开也没关系
alter table public.study_state enable row level security;

-- 每个人只能读写自己那些行
drop policy if exists "study_state_own_rows" on public.study_state;
create policy "study_state_own_rows"
  on public.study_state
  for all
  to authenticated
  using      (auth.uid() = user_id)
  with check (auth.uid() = user_id);
```

执行完在 **Table Editor** 里应该能看到 `study_state` 表。

> **为什么 anon key 可以公开？**
> 它只是标识"这是哪个项目"，本身不携带任何权限。上面的 RLS 策略要求
> `auth.uid() = user_id` —— 没登录的请求 `auth.uid()` 是 null，一行都读不到；
> 登录了也只能碰自己的行。这就是 Supabase 设计上让 anon key 直接写进前端的原因。

## 三、允许登录后跳回你的站点

**Authentication → URL Configuration**：

- **Site URL** 填
  ```
  https://zjuchyoo.github.io/study-assistant/
  ```
- **Redirect URLs** 点 `Add URL`，加这两条（**必须带 `/**` 通配符**）：
  ```
  https://zjuchyoo.github.io/study-assistant/**
  http://127.0.0.1:8899/**
  ```

代码里的回跳地址做了归一化（`cloud-sync.js` 的 `redirectTarget()`）：结尾的
`index.html` 会被抹掉，所以不论你从 `.../study-assistant/` 还是
`.../study-assistant/index.html` 进站，算出来的都是同一个地址，且恒等于上面的
Site URL —— Site URL 本身永远是被允许的回跳目标，所以这一条一定能匹配上。

Redirect URLs 里那两条通配符是冗余保险（本地调试那条有用：加上之后才能在
推送前先在 `127.0.0.1` 上验证一遍）。

漏了 Site URL 这一步，邮件里的登录链接点开会跳到错误页。

## 四、填配置

**Project Settings → API** 里抄两个值，填进 `cloud-config.js`：

```js
window.CLOUD_CONFIG={
  url:'https://你的项目ref.supabase.co',
  anonKey:'eyJhbGci....'          // 标着 anon / public 的那个
};
```

⚠️ 别填 `service_role` 那个 —— 它有绕过 RLS 的权限，绝不能出现在前端。

**配置必须写进这个文件并提交到仓库**，不能只存在浏览器里：浏览器清数据时会把
localStorage 一起清掉，配置要是也存在那儿，清完就登不上去、也就找不回数据了 ——
那正好是这套同步要解决的问题。

## 五、用起来

打开网站，右上角云朵图标 → 填邮箱 → 「发送登录链接」→ 去邮箱点开链接。
登录后会立刻做一次同步，之后：

- 任何改动攒 3 秒自动上传
- 切后台 / 关标签页前会赶紧推一次
- 每次打开页面先拉一次

Supabase 免费额度每小时发信有限（默认 4 封/小时）。自用完全够，
真嫌少可以在 **Authentication → Emails** 接自己的 SMTP。

---

## 同步了什么

| 存储键 | 内容 | 合并方式 |
|---|---|---|
| `study-score-history.v1` | 成绩历史 | 按 `id` 并集合并，同条冲突取 `updatedAt` 新的 |
| `study_records_*` | 专注计时记录（每天一个键） | 按 `起止时间+时长` 指纹去重 |
| `idiomMemoryMarks.ipad.v1` | 成语颜色标记 | 整体覆盖，取较新 |
| `idiomCustomMeanings.ipad.v1` | 自定义释义 | 整体覆盖，取较新 |
| `study-compose-sheet.v1` | 申论答卷正文 | 整体覆盖，取较新 |
| `study-compose-size.v1` / `study-theme` | 界面偏好 | 整体覆盖，取较新 |

**不同步**：答题卡载入的本地字体文件（存在 IndexedDB，动辄几 MB，走同步不划算）。
换设备后重新载入一次即可。

## 数据安全上的几个要点

- **空数据永远不会覆盖非空数据。** 浏览器清空 localStorage 后本地是空的，
  这时同步只会往下拉，绝不会把空推上去把云端抹掉。这条有专门的测试。
- **删除靠墓碑传播，不靠"谁没有就删谁"。** 三方合并会区分"这条被删了"和
  "这台设备还没同步到这条"，所以新设备首次登录不会误删云端记录。墓碑留 90 天。
- **退出登录不删本地数据。**

## 出问题时对照这里

| 现象 | 原因 / 处理 |
|---|---|
| 点开邮件链接跳到 `requested path is invalid` | 第三步的 Redirect URLs 没加，或没带 `/**` 通配符 |
| 面板一直显示「未配置云同步」 | `cloud-config.js` 里 url 或 anonKey 是空的；改完记得刷新页面 |
| 「Supabase 加载失败（离线？）」 | CDN 没连上。查网络；离线状态下同步关闭，网站其余部分照常用 |
| 同步失败提示 `relation "study_state" does not exist` | 第二步的建表 SQL 没跑成功，回 SQL Editor 重跑一遍 |
| 同步失败提示 `new row violates row-level security` | RLS 策略没建上。把第二步 SQL 里 `create policy` 那段单独再跑一次 |
| 同步失败提示 `JWT expired` / 401 | 会话过期了，面板里退出登录再重新登一次 |
| 收不到登录邮件 | 先看垃圾箱。Supabase 免费额度默认 4 封/小时，超了要等 |
| 登录后记录没回来 | 确认登录用的是**同一个邮箱** —— 数据是按账号隔离的 |

面板上的报错文案会直接显示 Supabase 返回的原文，看不懂就整句发我。

## 跑测试

```bash
node sync-merge.test.js
```

合并逻辑的单元测试（29 项），纯函数、不联网。

链路测试打开 `sync-e2e.test.html`（用假客户端，也不联网，20 项），覆盖
首次上传、清空找回、删除传播、去重、并发合并等。

> 这两个测试文件会跟着发布到 GitHub Pages 上（虽然没人会去访问）。
> 介意的话可以移到仓库外，或在发布流程里排除掉。
