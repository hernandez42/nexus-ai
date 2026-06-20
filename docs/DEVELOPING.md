# Developing Nexus AI

## Prerequisites

- Node.js >= 18
- npm >= 9

## Setup

```bash
git clone https://github.com/hernandez42/nexus-ai.git
cd nexus-ai
npm install
cp config.example.json config.json
# Edit config.json with your LLM credentials
```

## Project Structure

```
src/
  nexus.ts              # Linear pipeline entry point
  godel-nexus.ts        # Gödel Agent recursive entry point
  config.ts             # Configuration loader
  llm.ts                # LLM client (fetch-based, no SDK)
  logger.ts             # Structured JSON logging
  memory.ts             # 3-layer TF-IDF memory store
  tools.ts              # 22-tool registry
  evolution.ts          # Genetic evolution engine
  deconstruction.ts     # Cognitive framework deconstruction
  self-awareness.ts     # 4-layer awakening loop
  triorchestrator.ts    # ReAct agent with reasoning + exploration
  godel/
    introspection.ts    # Runtime self-inspection
    dynamic-actions.ts  # Extensible action registry
  glue/
    superpowers-to-eve.ts       # Format converter
    evolver-to-pimono.ts       # Format converter
    autoresearch-to-evolver.ts # Format converter
tests/
  memory.test.ts        # MemoryStore tests
  evolution.test.ts     # EvolutionEngine tests
  godel.test.ts         # Introspection + DynamicAction tests
  godel-nexus.test.ts   # Self-referential property tests
docs/
  ARCHITECTURE.md       # System architecture
  GODEL.md              # Gödel Agent integration
  API.md                # API reference
example/
  basic-usage.ts        # Linear pipeline example
```

## Commands

```bash
npm start              # Run linear pipeline
npm run godel          # Run Gödel Agent recursive loop
npm run build          # TypeScript type check (tsc --noEmit)
npm test               # Run vitest suite
npm run test:watch     # Run tests in watch mode
```

## Adding a New Module

1. Create `src/your-module.ts` with exported class/function
2. Add tests in `tests/your-module.test.ts`
3. Import in `nexus.ts` or `godel-nexus.ts`
4. Run `npm run build` to verify types
5. Run `npm test` to verify tests

## Adding a New Tool

```typescript
// In tools.ts, inside registerBuiltins():
this.register({
  name: "your_tool",
  description: "What it does",
  parameters: { param1: "string" },
  execute: async (p) => {
    // implementation
    return { result: "..." };
  },
});
```

## Adding a New Gödel Action

```typescript
// In godel/dynamic-actions.ts, inside registerBuiltinActions():
this.register({
  name: "your_action",
  description: "What it does",
  parameters: { param1: "string" },
  execute: async (params, context) => {
    // Can use context.introspection, .toolRegistry, .memory, .llmCall, .state
    return { result: "..." };
  },
});
```

## Code Style

- TypeScript strict mode (`"strict": true` in tsconfig.json)
- No `any` types — use `unknown` + `instanceof` narrowing
- No `execSync(string)` — use `spawnSync(cmd, [args])` to prevent injection
- All catches: `catch (e: unknown)` with `e instanceof Error ? e.message : String(e)`
- No hardcoded secrets — use environment variables

## Testing

Tests use [vitest](https://vitest.dev/). Each test file mirrors its source file:

```
src/memory.ts          → tests/memory.test.ts
src/evolution.ts       → tests/evolution.test.ts
src/godel/*.ts         → tests/godel.test.ts
src/godel-nexus.ts     → tests/godel-nexus.test.ts
```

Run tests:

```bash
npm test               # Run all tests
npx vitest run tests/godel.test.ts  # Run specific file
```

## CI/CD

GitHub Actions runs on push/PR to `main`:

1. **Build**: `tsc --noEmit` on Node 18/20/22
2. **Security**: Secret detection scan
3. **Test**: Smoke test (module imports) + vitest

## Security

- `config.json` is in `.gitignore` — never commit API keys
- Shell commands use `spawnSync` with argument arrays
- `bash` tool blocks destructive commands
- `sanitizePath()` prevents directory traversal
- CI pipeline scans for leaked secrets

## Docker

```bash
docker-compose up --build
```

See `Dockerfile` and `docker-compose.yml` for details.
