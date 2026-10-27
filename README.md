# @magpie-community/opencode-loomy-auth

[OpenCode](https://opencode.ai) / [magpie](https://usemagpie.ai) provider 插件：**讯飞 Loomy**。用 Loomy 的手机验证码登录，对话经 Loomy 的 OpenAI 兼容模型网关转发；积分（永久余额 + 每日赠送，双钱包）与刷新每日赠送的 first-login 签到落在 Usage 卡片上。

| 供应商 id | 登录方式 | 上游 host |
|---|---|---|
| `loomy` | 手机验证码（+86） | `loomyad.xunfei.cn`（账号面 `account.xfinfr.com`） |

本包导出 `LoomyAuthPlugin`（`loomy`）。

## 安装

```sh
magpie plugin add github:road-kid/opencode-loomy-auth    # 本仓库
magpie plugin add @magpie-community/opencode-loomy-auth  # npm 包名：社区 PR 合入后可用
magpie plugin add .                                      # 本地副本：无需 npm 与 GitHub
magpie plugin login loomy      # 手机验证码登录
magpie provider test loomy     # 每种 API 发一条小请求验证链路
magpie quota                   # 积分卡片
```

OpenCode 同样可加载（`opencode.json` 的 `"plugin"` 数组，之后 `opencode auth login`）。登录信息保存在 magpie 的 `plugin-auth.json`（600 权限）/ OpenCode 的 `auth.json`。

## 登录

Loomy 的手机验证码流程，两步：

- magpie 先收手机号（中国大陆 11 位；开头的 `+86` 或 `86`、空格与连字符会先清洗再校验）；
- 插件发出短信验证码（5 分钟有效），magpie 弹出六位验证码输入框，填入后插件用验证码换会话。

会话 14 天，Loomy 不提供 refresh。过期时（HTTP 401/403，或业务码 `020002`/`100002`），插件把登录标记为失效，magpie 引导重新短信登录——没有任何可续期的东西。账号标识是打码手机号（`138****8000`）；Loomy 的 userid 随凭据一并保存。

## 请求转发

对话走 OpenAI Chat 形态（`@ai-sdk/openai-compatible`），发往 `https://loomyad.xunfei.cn/api/v1/chat/completions`，请求体原样透传。会话 token 同时放在网关读取的两个头里——`token:` 与 `Authorization: Bearer`（官方客户端的双头写法）。

文案说积分/额度不足的拒绝（402/403/429 中言明者）会被改写成 429 `rate_limit_error`，让 magpie 的 routing group 切换到下一个账号；其余 401/403 一律按登录失效处理。

## 模型

登录后，模型清单实时读取 `GET /api/v1/models`：capabilities 落成工具 / 推理 / 图片能力位，上下文与输出上限透传，每个模型都挂 low/medium/high 三档 reasoning-effort variants。网关把积分倍率印在展示名尾部（`DeepSeek V4 Flash 0731 (x3.0)`）；插件把它拆出，不进名称。

实时清单是唯一权威。下表是内置兜底——首次安装到实时清单应答前的引导——只在未登录、拉空或拉取失败时顶上，实时清单一应答即被覆盖。

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

## 积分与每日签到

Usage 卡展示 Loomy 的两个钱包：

- 余额行：永久 + 每日赠送，合计；
- 「每日赠送」窗口：已消耗比例的百分比，旁注 `剩余 X / 限额 Y`；
- 「永久积分」侧栏行：永久余额，没有窗口可耗。

Loomy 没有独立的余额或签到接口：摘要挂在积分流水查询上，「签到」就是 Loomy 客户端每次登录都会调用的 first-login。服务端每天刷回一次每日赠送，重复调用同样应答，因此每次成功都报 *claimed*；应答里没有「本次获得量」字段，所以不承诺任何 credit 数字——应答带每日余额时，余额写进文案。

每日自动执行是 magpie 的能力，不是插件的：**Daily check-in** 开关在 Settings → Usage → Plugins，随 **magpie ≥ v0.1.1083** 提供，**默认关闭**——打开后 magpie 每天每账号自动刷一次（当天只有失败才会重试）。**Check in now** 按钮随时手动执行。OpenCode 不调用此钩子。

## 环境变量覆盖

以下变量都在调用时读取，不在插件加载时快照，测试可以借此把上游指向自己的假实现。

| 变量 | 默认值 | 替换对象 |
|---|---|---|
| `LOOMY_XFYUN_BASE_URL` | `https://account.xfinfr.com` | 账号主机（发码 / 验码） |
| `LOOMY_POINTS_BASE_URL` | `https://loomyad.xunfei.cn` | 集成网关主机——积分、first-login，以及 `/api/v1`（模型与对话） |
| `LOOMY_XFYUN_ACCESS_KEY_ID` | `2thryby66wxi53sk` | 签名密钥对的 id |
| `LOOMY_XFYUN_ACCESS_KEY_SECRET` | `zsak6eadrbawz683wf5r3m2snrwj868r` | 签名密钥对的 secret |
| `LOOMY_XFYUN_APP_ID` | `GM3LOOMY` | 请求信封的 appid |

## 已知限制

- 会话 14 天、无 refresh，过期后只能重新短信登录。
- 积分倍率只存在于展示名后缀，上游没有结构化字段；插件能拆出后缀，但无从与目录核对数额。
- 图片输入按模型家族而不同：deepseek 系只认网关私有的 `<image_base64>…</image_base64>` 标记（标准 `image_url` 会被当文本截断）；GLM 系相反，只认 `image_url`，喂标记反而无法看图。改写列为二期增强，落地前图片输入只在 GLM 系可靠。
- `reasoning_effort` 对非思考模型被上游忽略。每个模型都按客户端口径挂 low/medium/high 三档；非思考模型上该字段被丢弃——已知行为。客户端目录标记的思考模型是 `spark-x`。
- tool_calls 流式回包尚无真机验证，请用你的 agent 工具循环首先验证；若失败，后续版本会把 toolcall 能力位降下。
- onboarding 新手任务（8 个、合计 10000 积分的一次性奖励）不在本插件内，留给 Loomy 客户端完成；这里只做每日 first-login。补领列为可能的二期。

## 免责声明

本包为**非官方**社区插件，与科大讯飞 / Loomy 无任何关联。实现基于对官方客户端行为的逆向分析与实测，仅供个人学习研究。内置签名密钥对是客户端指纹，不是用户凭证：发往 Loomy 账号面的每个请求都用 Loomy 安装包自带、对所有客户端公开的密钥对做 HMAC-SHA1 签名，本包为兼容复刻它，如同复刻请求信封一样；你的手机号、验证码与会话只发往 Loomy 自家主机。积分为 Loomy 自家服务发放，能否在别处使用由讯飞条款决定，讯飞并未认可；使用产生的账号风险由使用者自行承担。上游协议变更可能导致插件随时失效。

## 开发

```sh
node --test .                    # 单元测试（node:test + 本地假上游，断网）
node scripts/check.node.mjs      # 形状校验，与社区 CI 同源逻辑
```

插件本体是单文件 `index.mjs`，零运行时依赖——只用 `node:crypto` 与标准 `fetch`——Bun 与 Node ≥ 20.11 双兼容。
