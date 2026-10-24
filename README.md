# @magpie-community/opencode-loomy-auth

An [OpenCode](https://opencode.ai) / [magpie](https://usemagpie.ai) provider
plugin for a Loomy (iFlytek) account. You sign in with Loomy's phone-code
sign-in, your chats go through Loomy's OpenAI-compatible model gateway, and
your points — the permanent balance and the daily grant, two wallets — and the
daily first-login refresh that renews the grant land on the Usage card. One
provider, `loomy`.

讯飞 Loomy 的 [OpenCode](https://opencode.ai) / [magpie](https://usemagpie.ai)
provider 插件。用 Loomy 的手机验证码登录，对话经 Loomy 的 OpenAI
兼容模型网关转发，积分（永久余额 + 每日赠送，双钱包）与刷新每日赠送的
first-login 签到落在 Usage 卡片上。只有一个供应商：`loomy`。

## Risk / 风险与声明

Read this before you use the package:

- **This is a community package.** It has nothing to do with iFlytek.
- **The points are for Loomy's own services.** Loomy's terms decide where else
  they may be used; this package uses them from other agents, and iFlytek
  hasn't approved that. The risk to the account is yours.
- **The signing pair is a client fingerprint, not a credential.** Every
  request to Loomy's account host is HMAC-SHA1 signed with a key pair that
  ships inside Loomy's own installer to every client — public by design. This
  package replicates it for compatibility, the way it replicates the request
  envelope. Your phone number, your code and your session go only to Loomy's
  own hosts.

使用前请先读：

- **本包是社区包**，与讯飞没有任何关联。
- **积分是为 Loomy 自家服务发放的**。能否在别处使用由讯飞条款决定；本包把它
  们用于其他 agent，讯飞并未认可。账号风险由使用者自行承担。
- **内置签名密钥对是客户端指纹，不是用户凭证。** 发往 Loomy 账号面的每个
  请求都用 Loomy 安装包自带、对所有客户端公开的密钥对做 HMAC-SHA1 签名；
  本包为兼容复刻它，如同复刻请求信封一样。你的手机号、验证码与会话只发往
  Loomy 自家主机。

## Install / 安装

```sh
magpie plugin add github:road-kid/opencode-loomy-auth  # this repository
magpie plugin add @magpie-community/opencode-loomy-auth # the npm name, once the community PR is in
magpie plugin add .                                     # a local copy of this repository — no npm, no GitHub
```

Then:

```sh
magpie plugin login loomy      # the phone-code sign-in
magpie provider test loomy     # one small request per API, to check the wiring
magpie quota                   # the points card
```

The same package loads in OpenCode (the `"plugin"` array in `opencode.json`,
then `opencode auth login`). magpie keeps the sign-in in `plugin-auth.json`
(mode 600); OpenCode keeps it in `auth.json`.

```sh
magpie plugin add github:road-kid/opencode-loomy-auth  # 本仓库
magpie plugin add @magpie-community/opencode-loomy-auth # npm 包名：社区 PR 合入后可用
magpie plugin add .                                     # 本仓库的本地副本：不需要 npm，也不需要 GitHub
```

随后：

```sh
magpie plugin login loomy      # 手机验证码登录
magpie provider test loomy     # 每种 API 发一条小请求，验证链路
magpie quota                   # 积分卡片
```

同一个包在 OpenCode 也能加载（`opencode.json` 的 `"plugin"` 数组，之后
`opencode auth login`）。magpie 把登录态存进 `plugin-auth.json`（600 权限），
OpenCode 存进 `auth.json`。

## Signing in / 登录

The sign-in is Loomy's phone-code one, in two steps:

- magpie asks for the phone number first (mainland China, 11 digits; a leading
  `+86` or `86`, spaces and hyphens are cleaned off before the check);
- the plugin sends the SMS code (it lives five minutes), magpie opens a
  six-digit code box, and the plugin trades the code for the session.

The session lasts fourteen days and Loomy offers no refresh. When it ends
(HTTP 401/403, or the business codes `020002`/`100002`), the plugin marks the
sign-in expired and magpie asks for a new SMS sign-in — there is nothing to
renew. The account's id is the masked phone (`138****8000`); the Loomy userid
is kept with the credential.

登录是 Loomy 的手机验证码流程，两步：

- magpie 先收手机号（中国大陆 11 位；开头的 `+86` 或 `86`、空格与连字符会先
  清洗再校验）；
- 插件发出短信验证码（5 分钟有效），magpie 弹出六位验证码输入框，填入后
  插件用验证码换会话。

会话 14 天，Loomy 不提供 refresh。过期时（HTTP 401/403，或业务码
`020002`/`100002`），插件把登录标记为失效，magpie 引导重新短信登录——没有
任何可续期的东西。账号标识是打码手机号（`138****8000`）；Loomy 的 userid
随凭据一并保存。

## Requests / 请求转发

Chats are OpenAI Chat (`@ai-sdk/openai-compatible`) at
`https://loomyad.xunfei.cn/api/v1/chat/completions`, the request body passed
through untouched. The session token rides in both headers the gateway reads —
`token:` and `Authorization: Bearer`, the client's own dual write. A refusal
whose words say the points or quota ran out (a 402, 403 or 429 that says so)
is rewritten as 429 `rate_limit_error`, so magpie's routing group can move the
conversation to another account; any other 401/403 is the sign-in's end.

对话走 OpenAI Chat 形态（`@ai-sdk/openai-compatible`），发往
`https://loomyad.xunfei.cn/api/v1/chat/completions`，请求体原样透传。会话
token 同时放在网关读取的两个头里——`token:` 与 `Authorization: Bearer`
（官方客户端的双头写法）。文案说积分/额度不足的拒绝（402/403/429 中言明
者）会被改写成 429 `rate_limit_error`，让 magpie 的 routing group 切换到
下一个账号；其余 401/403 一律按登录失效处理。

## Models / 模型

Signed in, the model list is read live from `GET /api/v1/models`: capabilities
become the tool / reasoning / image bits, the context and output limits pass
through, and every model carries the low/medium/high reasoning-effort
variants. The gateway prints each model's point rate as a suffix on its
display name (`DeepSeek V4 Flash 0731 (x3.0)`); the plugin splits that off and
keeps it out of the name.

The live list is the source of truth. The built-in table below — the web
plane's own ten, a guide from the first install until the live list answers —
is only a fallback: without a session, on an empty answer or a failed ask, it
stands in, and the live list overwrites it the moment it answers.

| id | display name | point rate |
|---|---|---|
| `deepseek-v4-flash-0731` | DeepSeek V4 Flash 0731 | x3.0 |
| `GLM-5.3-Flash` | GLM 5.3 Flash | x0.8 |
| `spark-x` | Spark X2.5（thinking） | x0.1 |
| `MiniMax-M3` | — | — |
| `Kimi-k2.6` | — | — |
| `qwen-3.8-max` | — | — |
| `qwen3.8-flash` | — | — |
| `doubao-seed-2.0-mini` | — | — |
| `mimo-v2.5` | — | — |
| `qwen3.5-flash` | — | — |

登录后，模型清单实时读取 `GET /api/v1/models`：capabilities 落成工具 /
推理 / 图片能力位，上下文与输出上限透传，每个模型都挂 low/medium/high
三档 reasoning-effort variants。网关把积分倍率印在展示名尾部
（`DeepSeek V4 Flash 0731 (x3.0)`）；插件把它拆出，不进名称。

实时清单是唯一权威。下表是内置兜底——web 平面的十条，首次安装到实时清单
应答前的引导——只在未登录、拉空或拉取失败时顶上，实时清单一应答即被覆盖。

| id | 展示名 | 积分倍率 |
|---|---|---|
| `deepseek-v4-flash-0731` | DeepSeek V4 Flash 0731 | x3.0 |
| `GLM-5.3-Flash` | GLM 5.3 Flash | x0.8 |
| `spark-x` | Spark X2.5（思考） | x0.1 |
| `MiniMax-M3` | — | — |
| `Kimi-k2.6` | — | — |
| `qwen-3.8-max` | — | — |
| `qwen3.8-flash` | — | — |
| `doubao-seed-2.0-mini` | — | — |
| `mimo-v2.5` | — | — |
| `qwen3.5-flash` | — | — |

## Points and the daily refresh / 积分与每日签到

The Usage card shows the two wallets Loomy keeps:

- the balance line: permanent + daily grant, added together;
- the 每日赠送 window: the grant's consumed share as its percentage, with
  `剩余 X / 限额 Y` beside it;
- the 永久积分 row set aside: the permanent balance, which has no window.

Loomy has no dedicated balance or check-in endpoint: the summary rides on the
points-records call, and the "check-in" is the first-login call the Loomy
client itself makes on every login. The server renews the daily grant once a
day and answers a repeat the same way, so every success reports *claimed*; the
answer carries no "granted this time" figure, so none is promised — the daily
balance, when the answer carries it, goes into the message.

The automatic daily run is magpie's, not the plugin's: the **Daily check-in**
switch lives in Settings → Usage → Plugins, ships with **magpie ≥ v0.1.1083**
and is **off by default** — turn it on and magpie runs the refresh once a day
per account (only a failed outcome retries that day). The **Check in now**
button runs it then and there. OpenCode doesn't call this hook.

Usage 卡展示 Loomy 的两个钱包：

- 余额行：永久 + 每日赠送，合计；
- 「每日赠送」窗口：已消耗比例的百分比，旁注 `剩余 X / 限额 Y`；
- 「永久积分」侧栏行：永久余额，没有窗口可耗。

Loomy 没有独立的余额或签到接口：摘要挂在积分流水查询上，「签到」就是 Loomy
客户端每次登录都会调用的 first-login。服务端每天刷回一次每日赠送，重复调用
同样应答，因此每次成功都报 *claimed*；应答里没有「本次获得量」字段，所以不
承诺任何 credit 数字——应答带每日余额时，余额写进文案。

每日自动执行是 magpie 的能力，不是插件的：**Daily check-in** 开关在
Settings → Usage → Plugins，随 **magpie ≥ v0.1.1083** 提供，**默认关闭**——
打开后 magpie 每天每账号自动刷一次（当天只有失败才会重试）。**Check in
now** 按钮随时手动执行。OpenCode 不调用此钩子。

## Environment overrides / 环境变量覆盖

All of them are read when a call is made, not when the plugin loads, so tests
can point them at a fake of their own.

| Variable | Default | What it replaces |
|---|---|---|
| `LOOMY_XFYUN_BASE_URL` | `https://account.xfinfr.com` | the account host (send / check code) |
| `LOOMY_POINTS_BASE_URL` | `https://loomyad.xunfei.cn` | the integration host — points, first-login, and `/api/v1` (models and chat) |
| `LOOMY_XFYUN_ACCESS_KEY_ID` | `2thryby66wxi53sk` | the signing pair's id |
| `LOOMY_XFYUN_ACCESS_KEY_SECRET` | `zsak6eadrbawz683wf5r3m2snrwj868r` | the signing pair's secret |
| `LOOMY_XFYUN_APP_ID` | `GM3LOOMY` | the request envelope's appid |

以下变量都在调用时读取，不在插件加载时快照，测试可以借此把上游指向自己
的假实现。

| 变量 | 默认值 | 替换对象 |
|---|---|---|
| `LOOMY_XFYUN_BASE_URL` | `https://account.xfinfr.com` | 账号主机（发码 / 验码） |
| `LOOMY_POINTS_BASE_URL` | `https://loomyad.xunfei.cn` | 集成网关主机——积分、first-login，以及 `/api/v1`（模型与对话） |
| `LOOMY_XFYUN_ACCESS_KEY_ID` | `2thryby66wxi53sk` | 签名密钥对的 id |
| `LOOMY_XFYUN_ACCESS_KEY_SECRET` | `zsak6eadrbawz683wf5r3m2snrwj868r` | 签名密钥对的 secret |
| `LOOMY_XFYUN_APP_ID` | `GM3LOOMY` | 请求信封的 appid |

## Known limits / 已知限制

- **The session is fourteen days, with no refresh.** When it ends the only
  way on is a new SMS sign-in.
  会话 14 天、无 refresh，过期后只能重新短信登录。
- **The point rate exists only as the display name's suffix.** Loomy ships no
  structured rate field; the plugin splits the suffix off but cannot verify
  any amount against the catalog.
  积分倍率只存在于展示名后缀，上游没有结构化字段；插件能拆出后缀，但无从
  与目录核对数额。
- **Image input differs per model family.** The deepseek models read only the
  gateway's private `<image_base64>…</image_base64>` marker (a standard
  `image_url` is cut off as text); the GLM models are the opposite — only
  `image_url`, and the marker breaks them. The rewrite is a planned second
  iteration; until it lands, image input is reliable on the GLM family alone.
  图片输入按模型家族而不同：deepseek 系只认网关私有的
  `<image_base64>…</image_base64>` 标记（标准 `image_url` 会被当文本截断）；
  GLM 系相反，只认 `image_url`，喂标记反而无法看图。改写列为二期增强，
  落地前图片输入只在 GLM 系可靠。
- **`reasoning_effort` is ignored on non-thinking models.** Every model
  carries the low/medium/high variants the way the client hangs them; the
  upstream drops the field on the models that don't think — a known behavior.
  The client's own catalog flags `spark-x` as the thinking one.
  `reasoning_effort` 对非思考模型被上游忽略。每个模型都按客户端口径挂
  low/medium/high 三档；非思考模型上该字段被丢弃——已知行为。客户端目录
  标记的思考模型是 `spark-x`。
- **Streaming tool calls are not yet verified on a real account.** The
  desktop gateway's tool_calls streaming has no recorded real-machine run
  behind it (neither here nor in the reverse-engineering project it came
  from); it is the first thing to check with your agent's tool loop. If it
  fails, the toolcall bit gets turned down in a future release.
  tool_calls 流式回包尚无真机验证（本插件与协议逆向来源都没有实测记录），
  请用你的 agent 工具循环首先验证；若失败，后续版本会把 toolcall 能力位
  降下。
- **Onboarding newcomer tasks are not claimed.** The eight one-off tasks
  (10000 points in all) on Loomy's onboarding board are left to the Loomy
  client; only the daily first-login is here. Claiming them is a possible
  second iteration.
  onboarding 新手任务（8 个、合计 10000 积分的一次性奖励）不在本插件内，
  留给 Loomy 客户端完成；这里只做每日 first-login。补领列为可能的二期。

## Development / 开发

```sh
node --test .                    # the unit tests (node:test, a local fake upstream, no network)
node scripts/check.node.mjs      # the shape check, the same logic the community CI runs
```

`scripts/check.node.mjs` is this repository's Node copy of the monorepo's
`scripts/check.mjs` (`import.meta.dir` → `import.meta.dirname`; it checks the
package at the repository's root — or every package under `packages/`, when
the copy sits in a monorepo — on Node ≥ 20.11). The plugin itself is one
`index.mjs` with no runtime dependencies — only `node:crypto` and the standard
`fetch` — and loads in Bun and Node ≥ 20.11 alike.

```sh
node --test .                    # 单元测试（node:test + 本地假上游，断网）
node scripts/check.node.mjs      # 形状校验，与社区 CI 同源逻辑
```

`scripts/check.node.mjs` 是本仓库对 monorepo `scripts/check.mjs` 的 Node 副本
（仅 `import.meta.dir` → `import.meta.dirname`；它检查仓库根上的包——放在
monorepo 里时则检查 `packages/` 下每个包——需 Node ≥ 20.11）。插件本体
是单文件 `index.mjs`，零运行时依赖——只用 `node:crypto` 与标准 `fetch`——
Bun 与 Node ≥ 20.11 双兼容。
