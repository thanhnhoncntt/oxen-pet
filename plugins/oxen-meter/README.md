# oxen-meter

Prompt cache metrics for a team on Claude Code: the cache hit rate of every session, subagent and model; a warning
before a **cold resume** writes a whole context to the cache again; and an anonymized export, so a team can pool its
numbers and see where its cost and quota go. It draws no pet and no band, and runs beside
[oxen-pet](../../README.md) or alone.

## Why

The prompt cache prices input three ways against a plain input token: a **read** costs 0.1, a **write** 1.25 when the
cache lives 5 minutes, 2 when it lives an hour. Each read starts the cache's time to live over. A thread that sits
past it pays for its whole context again on its next request.

That is how a long task can eat a weekly limit: a subagent holding 400K tokens of context waits more than an hour for
a Codex audit, is resumed, and writes the 400K again. One such run took 30–35% of a weekly limit where 10–15% was
expected. oxen-meter shows those moments while they happen, warns before the ones it can see coming, and keeps the
numbers to compare across a team.

It measures the right side of the usual cost model, request by request:
cost = users × sessions × turns × requests per turn × tokens per request × price per token.

## Install

Claude Code v2.1.291 or later.

```bash
claude plugin marketplace add thanhnhoncntt/oxen-pet
claude plugin install oxen-meter@oxen-pet
```

Start a new session, or run `/reload-plugins`. The meter records from the next model request on.

## Use

| Command | What it does |
| --- | --- |
| `/meter` | Opens or closes the pane for this session (below). |
| `/meter report [days]` | Adds up your sessions of the last days, 7 by default, and prints the report. |
| `/meter export [days]` | Writes your sessions of the last days, 30 by default, anonymized, to one file in `exports/`, and prints its path. Send that file to whoever builds the team report. |

The pane:

```text
Cache         hit 94% · read 3.1M · written 160K · uncached 9.0K · output 41K
Steps         38 main · 22 subagent
Token eq.     1.0M: main 640K · subagent 390K
TTL           main 1h (default: 12 warm up to 4m) · subagent 5m (inferred: 9 warm up to 3m, 1 cold from 7m)
Cold          1 cold resume: 140K eq beyond a read
main          opus-5-5 · ctx 121K · read 4m ago · warm ~56m
Explore 3a9c  sonnet-5-5 · ctx 40K · read 4m ago · cooling ~1m
Files         saved 0m ago to /Users/you/.claude/oxen-meter/sessions
Handoffs      2 Agent · 1 Codex (1 background)
turn.step     0.09 ms mean · p95 0.21 · max 0.80 · 60 calls
```

Each live thread shows how long ago its cache was last read and how long it has left: **warm**, **cooling** (the last
fifth of its TTL) or **cold**. Resume a cooling agent soon, or let it go and spawn a fresh one later.

### The cold resume guard

Before Claude sends a message (SendMessage) that resumes an agent idle past nine tenths of its TTL, with at least
**Cold resume tokens** of context:

- **warn** (default): a toast says what resuming costs; the message goes.
- **ask**: you choose **Spawn a fresh agent** (the message is not sent, and Claude is told to start a fresh agent with
  a short handoff) or **Resume anyway**. With no one to answer (`claude -p`, CI) the message goes.
- **off**: it is only recorded.

A thread that wakes on its own past its TTL, such as a subagent whose background Codex run just finished, cannot be
stopped by a plugin. It gets a toast, once per idle spell, and the report counts it.

## Settings

Run `/plugin configure oxen-meter@oxen-pet`. Every setting has a default.

| Setting | Default | What it does |
| --- | --- | --- |
| Cold resume guard | `warn` | `off`, `warn` or `ask`, above. |
| Cold resume tokens | `50000` | How large a context must be before writing it again counts as a cold resume. |
| Main thread cache TTL | `auto` | `auto` uses the TTL the meter measured or inferred, 1h until it has samples; or `5m`, `1h`. |
| Subagent cache TTL | `auto` | The same for subagents, 5m until it has samples. |
| Your label | empty | The name your exports carry in the team report. Empty: `anonymous`. |
| Hash project names | on | The project is kept as a hash salted with a key of your own, never its name. |
| Output weight | `5` | What one output token weighs against one uncached input token in the token equivalent. |
| Keep sessions (days) | `30` | Session files older than this are emptied (below). |
| Data folder | empty | Where sessions and exports go. Empty: `oxen-meter` in your `.claude` folder. |

Settings apply after Claude Code restarts.

## Reading the numbers

- **Hit rate**: cache read over the whole context the requests carried. A low one means the same context is written
  again and again.
- **Token equivalent**: the cost in plain input tokens: uncached + writes × 1.25 (5m) or × 2 (1h) + reads × 0.1 +
  output × the output weight. It compares sessions, people and models without a price list.
- **TTL**: how long each role's cache lives, and how the meter knows. `measured`: Claude Code reported it (an Agent
  call's cache writes, split 5m/1h, or a model switch). `inferred`: from the gaps around warm and cold steps; a cold
  step after 5.5–60 minutes says 5m, a warm one after more than 5.5 minutes says 1h. `default`: no evidence yet.
  `setting`: you chose it.
- **Cold resume**: a step whose gap passed its TTL and that wrote at least the cold resume tokens again, or a session
  resumed (`claude --resume`) after its cache likely expired. "Beyond a read" is what it cost over reading the same
  context warm. Steps after a compaction, a model switch or a rewind are left out: those write the context anyway.
- **Handoffs**: work given to a subagent (Agent), to Codex, or back to an agent by a message (resume). "Back" is how
  long it took to return; "next handoff" is how long the thread took to hand off again, such as sending the fix.
- **Flags** (anti-patterns):
  - *context bloat*: a thread at 150K context or more for 20 steps without a compaction. Compact or hand off sooner.
  - *big first prefix*: a thread's first request carried 40K or more: many MCP servers, tool schemas, a large prompt.
  - *short task on an expensive model*: a subagent on Opus for five steps or fewer. Give such agents a smaller model.

**Limits.** Claude Code reports a request's cache writes as one number, not split by TTL, so a role's TTL is measured
only where an Agent call or a model switch reports it, and inferred elsewhere; the report shows the samples behind
it. The token equivalent leaves out what the price list adds on top, such as long-context pricing.

## The team report

Whoever collects the exports clones this repo and runs, with Node 22.18 or later:

```bash
node tools/meter/aggregate.mjs --out report/ path/to/exports/
```

It writes `report/team-report.md` and `team-report.json`: the team's summary; one row per person (by their label),
agent type and model; the top 20 cold resumes; each role's TTL with its samples; a row per week; the flags and
handoffs per person; the meter's own hook timing. It also adds up the Codex sessions on that machine over the same
days, from `~/.codex/sessions`, reading their token counts only (`--no-codex` to skip, `--codex <folder>` for another
folder). `--cold-tokens` and `--output-weight` set the team's thresholds.

## What it records, and what it does not

Recorded, for each model request: when it started and ended, the thread (main or the agent's id), the agent type,
model and effort, the four token counts, the context size, the gap since the thread's last request, the message
count, the names of the tools it asked for, and why it stopped. Around them: a subagent's start and stop; an Agent
call's agent, type, model, total tokens and cache split; a Codex call's sub-command (`task`, `review`, `exec`), times,
and whether it ran in the background or failed; a count of commits and pull requests; a compaction's sizes; who a
message to an agent went to, and what the guard did; a resumed session's idle time and context; reported TTLs. For the
session: its id, the project as a salted hash, its start, its cost as `/cost` totals it, the meter's version and
settings, and how long the meter's own hooks took.

Never recorded: prompts, answers, thinking, a tool's input or output, file names or paths, commands, message text,
environment variables. The meter makes no network request and starts no process.

An export goes further: each session's id is hashed, agent and turn ids become `a1`, `t1`, MCP tool names become
`mcp`, times count from the session's start (only its day is kept), and no folder appears in it.

Files live in the data folder: `sessions/<session id>.json`, written by a timer after a main turn ends and when the
session ends, and `exports/oxen-meter-export-<date>[-<label>].json`. Nothing else is written, and every write is
checked first (no `..`, no symbolic link). A plugin cannot delete a file, so a session file past **Keep sessions
(days)** is emptied to a few bytes instead. The checks are in [`SECURITY-AUDIT.md`](../../SECURITY-AUDIT.md).

To uninstall, run `claude plugin uninstall oxen-meter@oxen-pet`, then delete the data folder if you want.
