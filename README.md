# BABEL

[![Backend Tests](https://github.com/Shangri-la-0428/Babel/actions/workflows/backend.yml/badge.svg)](https://github.com/Shangri-la-0428/Babel/actions/workflows/backend.yml)
[![Frontend Build](https://github.com/Shangri-la-0428/Babel/actions/workflows/frontend.yml/badge.svg)](https://github.com/Shangri-la-0428/Babel/actions/workflows/frontend.yml)

AI 原生世界工作室。定义世界种子（规则、地点、角色），运行可持续演化、可干预、可分叉的活世界。

*AI-native world studio. Define a world seed with rules, locations, and agents — then run living worlds that can evolve, be directed, and branch over time.*

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

详细架构文档见 [`ARCHITECTURE.md`](ARCHITECTURE.md)。战略方向见 [`docs/STRATEGY.md`](docs/STRATEGY.md)。执行路线图见 [`docs/ROADMAP.md`](docs/ROADMAP.md)。变更记录见 [`CHANGELOG.md`](CHANGELOG.md)。

*See [`ARCHITECTURE.md`](ARCHITECTURE.md) for detailed architecture, [`docs/STRATEGY.md`](docs/STRATEGY.md) for product direction, [`docs/ROADMAP.md`](docs/ROADMAP.md) for the execution roadmap, and [`CHANGELOG.md`](CHANGELOG.md) for changes.*

## 快速开始 / Quick Start

### 前置条件 / Prerequisites

- Python 3.11+
- Node.js 18+
- LLM API Key（OpenAI、Anthropic 或任何 litellm 兼容的提供商）

### 安装 / Install

```bash
git clone https://github.com/Shangri-la-0428/Babel.git
cd babel
./install.sh
```

### 启动 / Run

```bash
babel
```

浏览器自动打开 → 点击右上角 **Settings** → 填入 API Key → 开始。
设置保存在浏览器中，只需配置一次。`Ctrl+C` 停止。

默认会在启动前自动检查更新，并在本地工作区干净时自动快进到最新版本。
如果你本地改过代码、分支已分叉，或当前离线，自动更新会跳过，不会强拉代码。

手动更新：

```bash
babel update
```

临时关闭自动更新：

```bash
BABEL_AUTO_UPDATE=0 babel
```

*Browser opens automatically → click Settings → enter your API Key → start.
Settings persist in browser. Configure once. `Ctrl+C` to stop.*

*BABEL checks for updates before launch and fast-forwards automatically when the local checkout is clean.
If you have local edits, a diverged branch, or no network, it skips the update safely.*

### Docker

```bash
export BABEL_API_KEY="sk-..."
export BABEL_API_BASE="https://..."  # 可选 / optional

docker compose up --build
```

## 工作原理 / How It Works

1. **种子 Seed** — 定义世界：名称、描述、规则、地点、角色（性格/目标）
2. **启动 Launch** — 引擎初始化角色状态，记录初始事件
3. **推演 Tick Loop** — 每轮，每个角色接收上下文（世界规则 + 自身状态 + 近期事件 + 可见角色 + 关系 + 信念 + 当前目标），LLM 返回结构化 JSON 行动
4. **验证 Validate** — 行动合法性验证（物品/地点/目标/关系必须合法），失败重试 + 兜底
5. **目标追踪 Goal Tracking** — 每次行动后评估目标进度，停滞自动重规划，完成自动切换
6. **记忆演化 Memory** — 事件生成记忆，重要度评分，LLM 语义压缩，信念提炼
7. **演化 Evolve** — 状态变更应用，关系更新，事件记录，世界推进

### 核心系统 / Core Systems

| 系统 | 说明 |
|------|------|
| **世界权威层** | 关系模型、移动邻接校验、物品来源校验、同位置交互要求 |
| **记忆系统 v2** | 信念提炼（规则驱动）、LLM 语义压缩、重要度评分（关系/自身/目标加权） |
| **目标系统** | GoalState 生命周期（active → completed/stalled）、进度追踪、LLM 重规划 |
| **世界内核协议** | DecisionSource 可插拔决策接口（LLM/Human/Psyche/Script）、结构化事件、语义记忆 |
| **Psyche 情感引擎** | 虚拟内分泌系统（6 激素）、5 马斯洛驱力、自主神经门控、驱力-目标亲和力映射 |
| **Oracle 创世助手** | 对话式世界创建，LLM 生成完整 WorldSeed，一键启动 |

*Core Systems: World Authority (relations, topology, validation), Memory v2 (beliefs, LLM compression, importance scoring), Goal System (tracking, replanning), World Kernel Protocol (pluggable DecisionSource, structured events), Psyche Emotional Engine (virtual endocrine, drives, autonomic gating, drive-goal mapping), Oracle Creative (conversational world creation).*

### 反循环保护 / Anti-Loop Protection

角色连续 3 次重复相同行为时，引擎用 LLM 生成符合世界观的随机事件打破循环。

*If an agent repeats the same action 3 times, the engine uses LLM to generate a world-consistent random event to break the cycle.*

## API

| 方法 | 端点 | 说明 |
|------|------|------|
| GET | `/api/seeds` | 获取可用种子列表 / List seed files |
| GET | `/api/seeds/{filename}` | 获取种子内容 / Get seed content |
| POST | `/api/worlds` | 从 JSON 创建世界 / Create from JSON |
| POST | `/api/worlds/from-seed/{filename}` | 从 YAML 种子创建 / Create from seed |
| POST | `/api/worlds/{session_id}/agents` | 添加角色 / Add agent to world |
| POST | `/api/worlds/{session_id}/run` | 启动模拟 / Start simulation |
| POST | `/api/worlds/{session_id}/step` | 单步执行 / Single tick |
| POST | `/api/worlds/{session_id}/pause` | 暂停 / Pause |
| GET | `/api/worlds/{session_id}/state` | 获取当前状态 / Get state |
| GET | `/api/worlds/{session_id}/events` | 获取事件历史 / Get events |
| POST | `/api/worlds/{session_id}/inject` | 注入自定义事件 / Inject custom event |
| POST | `/api/worlds/{session_id}/take-control/{agent_id}` | 接管角色 / Take human control |
| POST | `/api/worlds/{session_id}/release-control/{agent_id}` | 释放角色 / Release to AI |
| POST | `/api/worlds/{session_id}/human-action` | 提交人类行动 / Submit human action |
| GET | `/api/worlds/{session_id}/human-status` | 人类控制状态 / Human control status |
| POST | `/api/worlds/{session_id}/chat` | 与角色对话 / Chat with agent |
| POST | `/api/worlds/{session_id}/oracle` | 与旁白对话 / Chat with narrator (`mode=narrate\|create`) |
| GET | `/api/worlds/{session_id}/oracle/history` | 旁白对话历史 / Narrator history |
| POST | `/api/worlds/{session_id}/enrich` | 实体细节生成 / Generate entity details |
| GET | `/api/worlds/{session_id}/entity-details` | 获取实体细节 / Get entity details |
| GET | `/api/worlds/{session_id}/replay` | 获取完整回放 / Full replay |
| GET | `/api/worlds/{session_id}/timeline` | 时间线节点 / Timeline nodes |
| GET | `/api/worlds/{session_id}/snapshots` | 快照列表 / World snapshots |
| GET | `/api/worlds/{session_id}/agents/{agent_id}/memories` | 角色记忆 / Agent memories |
| POST | `/api/worlds/{session_id}/reconstruct` | 从快照重建 / Reconstruct from snapshot |
| GET | `/api/sessions` | 获取所有会话 / List sessions |
| DELETE | `/api/sessions/{session_id}` | 删除会话 / Delete session |
| GET | `/api/assets` | 资产库列表 / List saved assets |
| GET | `/api/assets/{seed_id}` | 获取资产 / Get asset |
| POST | `/api/assets` | 保存资产 / Save asset |
| DELETE | `/api/assets/{seed_id}` | 删除资产 / Delete asset |
| POST | `/api/assets/extract/{type}` | 提取资产 / Extract asset (agent/item/location/event/world) |
| WS | `/ws/{session_id}` | 实时事件流 / Real-time stream |

### WebSocket 消息 / Messages

```json
{"type": "connected",     "data": {/* 完整状态 (含 agents.active_goal, relations) */}}
{"type": "event",         "data": {/* 角色行动 (含 structured) */}}
{"type": "tick",          "data": {"tick": 42, "status": "running"}}
{"type": "state_update",  "data": {/* 完整状态 */}}
{"type": "stopped",       "data": {"tick": 50}}
{"type": "agent_added",   "data": {/* 新角色检测 */}}
{"type": "waiting_for_human", "data": {/* 等待人类操作 */}}
{"type": "human_control", "data": {"agent_id": "...", "controlled": true}}
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
    connections: ["地点B"]     # 可达位置（双向）
  - name: "地点B"
    description: "描述"
    connections: ["地点A"]
agents:
  - id: "agent_1"
    name: "角色名"
    description: "角色描述"
    personality: "性格特征"
    goals:
      - "目标一"              # 第一个目标自动成为 active_goal
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
| `BABEL_MODEL` | 模型标识符 | `gpt-4o-mini` |
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

## 生态 / Ecosystem

- [Psyche](https://github.com/Shangri-la-0428/oasyce_psyche) — 主观连续性内核 / Subjectivity kernel
- [Thronglets](https://github.com/Shangri-la-0428/Thronglets) — 执行连续性 / Delegate continuity
- [Oasyce Chain](https://github.com/Shangri-la-0428/oasyce-chain) — L1 结算链 / Settlement chain
- [Oasyce SDK](https://github.com/Shangri-la-0428/oasyce-sdk) — Agent 运行时 / Agent runtime
