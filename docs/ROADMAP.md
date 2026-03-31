# BABEL Execution Roadmap

> Updated: 2026-03-31

This document is not a feature backlog.

It defines one core capability and the simplest execution path for deepening it.

## One Capability

BABEL should become excellent at one thing:

> **running a living world that stays coherent, can explain itself, accepts intervention, and can later be branched and published**

Everything else should be treated as a projection of that capability.

If a task creates a new surface area but does not deepen this capability, it is probably noise.

## Canonical Capability Stack

Build downward into the same stack instead of sideways into more features.

### 1. World Loop

The irreducible core is:

`state -> perception -> pressure -> intent -> action -> consequence -> significance -> memory`

This is the thing BABEL must keep strengthening.

What "better" means:
- actions matter more
- consequences accumulate
- significance is explicit
- memory and relations shape future behavior
- the world feels causally alive instead of merely active

### 2. Projection

The same canonical world should power:
- simulation
- world creation
- assets
- summaries
- future publishing

What "better" means:
- fewer page-local concepts
- less duplicated logic
- clearer instance/template boundaries

### 3. Intervention

Intervention should collapse into four verbs:
- observe
- nudge
- direct
- fork

What "better" means:
- fewer overlapping controls
- cleaner semantics
- more power with less explanation

### 4. Publishing

Publishing is not a separate mode.
It is what happens when a living world becomes legible and reusable.

What "better" means:
- a world can be summarized
- a branch can be inspected
- a world can be exported without losing continuity

## Execution Order

Always deepen capabilities in this order:

1. **world loop**
2. **projection**
3. **intervention**
4. **publishing**
5. **platform**

Do not move downward until the layer above becomes meaningfully stronger.

## What To Build Next

The next tranche should still serve the same single capability.

### Tranche 1 — Make the world know what matters

Capability:
- significance-aware world evolution

Concrete implementation direction:
- attach explicit significance to consequences and events
- make the world retain meaningful turns, not just all turns
- use significance to decide what gets remembered, summarized, surfaced, and branched

Done means:
- the world distinguishes noise from meaningful change
- users can follow what matters without reading raw logs

### Tranche 2 — Make the world explain itself

Capability:
- inspectable continuity

Concrete implementation direction:
- expose current intent, active goal, blockers, and recent outcome as runtime state
- project that state consistently to every surface

Done means:
- users can tell what a character is trying to do and why
- continuity is inspectable, not inferred from hidden prompts

### Tranche 3 — Make intervention one concept

Capability:
- canonical intervention contract

Concrete implementation direction:
- align inject, oracle, manual decision, and future branching under observe / nudge / direct / fork
- remove wording and controls that describe mechanism instead of user intent

Done means:
- the system feels simpler while becoming more powerful
- the user does not need to learn separate mental models for adjacent controls

### Tranche 4 — Make quality measurable

Capability:
- world coherence evaluation

Concrete implementation direction:
- install continuity benchmarks, benchmark worlds, and scorecards for liveness, continuity, readability, and intervention quality

Done means:
- changes improve the same core capability measurably
- product quality is no longer judged only by intuition

### Tranche 5 — Make the living world publishable

Capability:
- readable world artifacts

Concrete implementation direction:
- generate summaries, arc views, branch views, and exportable creator artifacts from the same significance-aware history

Done means:
- outputs feel like creator-grade artifacts, not debug traces

## Simplicity Rules

To keep the system elegant:

- prefer one stronger protocol over three new controls
- prefer one canonical object model over page-specific copies
- prefer one intervention model over several overlapping features
- prefer deleting concepts over renaming clutter
- prefer capabilities that simplify future work, not features that multiply exceptions

## Explicit Non-Goals

Do not prioritize:

- decorative feature breadth
- provider-shaped product branches
- auto-saving everything into the library
- platform surfaces before the world loop is strong
- new product categories that bypass the canonical world model

## Definition of Progress

Progress means the system becomes:

- more coherent
- more legible
- more intervenable
- more reusable
- simpler to explain

If BABEL becomes broader but not simpler, the roadmap is wrong.
