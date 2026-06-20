# API Reference

## Entry Points

### `npm start` — Linear Pipeline

```bash
npm start -- "your prompt" [--skip-glue] [--skip-deconstruct] [--skip-self-awareness]
```

Runs the linear pipeline: Memory → Glue → Deconstruction → Self-Awareness → Evolution → TriOrchestrator → Persist.

### `npm run godel` — Recursive Self-Improvement

```bash
npm run godel -- "your goal" [--max-depth 3]
```

Runs the Gödel Agent recursive loop: SELF_INSPECT → DECIDE → EXECUTE → EVALUATE → RECURSE.

## Core Modules

### MemoryStore

```typescript
import { MemoryStore } from "./memory";

const memory = new MemoryStore("./path/to/storage");

// Add entry
const id = memory.add({
  layer: "semantic", // "episodic" | "semantic" | "procedural"
  content: "Learned fact",
  tags: ["fact", "important"],
  metadata: { source: "experiment-1" },
});

// Query by similarity
const results = memory.query({
  text: "what did I learn",
  layer: "semantic",
  topK: 5,
  minSimilarity: 0.3,
});

// Stats
const stats = memory.stats(); // { total, episodic, semantic, procedural }

// Persist
memory.save();
```

### ToolRegistry

```typescript
import { ToolRegistry } from "./tools";

const tools = new ToolRegistry();

// List all tools
console.log(tools.names()); // ["read_file", "write_file", "bash", ...]

// Execute a tool
const result = await tools.get("bash")!.execute({
  command: "ls -la",
  timeout: 10000,
});
```

### EvolutionEngine

```typescript
import { EvolutionEngine } from "./evolution";

const engine = new EvolutionEngine(
  { populationSize: 5, mutationRate: 0.5, extinctionThreshold: 10, maxPopulation: 10 },
  async (messages) => llmResponse
);

await engine.seed(); // Generate initial population
engine.applyPressure({ source: "task", intensity: 5, description: "..." });
await engine.mutate(organism);
engine.select();
const breakthroughs = engine.detectBreakthroughs();
const species = await engine.formSpecies();
```

### IntrospectionEngine

```typescript
import { IntrospectionEngine } from "./godel/introspection";

const engine = new IntrospectionEngine(memory, "./src");

// Read own source code
const code = engine.inspectModule("godel-nexus.ts");

// Get call stack
const stack = engine.getCallStack();

// Full inspection
const result = engine.fullInspect({
  modules: ["godel-nexus.ts"],
  variables: { depth: 1 },
});
```

### DynamicActionRegistry

```typescript
import { DynamicActionRegistry } from "./godel/dynamic-actions";

const actions = new DynamicActionRegistry(tools);

// Execute action
const result = await actions.get("self_inspect")!.execute(
  { modules: ["godel-nexus.ts"] },
  { introspection, toolRegistry: tools, memory, llmCall, state }
);

// Propose new action
const newAction = await actions.proposeAction("need to analyze code", llmCall);
```

## LLM Client

```typescript
import { createLLM } from "./llm";

const llm = createLLM({
  provider: "openai", // "openai" | "anthropic" | "ollama" | "mock"
  model: "gpt-4o",
  apiKey: "your-key",
  baseURL: "https://api.openai.com/v1",
  temperature: 0.7,
  maxTokens: 4096,
});

const response = await llm.chat([
  { role: "system", content: "You are helpful." },
  { role: "user", content: "Hello!" },
]);
```

## Configuration

See `config.example.json`. Environment variables override file values:

| Variable | Maps To |
|----------|---------|
| `LLM_API_KEY` | `config.llm.apiKey` |
| `LLM_BASE_URL` | `config.llm.baseURL` |
| `LLM_MODEL` | `config.llm.model` |
| `EVE_REPO` | `config.repos.eve` |
| `PIMONO_REPO` | `config.repos.piMono` |
| `EVOLVER_REPO` | `config.repos.evolver` |
| `SUPERPOWERS_REPO` | `config.repos.superpowers` |
| `AUTORESEARCH_REPO` | `config.repos.autoresearch` |
