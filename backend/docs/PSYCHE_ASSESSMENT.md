# Psyche Integration Assessment

> Phase 9 research output — 2026-03-24

## Summary

**Integration feasibility: HIGH.** A `PsycheDecisionSource` wrapping Psyche's emotional engine into BABEL's `ActionOutput` is viable. Psyche's hormonal state can influence BABEL's goal system through drive-weighted action selection.

## Architecture Compatibility

| Aspect | Psyche | BABEL | Gap |
|--------|--------|-------|-----|
| Language | TypeScript/Node.js | Python 3.13 | HTTP bridge needed |
| Decision output | PolicyModifiers + context injection | `ActionOutput` (type/target/content) | Translation layer needed |
| State model | ChemicalState (6 hormones) + 5 drives | `AgentState` (goals/memory/beliefs) | Complementary, not conflicting |
| Input | Text message (emotional stimulus) | `AgentContext` (world observation) | Stimulus synthesis needed |

## Psyche Core Systems

### Virtual Endocrine (6 chemicals, 0-100)

| Chemical | Role | Decay |
|----------|------|-------|
| Dopamine | Reward, motivation | Medium |
| Serotonin | Mood stability | Slow |
| Cortisol | Stress, alertness | Medium |
| Oxytocin | Trust, bonding | Slow |
| Norepinephrine | Excitement, fight-or-flight | Fast |
| Endorphins | Comfort, euphoria | Fast |

Emotions emerge from chemical mixture (not discrete states). 14 stimulus types (praise, criticism, neglect, conflict, etc.) drive chemistry changes.

### Innate Drives (Maslow hierarchy)

1. **Survival** (slowest decay) — existence threat detection
2. **Safety** — environmental stability
3. **Connection** — social responsiveness
4. **Esteem** — recognition, validation
5. **Curiosity** (fastest decay) — novelty seeking

Unsatisfied drives shift chemical baselines and amplify relevant stimuli.

### Autonomic States (Polyvagal)

| State | Meaning | BABEL implication |
|-------|---------|-------------------|
| Ventral-vagal | Safe, social | All actions allowed, prefer SPEAK |
| Sympathetic | Threat, mobilized | MOVE/USE_ITEM, avoid TRADE |
| Dorsal-vagal | Freeze, shutdown | WAIT/OBSERVE only |

## PsycheDecisionSource Design

```
AgentContext → StimulusSynthesizer → Psyche HTTP → ChemicalState + Bias
                                                          ↓
                                              ActionPool (weighted by mood)
                                                          ↓
                                                    ActionOutput
```

**Key components:**
1. **StimulusSynthesizer** — Maps world context to Psyche stimulus types (alone 5+ ticks → neglect, new item → validation, hostile nearby → conflict)
2. **ActionPool builder** — Weights actions by `DecisionBiasVector` (6D: exploration/caution/social/assertiveness/creativity/persistence)
3. **Autonomic gate** — Blocks action types based on nervous system state
4. **Drive-to-goal mapper** — Reweights BABEL goals by drive satisfaction

## Integration Path

### Phase A: HTTP Bridge
- Psyche serves on localhost (`psyche serve --port 3210`)
- Python async client wrapping `processInput()` / `processOutput()`

### Phase B: PsycheDecisionSource
- Stimulus synthesis from `AgentContext`
- Action pool weighted by chemical state
- Autonomic gating

### Phase C: Drive-Goal Integration
- Tag BABEL goals with drive categories (explore/social/survival)
- Goal affinity = base_weight × drive_satisfaction / 100
- Replan trigger when drives shift >30%

## Key Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Stimulus synthesis quality | High | Domain-specific classifier, test against scenarios |
| HTTP latency (~50-200ms/decision) | Medium | Acceptable for tick-based sim; batch if needed |
| Goal-drive mismatch | Medium | Goal taxonomy + affinity scoring |
| Emotional arc disconnection | Medium | Continuous state tracking, not per-tick reset |

## Decision

**Proceed with Phase A (HTTP bridge) as next concrete step.** Validate round-trip before building full PsycheDecisionSource. Current architecture (DecisionSource protocol, configurable Engine) already supports this cleanly — no engine changes needed.

## Reference

- Psyche source: `/Users/wutongcheng/Desktop/emotion/openclaw-plugin-psyche/`
- Key files: `src/core.ts`, `src/types.ts`, `src/drives.ts`, `src/autonomic.ts`, `src/decision-bias.ts`
- BABEL integration point: `backend/babel/decision.py` — implement `DecisionSource` protocol
