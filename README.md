# ctxaudit

**Find out how much of your agent's context window is burned before you type a single word.**

```
$ npx ctxaudit

ctxaudit — pre-flight context audit
  /Users/you/payments-platform

  15.0% of the context window is gone before you type.
  ████░░░░░░░░░░░░░░░░░░░░  29,928 / 200,000 tokens
  window: Claude (200k) · tokenizer: o200k_base

  Breakdown
  MCP tool schemas (3 servers)    29,000   96.9%  ████████████
  AGENTS.md                          675    2.3%  ░░░░░░░░░░░░
  skill metadata (4 skills)          127    0.4%  ░░░░░░░░░░░░
  MCP config files                   126    0.4%  ░░░░░░░░░░░░

  What to cut
  • Disable or lazy-load the "github" MCP server      −20,000 tokens
    Tool schemas load at startup and are paid every session,
    including sessions that never touch that server.
  • Prune rarely-used skills                          −63 tokens
    4 skills cost 127 tokens of metadata on every request.
```

Every agent session starts with a bill you already paid: instruction files, skill metadata, and MCP tool schemas are all loaded before your first message. `ctxaudit` measures that bill, in tokens, per source — and tells you what to cut.

---

## Why this exists

I measured a real install with 1,901 skills and 22 MCP servers. The pre-flight cost was **248,662 tokens — 124% of a 200k window**. The session could not start.

That is an extreme case, but the tax is universal. Published measurements of the same problem:

| Observation | Source |
|---|---|
| A Claude Code session starts at **~35,000 tokens** before the first keystroke, while another harness starts at 7,000 | [HN discussion, P-46] |
| The GitHub MCP server alone costs **15,000–20,000 tokens** of tool schema on every request | [GitHub issue, B-11] |
| A browser toolset adds **~6,600 tokens per request**; one study found **71% of tokens** spent on tool discovery rather than work | [blog, N-06/N-22] |
| Skill **metadata** is injected into the system prompt on *every* request, even when the skill body never loads | [Anthropic docs, N-18] |
| Adding skills monotonically **lowers** pass rate — 52 → 202 skills cost **−8 → −21 points** | [study, N-02] |
| Instruction files past ~2k tokens hit **lost-in-the-middle**: the agent reads the ends and skips the middle | [HN, P-07] |
| A product layer caps a 1.05M-token model at **372K** (353.4K effective) — the spec number is not the real number | [GitHub, B-10] |

Nobody publishes the *total*. MCP gateways measure MCP. Skill managers measure skills. `ctxaudit` measures the whole pre-flight bill across every source, in one number.

---

## Install

```bash
npx ctxaudit                # no install
npm i -g ctxaudit           # or install globally
```

Requires Node.js ≥ 20. No API key, no network calls, no telemetry.

---

## Usage

```bash
ctxaudit                          # audit the current directory
ctxaudit path/to/repo             # audit somewhere else
ctxaudit --verbose                # show how each number was derived
ctxaudit --json                   # machine-readable output
ctxaudit --window small-32k       # audit against a smaller window
ctxaudit --window 128000          # or an explicit token count
ctxaudit --profile heuristic      # no tokenizer vocab needed (fast, ±20%)
ctxaudit --budget 10              # exit 2 if pre-flight exceeds 10% of the window
ctxaudit --list-windows           # show window presets
```

### Exit codes

| Code | Meaning |
|---|---|
| `0` | Audit ran, within budget |
| `1` | Audit failed (unreadable input, unknown window or profile) |
| `2` | Audit ran, pre-flight exceeded `--budget` |

`--budget` is designed for CI. A gate that fails when a pull request pushes the pre-flight cost past a threshold:

```yaml
- run: npx ctxaudit --budget 15
```

---

## What it measures

| Source | Files probed | Why it costs |
|---|---|---|
| **Instructions** | `AGENTS.md`, `CLAUDE.md`, `.cursorrules`, `GEMINI.md`, `.windsurfrules`, `.github/copilot-instructions.md` | Loaded in full on every turn |
| **Skill metadata** | `SKILL.md` frontmatter under `.agents/skills`, `.claude/skills`, `.opencode/skills`, `.cursor/skills`, `agent/skills` | `name` + `description` of *every* installed skill is injected each request |
| **MCP tool schemas** | `.mcp.json`, `opencode.json`, `.cursor/mcp.json`, `.vscode/mcp.json` | Tool schemas are loaded at startup and paid every session |
| **Settings** | `.claude/settings.json`, `.claude/settings.local.json` | Can carry injected instructions |

### Metadata vs. body — the distinction that matters

A skill's **body** loads only when the skill is actually used. Its **name and description** ride along on every single request. So the recurring cost is the metadata, not the body. `ctxaudit` reports them separately, and only the metadata counts toward the pre-flight total.

This is why "I have 400 skills but I only use 5" is not a defence: you pay for all 400 on every turn.

---

## Skill description collisions

The router picks a skill using **only its name and description**. So two skills whose descriptions overlap heavily will shadow each other — and adding a new skill can silently break an old one, without anyone editing the old skill or the router.

`ctxaudit` runs a pairwise Jaccard similarity over description word sets (no embeddings, no network, fully deterministic) and reports the worst collisions:

```
  Skill description collisions
  100.0%  deploy-to-vercel ↔ vercel-deploy
  100.0%  pdf-extract ↔ pdf-parse
   62.5%  code-review ↔ security-review
```

Each collision is a real routing decision your agent has to guess at.

---

## Tokenizer profiles

Different providers ship different BPE vocabularies. A number without provenance is a lie, so `ctxaudit` always names the profile it used.

| Profile | Vocab | Notes |
|---|---|---|
| `o200k` *(default)* | `o200k_base` | GPT-4o / o-series. Closest available proxy for modern models. |
| `cl100k` | `cl100k_base` | GPT-4 / GPT-3.5. Underestimates on newer tokenizers. |
| `heuristic` | none | `chars/4` for ASCII, `chars/1.5` for non-ASCII. Offline, no vocab load, ±20% on prose. |

If a vocab fails to load, the audit degrades to the heuristic and says so — it does not crash and does not silently return a wrong number.

---

## Accuracy and honesty

- **MCP schema costs are estimates for servers we have not measured.** Each is tagged `measured` (published figure) or `estimated` (assumed 4k tokens). The tag is printed. `--verbose` shows the basis.
- **Token counts are exact for the named vocab, approximate for the model.** A provider's real tokenizer may differ from any public vocab.
- **A missing file is a result, not an error.** `--verbose` lists what was probed and not found, so you can tell "no AGENTS.md" from "we did not look".
- **Duplicate skill installs collapse to one identity.** The same library is often present under several directories; counting each copy would triple the tax and invent collisions between a skill and itself.
- **What this does not do:** it does not predict *whether* the tax will hurt you. It measures the tax. The relationship between pre-flight cost and task success is not linear and is not something this tool claims to model.

---

## Programmatic use

```ts
import { audit, renderReport } from 'ctxaudit';

const report = await audit('.', { profile: 'o200k', window: 'claude-200k' });
console.log(report.preflightTokens, report.preflightShare);
console.log(renderReport(report, { verbose: true }));
```

Full type definitions ship with the package (`dist/index.d.ts`).

---

## Architecture

```
src/
├── cli.ts        CLI entry point, argument parsing, exit codes
├── index.ts      public API surface (everything the CLI does, programmatically)
├── audit.ts      orchestration: discovery → costing → recommendations
├── discover.ts   filesystem probes across six agent ecosystems
├── tokens.ts     tokenizer profiles (o200k / cl100k / offline heuristic)
├── skills.ts     SKILL.md frontmatter parsing + collision detection
├── mcp.ts        MCP config parsing + per-server schema cost estimation
├── windows.ts    context window presets
└── report.ts     terminal rendering
```

The data flow is a single pass with no hidden state:

```
discover(root)                    → list of files + what was missing
  ├─ instructions  → countTokens → LineItem (recurring)
  ├─ skills        → analyzeSkill → metadata tokens (recurring)
  │                              → body tokens (on-demand, excluded)
  │                 findCollisions → Collision[]
  └─ mcp configs   → estimateMcpCost → McpServerCost[] (tagged by confidence)
                                    ↓
                            AuditReport  → renderReport (terminal)
                                         → JSON (--json)
                                         → exit code (--budget)
```

Three design decisions worth naming:

1. **Metadata and body are costed separately.** A skill's description is injected on every request; its body loads only when used. Summing them would report a number the user never pays.
2. **Every MCP cost carries a confidence tag.** `measured` means a published figure; `estimated` means we assumed 4k tokens. The tag is printed, so the report never hides its own uncertainty.
3. **A missing config file is a result, not an error.** `--verbose` lists what was probed and not found, so "no AGENTS.md" is distinguishable from "we did not look".

## Development

```bash
npm install
npm run build     # tsc
npm test          # node --test, 27 tests
npm run dev       # tsc --watch
```

Try it against the included bloated example:

```bash
npm run build && node dist/cli.js examples/bloated-agent --verbose
```

The example deliberately contains two pairs of colliding skills and a 20k-token MCP server, so every feature has something to report.

---

## License

MIT

---

### Sources

Every number in this README is traceable to a source collected during research on real agentic-AI pain points (Hacker News, Reddit, arXiv, GitHub issues, and engineering blogs, 2026). Source IDs (`P-46`, `B-11`, `N-02`, …) refer to that research corpus.
