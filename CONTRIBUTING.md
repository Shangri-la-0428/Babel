# Contributing to BABEL

感谢你对 BABEL 的兴趣！以下是参与贡献的指南。

Thanks for your interest in BABEL! Here's how to contribute.

## Quick Start

```bash
git clone https://github.com/Shangri-la-0428/Babel.git
cd babel
./install.sh

# Backend
cd backend
pip install -e ".[dev]"
python -m pytest tests/ -v

# Frontend
cd frontend
npm install
npm run build
```

## Pull Request 流程 / PR Workflow

1. Fork 仓库 / Fork the repo
2. 创建分支 / Create a branch: `git checkout -b feat/your-feature`
3. 提交改动 / Commit changes（见下方 commit 规范）
4. 确保测试通过 / Ensure tests pass
5. 提交 PR / Open a pull request

## Commit 规范 / Commit Convention

```
<type>: <description>

feat:     新功能 / new feature
fix:      修复 / bug fix
docs:     文档 / documentation
refactor: 重构 / refactoring
test:     测试 / tests
chore:    杂项 / maintenance
```

## 测试要求 / Test Requirements

- Backend: `python -m pytest tests/ -v` — 所有测试必须通过
- Frontend: `npm run build` — 构建无错误
- 新功能需要附带测试 / New features should include tests

## 代码风格 / Code Style

- **Python**: 4 空格缩进，type hints
- **TypeScript**: 2 空格缩进，strict mode
- **命名**: Python `snake_case`，TypeScript `camelCase`

## 项目结构 / Project Structure

```
babel/
├── backend/babel/     # Python FastAPI 后端
│   ├── api.py         # REST + WebSocket API
│   ├── engine.py      # 世界引擎 / World engine
│   ├── decision.py    # DecisionSource 协议 / Protocol
│   ├── memory.py      # 记忆系统 v2 / Memory system
│   ├── validator.py   # 世界权威层 / World authority
│   ├── llm.py         # LLM 集成 / LLM integration
│   └── db.py          # SQLite 持久化 / Persistence
├── frontend/          # Next.js 14 前端
└── docs/              # 设计文档 / Design docs
```

## 许可 / License

MIT — 你的贡献将以相同许可发布。
MIT — Your contributions will be released under the same license.
