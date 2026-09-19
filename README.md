# Zotero-localchat

在 Zotero 阅读侧栏里使用已经登录的 ChatGPT Windows App。每篇论文对应 `Paper` 项目中的一个持续聊天；本地侧栏发送文本，App 使用自己的网络连接，正式回答通过本机事件桥流式返回。

这是一个独立实验项目，与 OpenAI 和 Zotero 无隶属关系。当前适配中文界面的 Windows App，并依赖其页面结构；App 更新可能需要调整适配器。

## 功能

- 侧栏提问、流式正式回答；不显示思考过程或 App 页面过渡。
- 首次发送论文问题时上传 PDF，后续沿用会话；打开侧栏不会上传文件或发送问题。
- 输入框下方选择真实可用的模型和推理强度，支持滑条和滚轮。
- Ctrl＋滚轮调节字号，Ctrl＋0 或百分比按钮恢复默认。
- 拖入或点击 ＋ 添加后续附件，同一次会话继续讨论。单文件最多 64 MB，每次最多 8 个，待发送文件合计最多 128 MB。
- 专用 App 中转窗口隐藏运行并重复使用；断线可重连。发送状态不明时不自动重发，保留输入供确认。
- 不需要 API Key、单独网页登录、复制 Cookie 或更改 Zotero 代理配置。

## 安装与试用

已验证环境：Windows x64、Node.js 24、Zotero 10.0.3 beta、ChatGPT App 26.915.4065。其他版本尚未验证，Zotero 7/8 暂不支持。

1. 安装 Node.js 22 或更高版本，将 Windows 发布包解压到固定位置。
2. 在 ChatGPT 的**聊天项目**里创建名为 `Paper` 的项目，保持账号已登录。
3. 在 PowerShell 中运行 `scripts/Enable-App-Bridge.ps1`。它只创建桌面快捷方式。第一次设置时，在 App 文件菜单中完全退出，再通过 **ChatGPT - Local Chat** 快捷方式打开。
4. 双击 `Start-LocalChat.cmd` 启动本机中转。它不会打开浏览器。
5. 在 Zotero 的插件管理器中“从文件安装插件”，选择发布包里的 `Zotero-localchat-0.4.0.xpi`。建议先使用独立测试配置。
6. 打开 PDF，点击阅读工具栏 **Local Chat**，或按 Ctrl＋Alt＋M。选中文字后也可以点击 **问 Local Chat**。

日常启动 App 后运行 `Start-LocalChat.cmd`，在侧栏点击“当前论文”。可以用 `Stop-LocalChat.cmd` 停止中转；它不会退出 App 或删除聊天。旧 Paper Chat 插件会原位升级，原论文关联自动迁移一份到新配置目录。

首次建立后台窗口时，App 可能短暂显示一个新窗口，随后隐藏；已建立连接后的提问会复用隐藏窗口。首次加载 App、上传附件、服务端排队和模型思考仍需要时间。侧栏的即时传输不能消除模型本身的首字等待。

## 数据与本机连接

```text
Zotero 侧栏 ── 127.0.0.1:23128 ── 本机 Node 中转
                                      │ 页面事件 / 文本 / 附件
                               127.0.0.1:23129
                                      │
                          已登录 ChatGPT App → ChatGPT 服务
```

- 仅监听回环地址。网页请求需要随机连接令牌，并检查 Host、Origin；令牌不进入服务器日志。
- App 的本地调试端口具有控制已登录页面的能力，仅应在可信本机使用，不要暴露到局域网或互联网。不需要时，完全退出 App 并用普通快捷方式启动即可关闭该端口。
- 运行数据在 `%LOCALAPPDATA%\ZoteroLocalChat`：论文与会话关联、后台窗口标识、短期附件。已发送附件的本机暂存副本会删除；异常遗留副本在后续启动时按 24 小时期限清理。ChatGPT 中的文件与聊天仍按账号设置保留。
- 输入草稿和字号保存在本机侧栏存储。论文仅在首次提问时交给 ChatGPT；拖入附件仅在点击发送时交给 App。
- 源码与发布包不包含任何账号、论文、会话记录、调试配置或运行令牌。

## 故障恢复

- **发送按钮不可用**：先确认 App 使用上述快捷方式打开，再点击侧栏“重连”。服务重启后点击 Zotero 上方“当前论文”刷新连接凭据。
- **发送状态未确认**：不要重复提交。重连会核对原聊天的问题及回答，只有确认完成才恢复可发送状态。
- **没有模型选项**：确认当前 App 支持 ChatGPT 聊天，且 `Paper` 是聊天项目。菜单档位来自当前账号，未提供的模型不会出现在侧栏。
- **Paper 会话找不到**：不要删除或移动插件对应的原聊天；当前适配器按云端会话标识定位，标题仅作后备。
- **没有 PDF**：使用 Zotero 上方“空白聊天”。只拖文件而不输入问题不会发送，请附上一个问题。

## 从源码构建

无需 npm 依赖。Windows 自带 .NET Framework 编译仅用于隐藏受管 App 窗口的小型辅助程序。

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-native.ps1
npm test
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/package.ps1
```

测试使用独立的本地 Edge 无头页面和合成数据，不访问真实账号。实际 App 兼容性验证与局部传输耗时见 [验证记录](docs/VALIDATION.md)。

代码结构：`addon/` 为 Zotero 插件；`bridge/` 为本机服务及侧栏；`native/` 为隐藏窗口辅助程序；`tests/` 为回归测试。保留旧插件 ID 是为了兼容原位升级。

MIT License。
