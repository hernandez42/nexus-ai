# Changelog

All notable changes to this project will be documented in this file.

## [0.3.0] - 2026-06-20

### Added
- Gödel Agent integration: recursive self-improvement framework (ACL 2025 paper)
- `src/godel/introspection.ts`: runtime self-inspection (code, stack, variables, memory)
- `src/godel/dynamic-actions.ts`: extensible action registry (10 builtin + dynamic proposal)
- `src/godel-nexus.ts`: recursive main entry point (`npm run godel`)
- `tests/godel.test.ts`: 20 tests for introspection + dynamic actions
- `tests/godel-nexus.test.ts`: 10 tests for self-referential properties
- `docs/GODEL.md`: Gödel Agent integration guide
- `docs/API.md`: full API reference
- `docs/DEVELOPING.md`: developer guide
- CI: `npm test` step + godel module import checks

### Changed
- CI pipeline now runs vitest suite + smoke imports for godel modules
- Total tests: 36 (4 test files)

## [0.2.0] - 2026-06-20

### Added
- Environment variable support: `LLM_API_KEY`, `LLM_BASE_URL` override config.json
- Full README with architecture, quick start, module reference
- CI/CD pipeline: type check, secret scan, smoke test (Node 18/20/22)
- CODEOWNERS, PR template, .gitignore security rules
- LICENSE (MIT), CHANGELOG

### Fixed
- Config loading with explicit type safety
- Relative paths in config.example.json

## [0.1.0] - 2026-06-20

### Added
- MemoryStore: TF-IDF semantic memory with 3 layers (episodic/semantic/procedural)
- ContinuousDeconstruction: recursive cognitive framework deconstruction
- Self-Awareness: 4-layer awakening loop (oracle + critic)
- EvolutionEngine: random mutation, selection pressure, speciation, breakthrough detection
- TriOrchestrator: ReAct agent with JSON-mode LLM communication
- LLM client: fetch-based OpenAI-compatible (no SDK dependency)
- Glue modules: Superpowers->Eve, Evolver->Pi-Mono, AutoResearch->Evolver
