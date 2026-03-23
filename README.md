# BABEL

AI 驱动的世界状态机。定义世界种子（规则、地点、角色），AI 自动推演涌现叙事。

*AI-driven World State Machine. Define a world seed with rules, locations, and agents — AI autonomously drives emergent narratives.*

## 安全说明 / Security

**BABEL 仅在本地运行。**

- 后端绑定 `127.0.0.1`，不对外暴露
- CORS 仅允许 `localhost` 访问
- API Key 存储在浏览器 localStorage，不上传服务器，不写入任何文件
- 数据库（SQLite）仅存储在本地磁盘
- `.env`、`.db`、密钥文件均已加入 `.gitignore`，不会被提交

**BABEL runs locally only.**

- Backend binds to `127.0.0.1`, not exposed to network
- CORS restricted to `localhost` only
- API Keys stored in browser localStorage — never sent to server storage or committed to files
- Database (SQLite) stored locally on disk
- `.env`, `.db`, and credential files are gitignored

## 架构 / Architecture

```
backend/     Python FastAPI + SQLite + litellm
frontend/    Next.js 14 + Tailwind CSS
design/      设计系统（tokens, 组件, Tailwind preset）
```

## 快速开始 / Quick Start

### 前置条件 / Prerequisites

- Python 3.11+
- Node.js 18+
- LLM API Key（OpenAI、Anthropic 或任何 litellm 兼容的提供商）

### 安装 / Install

```bash
git clone https://github.com/Shangri-la-0428/babel.git
cd babel
./install.sh
```

### 启动 / Run

```bash
babel
```

浏览器自动打开 → 点击右上角 **Settings** → 填入 API Key → 开始。
设置保存在浏览器中，只需配置一次。`Ctrl+C` 停止。

*Browser opens automatically → click Settings → enter your API Key → start.
Settings persist in browser. Configure once. `Ctrl+C` to stop.*

### Docker

```bash
export BABEL_API_KEY="sk-..."
export BABEL_API_BASE="https://..."  # 可选 / optional

docker compose up --build
```

## 工作原理 / How It Works

1. **种子 Seed** — 定义世界：名称、描述、规则、地点、角色（性格/目标）
2. **启动 Launch** — 引擎初始化角色状态，记录初始事件
3. **推演 Tick Loop** — 每轮，每个角色接收上下文（世界规则 + 自身状态 + 近期事件 + 可见角色），LLM 返回结构化 JSON 行动
4. **验证 Validate** — 行动合法性验证（物品/地点/目标必须存在），失败重试 + 兜底
5. **演化 Evolve** — 状态变更应用，事件记录，世界推进

### 反循环保护 / Anti-Loop Protection

角色连续 3 次重复相同行为时，引擎用 LLM 生成符合世界观的随机事件打破循环。

*If an agent repeats the same action 3 times, the engine uses LLM to generate a world-consistent random event to break the cycle.*

## API

| 方法 | 端点 | 说明 |
|------|------|------|
| GET | `/api/seeds` | 获取可用种子列表 / List seed files |
| POST | `/api/worlds` | 从 JSON 创建世界 / Create from JSON |
| POST | `/api/worlds/from-seed/{file}` | 从 YAML 种子创建 / Create from seed |
| POST | `/api/worlds/{id}/run` | 启动模拟 / Start simulation |
| POST | `/api/worlds/{id}/pause` | 暂停 / Pause |
| POST | `/api/worlds/{id}/step` | 单步执行 / Single tick |
| POST | `/api/worlds/{id}/inject` | 注入自定义事件 / Inject custom event |
| POST | `/api/worlds/{id}/chat` | 与角色对话 / Chat with agent |
| POST | `/api/worlds/{id}/oracle` | 与全知旁白对话 / Chat with omniscient narrator |
| GET | `/api/worlds/{id}/oracle/history` | 获取旁白对话历史 / Get narrator history |
| GET | `/api/worlds/{id}/state` | 获取当前状态 / Get state |
| GET | `/api/worlds/{id}/events` | 获取事件历史 / Get events |
| GET | `/api/worlds/{id}/replay` | 获取完整回放 / Get full replay |
| GET | `/api/sessions` | 获取所有会话 / List sessions |
| WS | `/ws/{id}` | 实时事件流 / Real-time stream |

### WebSocket 消息 / Messages

```json
{"type": "connected",     "data": {/* 完整状态 */}}
{"type": "event",         "data": {/* 角色行动 */}}
{"type": "tick",          "data": {"tick": 42, "status": "running"}}
{"type": "state_update",  "data": {/* 完整状态 */}}
{"type": "stopped",       "data": {"tick": 50}}
```

## 种子格式 / Seed Format

```yaml
name: "世界名称"
description: "世界描述"
rules:
  - "规则一"
  - "规则二"
locations:
  - name: "地点A"
    description: "描述"
agents:
  - id: "agent_1"
    name: "角色名"
    description: "角色描述"
    personality: "性格特征"
    goals:
      - "目标一"
    inventory:
      - "物品一"
    location: "地点A"
initial_events:
  - "刚刚发生了某事"
```

内置 3 个种子世界 / 3 seeds included:
- `cyber_bar.yaml` — 赛博酒吧 / Cyberpunk bar
- `apocalypse.yaml` — 末日方舟（参考 2012）/ Post-apocalypse ark
- `iron_throne.yaml` — 铁王座（参考冰与火之歌）/ Throne intrigue

## LLM 配置 / LLM Configuration

BABEL 使用 [litellm](https://github.com/BerriAI/litellm)，支持 OpenAI、Anthropic、Azure、Ollama 等 100+ 提供商。

推荐在 UI 的 Settings 面板中配置（保存在浏览器）。也支持环境变量：

*Configure via the Settings panel in UI (saved in browser). Also supports env vars:*

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `BABEL_API_KEY` | LLM API 密钥 | — |
| `BABEL_MODEL` | 模型标识符 | `gpt-5.4` |
| `BABEL_API_BASE` | 自定义 API 端点 | — |

## 技术栈 / Tech Stack

| 层 | 选择 |
|----|------|
| 后端 Backend | FastAPI + uvicorn |
| 数据库 Database | SQLite (aiosqlite) |
| LLM | litellm |
| 前端 Frontend | Next.js 14 (App Router) |
| 样式 Styling | Tailwind CSS + 自定义设计预设 |
| 实时通信 Real-time | WebSocket |
| 数据验证 Validation | Pydantic v2 |
