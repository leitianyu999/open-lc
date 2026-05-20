# LC Agent 开放平台技术与风险白皮书

本文面向使用者说明：LC Agent 如何以合规方式使用开放平台能力，账号在本软件中如何被托管与使用，以及我们为降低风险做了哪些技术控制。

这不是一份“教人绕过限制”的说明。它也不是逆向破解、协议绕过、云端代持账号或长期托管承诺的文档。

官方文档入口：

- 开放平台简介：<https://pan.baidu.com/union/doc/nksg0sbfs>
- 接入流程：<https://pan.baidu.com/union/doc/0ksg0sbig>
- 接入 `access_token` FAQ：<https://pan.baidu.com/union/doc/Jl0j9pza3>
- 获取用户信息：<https://pan.baidu.com/union/doc/pksg0s9ns>
- 获取网盘容量信息：<https://pan.baidu.com/union/doc/Cksg0s9ic>
- 获取文件列表：<https://pan.baidu.com/union/doc/nksg0sat9>
- 创建文件 / 文件夹：<https://pan.baidu.com/union/doc/rksg0sa17>
- 管理文件：<https://pan.baidu.com/union/doc/mksg0s9l4>
- 分享文件转存：<https://pan.baidu.com/union/doc/xksmyoqgv>
- 下载：<https://pan.baidu.com/union/doc/pkuo3snyp>

## 1. 合规定位

LC Agent 的工作方式很明确：用户提供合法来源的开放平台凭据，Agent 在本机使用这些凭据，按开放平台能力完成账号校验、目录操作、转存、下载地址生成和临时文件清理。

这里的关键不是“破解”，而是“使用”。

- 使用的是开放平台账号能力
- 执行发生在用户自己的本机
- 凭据不交给 Broker 或中心服务器长期托管
- 账号状态和 token 状态由本机 Agent 维护

相关代码路径：

- 风险同意入口：`agent/web/src/components/RiskConsentDialog.tsx`
- 账号添加页面：`agent/web/src/pages/MyAccountsPage.tsx`
- 本地账号接口：`agent/api/src/http/routes.ts`
- 账号与 token 数据结构：`agent/api/src/db/schema.ts`

## 2. 账号在软件中的使用流程

### 2.1 先确认风险，再允许接入

用户在添加开放平台账号前，必须先完成风险同意。前端会展示风险说明，后端接口也会再次校验，避免未确认风险就接入账号。

这一层的目的，是把“用户明确知道自己在做什么”作为前置条件。

对应实现：

- 风险同意文案和勾选：`agent/web/src/components/RiskConsentDialog.tsx`
- 账号添加前的门禁校验：`agent/api/src/http/routes.ts`

### 2.2 先探测，再接入

添加账号时，Agent 不会只是把字符串写入数据库。它会先做健康探测，确认这组凭据是否真的可以在本机执行开放平台能力。

探测时会做这些事：

1. 读取用户提供的 `refresh_token`
2. 按当前模式换取或校验 `access_token`
3. 检查账号身份、会员状态和空间状态
4. 对新账号，只有健康探测通过才会创建本机账号记录
5. 对已存在账号，允许覆盖更新；如果新凭据探测失败，会把该账号更新为不可用状态并记录失败原因

对应实现：

- 探测逻辑：`agent/api/src/baidu/accountProbe.ts`
- 账号接入与落库：`agent/api/src/baidu/accounts.ts`
- 本地数据库结构：`agent/api/src/db/schema.ts`

### 2.3 运行时先校验，再使用

开放平台账号进入实际解析时，Agent 不是直接信任缓存 token，而是先验证 `access_token` 是否仍可用。

如果 `access_token` 失效，Agent 会尝试用 `refresh_token` 恢复；恢复成功后继续使用，恢复失败则收敛为“需要重新导入”，避免错误凭据反复执行。

对应实现：

- `refresh_token` 续期：`agent/api/src/baidu/openPlatform.ts`
- `access_token` 校验、恢复和重导入：`agent/api/src/baidu/openPlatformToken.ts`

### 2.4 下载地址生成走转存路线

开放平台账号的解析主线是“先转存、再生成下载地址”。

流程是：

1. 先确认 `access_token` 可用
2. 在本机创建受限的临时目录
3. 把目标文件转存到临时目录
4. 基于转存后的路径生成下载地址
5. 任务结束后进入清理流程

对应实现：

- 解析主线：`agent/api/src/baidu/service.ts`
- 临时目录边界检查：`agent/api/src/baidu/service.ts`
- 下载地址生成：`agent/api/src/baidu/service.ts`
- 临时文件清理：`agent/api/src/baidu/service.ts`

## 3. 我们如何降低风险

### 3.1 凭据不交给 Broker 托管

开放平台账号的凭据和状态保存在本机 SQLite 中，不会上传给 Broker 或云端中心服务。这样做减少了中心化托管风险，但不等于凭据永远不会离开本机：当 Agent 向上游接口刷新 token 或调用开放平台能力时，会按接口要求把必要参数发送给对应服务端。

当前 Agent 自身没有对本机 SQLite 做应用层加密。`refresh_token`、`access_token`、自定义 AK/SK 等字段按数据库文本字段保存，因此本机磁盘、系统账号权限、备份范围和恶意本地进程都会影响账号安全。建议用户使用可信设备、系统磁盘加密和最小权限运行环境。

另有一个兼容参数模式会请求 `https://api.oplist.org/baiduyun/renewapi` 来换取 token。这个地址不是百度官方开放平台接口。更可控的方式是使用用户自己的开放平台 AK/SK，直接调用百度 OAuth token 接口。

对应实现：

- 数据结构：`agent/api/src/db/schema.ts`
- 账号管理：`agent/api/src/baidu/accounts.ts`

### 3.2 账号可用性不是默认信任

在接入和运行前，Agent 会检查账号身份、会员状态和空间状态。只要这几项不满足，就不会把账号当成可用账号继续执行。

这避免了“看起来有 token，但实际上已经不能正常工作”的误用。

对应实现：

- 健康探测：`agent/api/src/baidu/accountProbe.ts`
- 运行期复验：`agent/api/src/baidu/openPlatformToken.ts`

### 3.3 token 失效会被显式处理

Agent 不把 token 失效隐藏成成功，也不把失败包装成可忽略状态。

如果 `access_token` 仍有效，就继续使用；如果失效，就尝试通过 `refresh_token` 恢复；如果恢复失败，就把账号标记为需要重新导入，并停止继续使用。

对应实现：

- token 续期：`agent/api/src/baidu/openPlatform.ts`
- token 校验 / 恢复 / 重导入：`agent/api/src/baidu/openPlatformToken.ts`

### 3.4 临时目录有明确边界

转存时只允许在平台配置的临时目录根路径下创建内容，不能越界写入别的位置。

这类限制的目的，是把一次任务产生的数据限定在受控范围内，而不是在本机上任意扩散。

对应实现：

- 目录边界控制：`agent/api/src/baidu/service.ts`

### 3.5 临时文件不会被当成长期资产

链接生成后，相关临时文件会进入清理流程。系统会尝试删除临时目录，删除失败时也会继续记录状态，避免把一次解析结果变成长期残留。

对应实现：

- 清理流程：`agent/api/src/baidu/service.ts`

### 3.6 所有关键动作都有记录

健康检查、token 校验、刷新、失败、需要重新导入等状态，都会进入事件记录。

这样做的目的不是“展示成功率”，而是让异常状态能被追踪、能被审计、能被定位。

对应实现：

- 账号健康检查事件：`agent/api/src/baidu/accounts.ts`
- token 事件记录：`agent/api/src/baidu/openPlatformToken.ts`

## 4. 我们调用了哪些接口

下面只列和开放平台账号主线有关的调用。这样做的目的，是让用户清楚知道软件在本机实际会调用什么、会携带哪些参数。

### 4.1 百度域名下的开放平台主线调用

| 场景 | 接口 | 主要参数 | 作用 | 代码路径 | 官方文档 |
| --- | --- | --- | --- | --- | --- |
| 刷新 token | `GET https://openapi.baidu.com/oauth/2.0/token` | `grant_type=refresh_token`、`refresh_token`、`client_id`、`client_secret` | 用 refresh token 换取新的 access token | `agent/api/src/baidu/openPlatform.ts` | <https://pan.baidu.com/union/doc/0ksg0sbig>、<https://pan.baidu.com/union/doc/Jl0j9pza3> |
| 探测账号信息 | `GET https://pan.baidu.com/rest/2.0/xpan/nas` | `method=uinfo`、`vip_version=v2`、`access_token` | 检查账号身份与 token 可用性 | `agent/api/src/baidu/accountProbe.ts`、`agent/api/src/baidu/openPlatformToken.ts` | <https://pan.baidu.com/union/doc/pksg0s9ns>、<https://pan.baidu.com/union/doc/Jl0j9pza3> |
| 探测空间配额 | `GET https://pan.baidu.com/api/quota` | `checkfree=1`、`checkexpire=1`、`access_token` | 获取总空间、已用空间和剩余空间 | `agent/api/src/baidu/accountProbe.ts`、`agent/api/src/baidu/openPlatformToken.ts` | <https://pan.baidu.com/union/doc/Cksg0s9ic> |
| 探测会员状态 | `GET https://pan.baidu.com/rest/2.0/membership/user` | `method=query`、`clienttype=0`、`app_id=250528`、`web=1`、`access_token` | 辅助确认会员状态 | `agent/api/src/baidu/accountProbe.ts`、`agent/api/src/baidu/openPlatformToken.ts` | 未在当前公开文档索引中确认到单独页面 |
| 创建临时目录 | `POST https://pan.baidu.com/rest/2.0/xpan/file` | `method=create`、`path`、`size=0`、`isdir=1`、`block_list=[]`、`access_token` | 在临时目录根路径下创建转存目录 | `agent/api/src/baidu/service.ts`、`agent/api/src/baidu/client.ts` | <https://pan.baidu.com/union/doc/rksg0sa17> |
| 检查目录是否存在 | `GET https://pan.baidu.com/rest/2.0/xpan/file` | `method=list`、`showempty=1`、`dir`、`access_token` | 确认临时目录及父目录是否已存在 | `agent/api/src/baidu/service.ts`、`agent/api/src/baidu/client.ts` | <https://pan.baidu.com/union/doc/nksg0sat9> |
| 列出网盘文件 | `GET https://pan.baidu.com/rest/2.0/xpan/file` | `method=list`、`showempty=1`、`dir`、`start`、`limit`、`order`、`access_token` | 浏览目录内容或辅助后续处理 | `agent/api/src/baidu/client.ts` | <https://pan.baidu.com/union/doc/nksg0sat9> |
| 转存分享文件 | `POST https://pan.baidu.com/rest/2.0/xpan/share` | `method=transfer`、`shareid`、`from`、`sekey`、`access_token`，以及表单字段 `fsidlist`、`path`、`async=0`、`ondup=newcopy` | 把分享文件转存到临时目录 | `agent/api/src/baidu/service.ts`、`agent/api/src/baidu/client.ts` | <https://pan.baidu.com/union/doc/xksmyoqgv> |
| 生成下载 URL | `GET https://pcs.baidu.com/rest/2.0/pcs/file` | `app_id=250528`、`method=download`、`access_token`、`path` | 按转存后的路径构造下载 URL | `agent/api/src/baidu/service.ts`、`agent/api/src/baidu/client.ts` | 参考下载章节：<https://pan.baidu.com/union/doc/pkuo3snyp> |
| 删除临时文件 | `POST https://pan.baidu.com/rest/2.0/xpan/file` | `method=filemanager`、`opera=delete`、`async=0`、`filelist`、`access_token` | 清理转存后的临时文件或目录 | `agent/api/src/baidu/service.ts`、`agent/api/src/baidu/client.ts` | <https://pan.baidu.com/union/doc/mksg0s9l4> |

生成下载 URL 这一行需要特别说明：官方下载文档重点描述的是先取得 `dlink`，再按下载要求请求文件；当前实现的主线是在转存后按路径构造 `pcs.baidu.com/rest/2.0/pcs/file?method=download` URL。这个实现仍以 `access_token` 和授权账号下的网盘路径为边界，不直接处理未授权账号的数据。

### 4.2 兼容续期服务

| 场景 | 接口 | 主要参数 | 作用 | 代码路径 | 说明 |
| --- | --- | --- | --- | --- | --- |
| 兼容续期 | `GET https://api.oplist.org/baiduyun/renewapi` | `client_uid`、`client_key`、`driver_txt=baiduyun_go`、`server_use=true`、`secret_key`、`refresh_ui` | 在兼容参数模式下换取 access token | `agent/api/src/baidu/openPlatform.ts` | 这不是百度官方开放平台接口，不应写成官方接口；使用前需要理解第三方服务接收 `refresh_token` 的风险。 |

这些调用通常会带上固定请求头，例如 `User-Agent` 和 `Referer`。开放平台下载、转存等官方文档中本身也会要求或示例这些请求头。它们不改变授权边界；真正决定可访问范围的是用户授权、`access_token`、分享参数和网盘路径。

官方文档会随时间调整。上面的链接按当前能核对到的公开页面填写；如果接口路径、参数或权限说明发生变化，应以官方文档和实际接口返回为准。

## 5. 用户应该理解的边界

这套软件降低了风险，但不能消除风险。用户仍然需要理解以下事实：

- 凭据来源必须合法
- 上游接口、额度和风控策略可能变化
- 账号会员状态、空间状态和 token 状态都会影响结果
- 本机 SQLite 当前没有应用层加密，本机设备安全直接影响账号安全
- 使用兼容续期服务时，`refresh_token` 会发送给非百度官方的第三方服务
- 一次成功不代表长期稳定可用

所以，LC Agent 提供的是“本机执行与风险控制能力”，不是“永久稳定的下载地址承诺”。

## 6. 可以直接引用的结论

- 我们使用的是开放平台能力，不是逆向破解或协议绕过
- 我们不把账号交给云端长期托管，而是让本机 Agent 持有并使用凭据
- 我们不把 token 失效隐藏掉，而是做校验、刷新和重新导入收敛
- 我们不把临时文件当成长期资产，而是限制目录并做清理
- 我们不把账号健康默认视为可信，而是每次接入和运行前都检查
