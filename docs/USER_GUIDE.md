# Claude Code Studio 用户使用指南

这份文档面向第一次使用应用的用户，不要求你了解项目源码。

## 快速开始

1. 打开应用后，按首次设置向导完成基础配置。
2. 在 `Provider 管理` 添加一个模型服务，填写 Base URL、API Key 和默认模型。
3. 在左侧 `项目` 区点击 `+`，选择要让 Claude Code 工作的代码目录。
4. 在 `身份与协作` 中创建或选择身份。身份是一组 Skills 能力和行为规则。
5. 回到首页，在底部输入任务并发送。

## Provider 是什么

Provider 是模型 API 配置。常见 Provider 包括 Anthropic、OpenAI、DeepSeek、Moonshot、通义、智谱等。

添加 Provider 后建议立刻点击 `测试`，确认 API Key、Base URL 和模型名可用。

## Skills 和身份

Skills 是可复用能力说明，身份是 Skills 的组合。

你可以：

- 导入或扫描 Skills。
- 使用 `AI 分类生成` 或 `模板生成` 创建身份。
- 手动编辑身份包含的 Skills。
- 切换身份后同步到 Claude Code。

## Teams 工作流

Teams 是可视化身份工作流。你可以把项目经理、开发、测试、审核等身份拖到画布上，再用交接线定义流程。

推荐从 `PM-Dev-QA 模板` 开始：

- 项目经理澄清需求。
- 开发根据需求实现。
- 测试不满意时返回开发。
- 测试满意后交给项目经理审核。
- 审核通过后输出正式结果。

运行 Teams 时，应用会把当前节点的提示词填入首页输入框，你仍然可以人工检查后再提交。

## MCP 服务

MCP 用来给 Claude 接入外部工具，例如文件系统、数据库、浏览器或业务 API。

添加 MCP 后建议：

1. 先使用 `同步预览` 查看即将写入 Claude 的配置。
2. 再点击 `同步`。
3. 如果服务不可用，先检查命令、参数和本机环境变量。

## 插件

插件可以通过 marketplace 名称安装，也可以导入本地插件文件夹。

本地插件文件夹需要包含以下任意清单文件：

- `.claude-plugin/plugin.json`
- `.codex-plugin/plugin.json`
- `plugin.json`
- `package.json`

## 常见问题

### 为什么首页不能发送任务

请先确认：

- 已选择左侧项目目录。
- 已添加可用 Provider。
- Claude Code 已安装并可检测到。

### 为什么 Teams 输出看起来像内部计划

Teams 默认使用 `Auto` 权限执行交接，避免卡在 Plan 模式。如果旧 Team 成员曾配置为 Plan，运行时也会自动降为 Auto。

### Provider 测试失败怎么办

检查 Base URL、API Key、模型名和 API 格式。OpenAI-compatible 服务通常选择 `OpenAI 兼容`。

### Skills 同步后没生效怎么办

先在 `Skills 管理` 里重新检测，再到 `身份与协作` 中同步当前身份。

## 故障排查

进入 `诊断` 页面，复制诊断报告。报告会包含 Claude 路径、Node 路径、当前项目、Runner 状态和数据统计。
