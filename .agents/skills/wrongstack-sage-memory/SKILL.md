---
name: wrongstack-sage-memory
description: "Use this project's WrongStack SAGE memory: recall decisions, conventions, past bugs and gotchas before changing code, and propose new ones. Use when starting work on a file or area, before a non-trivial change, when something looks surprising, or when you learn something future sessions should know. Not for general knowledge unrelated to this repository."
---

# WrongStack SAGE memory

SAGE is this project's long-term memory, kept by WrongStack: decisions,
conventions, past bugs, gotchas and notes anchored to files and symbols. It is
served by the `wrongstack-sage` MCP server while WrongStack is open in
this project. When WrongStack is closed the tools report that no daemon is
running; tell the user and continue without memory.

## When to recall

- **Before editing a file**: `memory_for_file` with the file path (add
  `lineStart`/`lineEnd` for a specific region). Returns memories anchored to
  that file, to symbols in it, and ones that mention it.
- **Before a non-trivial change, or when behaviour surprises you**:
  `memory_search` with two to five precise terms (identifiers, error text,
  subsystem names). Short, specific queries work better than sentences.
- **For a directory or area**: `memory_for_path`.
- **To follow a thread**: `memory_graph` from a memory id, path or symbol.

Search is lexical (terms, tags, paths, anchors); it does not match synonyms, so
try the exact identifiers you see in the code.

## How to treat results

Memories are claims written in the past. Check them against the current code
before acting on them; if one is wrong or stale, say so and propose a
correction. A memory marked as a directive records a rule the user set for this
project; follow it unless the user says otherwise now.

## When to propose

When you learn something a future session would otherwise rediscover the hard
way (a non-obvious root cause, a constraint, a convention the code does not make
obvious, a user decision), call `memory_candidates` with:

- `action: "propose"`
- `text`: one self-contained fact, including the why
- optional `kind`, `tags`, `importance`, `reason`

A proposal is reviewed in WrongStack before it becomes memory. Do not propose
what the code, git history or README already states, and do not propose
transient task state.

<!-- Managed by `wstack sage connect`; `wstack sage disconnect` removes it. -->
