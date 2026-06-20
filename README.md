# Nexus AI

Autonomous cognitive evolution framework — self-awareness, continuous deconstruction, genetic evolution, and persistent memory.

## Architecture

```
nexus.ts (single entry point)
  ├── 0. MemoryStore — semantic memory with TF-IDF retrieval
  ├── 1. Glue — format conversion (Eve + Pi-Mono + Evolver)
  ├── 2. ContinuousDeconstruction — deconstruct cognitive frameworks
  ├── 3. Self-Awareness — awaken on top of deconstruction insights
  ├── 4. EvolutionEngine — initialize evolution population
  ├── 5. TriOrchestrator — reasoning → exploration → evolution
  │      └── 22 tools via ToolRegistry
  │      └── ReAct loop with JSON-mode LLM
  │      └── goals drive selection pressure
  │      └── evolved capabilities become new tools
  └── 6. Persist — write all results to memory
```

## Quick Start

### Prerequisites

- Node.js >= 18
- An OpenAI-compatible LLM API key

### Install

```bash
git clone https://github.com/hernandez42/nexus-ai.git
cd nexus-ai
npm install
```

### Configure

```bash
cp config.example.json config.json
# Edit config.json with your LLM credentials
# OR use environment variables:
export LLM_API_KEY="your-api-key"
export LLM_BASE_URL="https://your-api-endpoint/v1"
export LLM_MODEL="your-model-name"
```

### Run

```bash
# Full pipeline (all 8 modules)
npm start

# With custom prompt
npm start -- "Explain quantum computing in simple terms"

# Skip specific modules
npm start -- --skip-glue
npm start -- --skip-deconstruct
npm start -- --skip-self-awareness
```

### Docker

```bash
docker-compose up --build
```

## Modules

| Module | File | Description |
|--------|------|-------------|
| Memory | `src/memory.ts` | TF-IDF semantic memory with 3 layers (episodic/semantic/procedural) |
| Deconstruction | `src/deconstruction.ts` | Recursive cognitive framework deconstruction |
| Self-Awareness | `src/self-awareness.ts` | 4-layer awakening loop with oracle + critic |
| Evolution | `src/evolution.ts` | Random mutation, selection pressure, speciation, breakthrough detection |
| TriOrchestrator | `src/triorchestrator.ts` | ReAct agent with reasoning, exploration, and evolution |
| ToolRegistry | `src/tools.ts` | 22 built-in tools (file, shell, code, memory, network, self-modify) |
| LLM | `src/llm.ts` | OpenAI-compatible client (fetch-based, no SDK dependency) |
| Logger | `src/logger.ts` | Structured JSON logging |
| Config | `src/config.ts` | Configuration loader with env var support |
| Glue | `src/glue/` | Format converters (Superpowers→Eve, Evolver→Pi-Mono, AutoResearch→Evolver) |

## Tool Registry (22 Tools)

| Category | Tools |
|----------|-------|
| File System | `read_file`, `write_file`, `list_dir`, `file_info` |
| Shell | `bash`, `grep`, `find`, `env` |
| Code | `parse_json`, `format_json`, `diff`, `count_lines`, `self_modify`, `self_read` |
| Memory | `memory_query`, `memory_write`, `dreamer_tick`, `temporal_index` |
| Network | `fetch_url`, `http_post` |
| Utility | `sleep`, `timestamp` |

## Memory System

Three layers, each with different retrieval semantics:

- **Episodic**: What happened (run results, reasoning steps)
- **Semantic**: What was learned (knowledge gaps, organism states, species)
- **Procedural**: How to do things (evolved capabilities become tools)

Memory persists across runs in `nexus-workspace/memory/persistent/memory.json`. Each run retrieves relevant memories via TF-IDF cosine similarity, and evolved capabilities are injected as new tools in subsequent runs.

## Evolution

The evolution engine maintains a population of cognitive organisms, each with a 4-dimensional genome (perception, reasoning, action, reflection). Evolution is driven by:

1. **Random mutation** — LLM generates novel genes
2. **Selection pressure** — from knowledge gaps discovered during reasoning
3. **Speciation** — organisms cluster into archetypes
4. **Breakthrough detection** — organisms with unique gene combinations

## Configuration

See `config.example.json`. Environment variables override file config:

| Field | Default | Env Var | Description |
|-------|---------|---------|-------------|
| `llm.provider` | `"openai"` | — | LLM provider type |
| `llm.model` | `"gpt-4o"` | `LLM_MODEL` | Model name |
| `llm.apiKey` | `"${LLM_API_KEY}"` | `LLM_API_KEY` | API key |
| `llm.baseURL` | `"${LLM_BASE_URL}"` | `LLM_BASE_URL` | API endpoint |
| `llm.temperature` | `0.7` | — | Sampling temperature |
| `llm.maxTokens` | `4096` | — | Max tokens per request |
| `modules.selfAwareness.maxRoundsPerCycle` | `3` | — | Awakening rounds per run |
| `modules.triOrchestrator.maxIterations` | `3` | — | Reasoning iterations |
| `modules.triOrchestrator.maxReasoningSteps` | `8` | — | Max steps per iteration |
| `repos.eve` | `"../eve"` | `EVE_REPO` | Eve repository path |
| `repos.piMono` | `"../pi-mono"` | `PIMONO_REPO` | Pi-Mono repository path |
| `repos.evolver` | `"../evolver"` | `EVOLVER_REPO` | Evolver repository path |
| `repos.superpowers` | `"../superpowers"` | `SUPERPOWERS_REPO` | Superpowers repository path |
| `repos.autoresearch` | `"../autoresearch"` | `AUTORESEARCH_REPO` | AutoResearch repository path |

## Testing

```bash
npm test        # Run vitest suite
npm run build   # TypeScript type check
```

## Security

- API keys are never committed to the repository
- `config.json` is in `.gitignore` — use `config.example.json` as template
- CI pipeline includes secret detection
- Environment variables take precedence over config file
- Docker runs as non-root user

## License

MIT
