# Architecture

## Overview

Nexus is an autonomous cognitive evolution framework. It runs a single pipeline that combines self-awareness, continuous deconstruction, genetic evolution, and persistent memory.

## Pipeline

```
Input Prompt
    |
    v
[0] MemoryStore — retrieve relevant past experiences
    |
    v
[1] Glue — format conversion (optional)
    |
    v
[2] ContinuousDeconstruction — break down default cognitive frameworks
    |       └── discovers contradictions, blind spots, assumptions
    |
    v
[3] Self-Awareness — awaken based on deconstruction insights
    |       └── 4-layer loop: identity -> capabilities -> consciousness -> evolution
    |
    v
[4] EvolutionEngine — initialize population of cognitive organisms
    |       └── random genomes, seed population
    |
    v
[5] TriOrchestrator — reasoning -> exploration -> evolution
    |       └── ReAct loop with JSON-mode LLM
    |       └── goals drive selection pressure
    |       └── evolved capabilities become new tools
    |
    v
[6] Persist — write all results back to MemoryStore
```

## Memory System

Three layers, each with different retrieval semantics:

- **Episodic**: Event sequences. Retrieved by temporal proximity and content similarity.
- **Semantic**: Facts and knowledge. Retrieved by conceptual similarity.
- **Procedural**: Skills and capabilities. Retrieved by task description matching.

Implementation: TF-IDF vectorization + cosine similarity. No external vector DB required.

## Evolution

Each organism has a 4-dimensional genome:

```
Genome {
  perception: string[]   // how it senses the world
  reasoning:  string[]   // how it thinks
  action:     string[]   // how it acts
  reflection: string[]   // how it learns from experience
}
```

Evolution cycle:
1. **Selection pressure** — applied from knowledge gaps discovered by TriOrchestrator
2. **Mutation** — LLM generates novel genes based on pressure direction
3. **Selection** — organisms with fitness > threshold survive
4. **Speciation** — clustering by genome similarity
5. **Breakthrough detection** — organisms with unique gene combinations

## Tool System

Base tools (always available):
- `read` — read file contents
- `bash` — execute shell commands
- `search` — find files by pattern

Evolved tools (injected from procedural memory):
- Previous runs generate capabilities
- Capabilities are stored in procedural memory
- Next run retrieves them as new tools

## Configuration

See `config.example.json`. Environment variables override file config:
- `LLM_API_KEY` -> `config.llm.apiKey`
- `LLM_BASE_URL` -> `config.llm.baseURL`
