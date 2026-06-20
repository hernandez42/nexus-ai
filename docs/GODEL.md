# Gödel Agent Integration

## Overview

Nexus AI integrates the Gödel Agent framework (Yin et al., ACL 2025) for recursive self-improvement. The agent can read and modify its own code at runtime, guided solely by high-level objectives.

## Paper Reference

> Gödel Agent: A Self-Referential Agent Framework for Recursive Self-Improvement
> Xunjian Yin, Xinyi Wang, Liangming Pan, Li Lin, Xiaojun Wan, William Yang Wang
> ACL 2025 — [arXiv:2410.04444](https://arxiv.org/abs/2410.04444)

## Core Primitives

### SELF_INSPECT

The agent introspects its own code, call stack, variables, and memory:

```typescript
import { IntrospectionEngine } from "./godel/introspection";

const engine = new IntrospectionEngine(memory, "./src");
const inspection = engine.fullInspect({
  modules: ["godel-nexus.ts", "godel/introspection.ts"],
  variables: { depth: 1, performance: 5 },
});
// inspection.sourceCode, .callStack, .runtimeState, .memorySnapshot
```

### DECIDE

The LLM decides which actions to take based on introspection:

```typescript
const decision = await llm.chat([{
  role: "user",
  content: `Available actions: ${actions.names().join(", ")}
   Current state: ${JSON.stringify(inspection)}
   Decide next actions as JSON: { actions: [{ name, params }] }`,
}]);
```

### EXECUTE

Actions are executed sequentially. Each action can modify any part of the agent:

```typescript
for (const actionDef of decision.actions) {
  const action = actions.get(actionDef.name);
  const result = await action.execute(actionDef.params, actionContext);
}
```

### EVALUATE

The LLM scores improvement (0-10) and decides whether to continue:

```typescript
const evaluation = await llm.chat([{
  role: "user",
  content: `Rate improvement 0-10. Return JSON: { score, shouldContinue, reason }`,
}]);
```

### RECURSE

If improvement detected and depth < max, recurse:

```typescript
if (evaluation.shouldContinue && depth < maxDepth) {
  return improve(goal, newState, ctx); // recursive call
}
```

## Action Types

| Action | Description | Can Modify |
|--------|-------------|------------|
| `self_inspect` | Read own code and state | No (read-only) |
| `interact` | Use tools to interact with environment | No |
| `self_update` | Modify own source code | **Yes — any module** |
| `memory_query` | Query persistent memory | No |
| `memory_write` | Write to persistent memory | Yes (memory) |
| `evolve` | Run genetic evolution cycle | Yes (organisms) |
| `deconstruct` | Deconstruct cognitive framework | Yes (self-model) |
| `awaken` | Run self-awareness awakening | Yes (self-model) |
| `propose_action` | Register new action type | **Yes — action set** |
| `continue_improve` | Recurse to next depth | No (loop control) |

## Dynamic Action Extension

The agent can propose and register new actions at runtime:

```typescript
// The LLM generates action code
const action = await actions.proposeAction("I need to analyze code quality", llmCall);
// action is now registered and available for future decisions
```

## Nexus AI Extensions Beyond Gödel Agent

| Feature | Gödel Agent Paper | Nexus AI |
|---------|------------------|----------|
| Memory | Runtime only | 3-layer persistent (TF-IDF) |
| Evolution | None | Genetic with speciation |
| Deconstruction | None | Recursive cognitive breaking |
| Self-Awareness | Code reading only | 4-layer oracle-critic |
| Tools | Fixed set | 22 built-in + evolved |
| Action Set | Fixed 4 | 10 built-in + dynamic |

## Safety

- `self_update` requires exact `oldCode` match (no fuzzy replacement)
- `propose_action` validates JSON structure before registration
- `bash` tool blocks destructive commands (`rm -rf /`, `sudo`, `mkfs`)
- All shell commands use `spawnSync` with argument arrays (no injection)
- Max depth prevents infinite recursion
