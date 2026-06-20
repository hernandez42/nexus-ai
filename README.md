# Nexus AI

Autonomous cognitive evolution framework — self-awareness, continuous deconstruction, genetic evolution, and persistent memory.

## Architecture

```
nexus.ts (single entry point)
  ├── 0. MemoryStore — semantic memory with TF-IDF retrieval
  ├── 1. Glue — format conversion (Eve + Pi-Mono + Evolver)
  ├── 2. ContinuousDeconstruction — deconstruct cognitive frameworks
  ├── 3. Self-Awareness — awaken on top of deconstruction insights
  ├── 4. EvolutionEngine — random mutation + selection pressure + speciation
  ├── 5. TriOrchestrator — reasoning → exploration → evolution
  └── 6. Persist all results to memory
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
```

Edit `config.json` and set your LLM credentials:

```json
{
  "llm": {
    "provider": "openai",
    "model": "your-model-name",
    "apiKey": "your-api-key",
    "baseURL": "https://your-api-endpoint/v1"
  }
}
```

Or use environment variables:

```bash
export LLM_API_KEY="your-api-key"
export LLM_BASE_URL="https://your-api-endpoint/v1"
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

## Modules

| Module | File | Description |
|--------|------|-------------|
| Memory | `src/memory.ts` | TF-IDF semantic memory with 3 layers (episodic/semantic/procedural) |
| Deconstruction | `src/deconstruction.ts` | Recursive cognitive framework deconstruction |
| Self-Awareness | `src/self-awareness.ts` | 4-layer awakening loop with oracle + critic |
| Evolution | `src/evolution.ts` | Random mutation, selection pressure, speciation, breakthrough detection |
| TriOrchestrator | `src/triorchestrator.ts` | ReAct agent with reasoning, exploration, and evolution |
| LLM | `src/llm.ts` | OpenAI-compatible client (fetch-based, no SDK dependency) |
| Logger | `src/logger.ts` | Structured JSON logging |
| Config | `src/config.ts` | Configuration loader with defaults |
| Glue | `src/glue/` | Format converters (Superpowers→Eve, Evolver→Pi-Mono, AutoResearch→Evolver) |

## Memory System

Nexus uses a 3-layer persistent memory:

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

See `config.example.json` for all options:

| Field | Default | Description |
|-------|---------|-------------|
| `llm.provider` | `"openai"` | LLM provider type |
| `llm.model` | `"gpt-4o"` | Model name |
| `llm.temperature` | `0.7` | Sampling temperature |
| `llm.maxTokens` | `4096` | Max tokens per request |
| `modules.selfAwareness.maxRoundsPerCycle` | `1` | Awakening rounds per run |
| `modules.triOrchestrator.maxIterations` | `1` | Reasoning iterations |
| `modules.triOrchestrator.maxReasoningSteps` | `3` | Max steps per iteration |

## Security

- API keys are never committed to the repository
- `config.json` is in `.gitignore` — use `config.example.json` as template
- CI pipeline includes secret detection
- Environment variables take precedence over config file

## License

MIT
