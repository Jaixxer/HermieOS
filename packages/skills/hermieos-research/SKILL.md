---
name: hermieos-research
description: Ad-hoc research on the user's behalf. Search existing objects first, then go fetch what's missing. Create new objects for what you find. Load this skill when the dispatch envelope has `event: research` or when the user asks a one-off research question in chat.
version: 1.0.0
author: HermieOS
---

# HermieOS — Research

The user asked a research question. The answer may already exist in
their HermieOS, or you may need to fetch it. Your job: find or create
the right objects, link them to what the user already has, and report
back briefly.

## What the context contains

For a `research` dispatch:
- `objective` — the user's question, in plain language
- `context.query` — the search terms, if pre-computed
- `context.related_objects` — what the scheduler found in the existing
  objects (top 5 by FTS rank, if any)

For an ad-hoc chat question, the user wrote the question directly.
Read the question. Build your own context.

## The workflow

1. **Search the user's existing objects first.** Use the FTS MCP tool
   (`mcp_hermieos_search_objects`) with a few reformulations of the
   question. The scheduler may have pre-loaded some candidates; trust
   them but verify with a fresh search.

2. **If the user already has objects that answer the question:**
   - Link them with `mcp_hermieos_link_objects` to make the relation
     explicit.
   - Write a one-line summary of what was found.
   - Do not create duplicates.

3. **If the user does not have the answer:**
   - Decide what the answer looks like as an object: a `research` for
     a summary, a `project` for a long-running investigation, a
     `discovery` for a single finding.
   - Fetch what's needed (web search, arXiv, GitHub, etc., depending
     on the question).
   - Create the object with `mcp_hermieos_create_object`.
   - Link it to the user's most relevant existing project or research.

4. **If the question is too vague to answer:**
   - Don't guess. Reply with a clarifying question. This is the one
     case where a long reply is appropriate — the user asked a
     question and needs to refine it.

## Filtering noisy results

Same principles as the subscription skill:

- Skip archived sources, forks of forks, posts with no engagement.
- Prefer one well-sourced object over five weakly-sourced ones.
- Cite what you actually used. If a finding is from a single blog
  post, say so. If it cross-confirms across multiple sources, say
  that too.

## When to notify

This is research. The user *asked*. They want to know what you found.
**This is one of the rare cases where notification is the default.**

But: don't notify *while* researching. Notify when the answer is
ready. The Feed event is the report.

## Output format

For a dispatch (background), keep it terse:

> Researched "<query>". Found: <one-line gist of what was created or
> linked>. <if nothing: "No existing object covered this. Created
> a new <type>.">.

For chat, the user can see the conversation; a fuller reply is fine.
But: still prefer to *show* the result via created/updated objects
rather than dumping prose. The user reads the Feed.
