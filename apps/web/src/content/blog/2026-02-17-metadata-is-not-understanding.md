---
title: "Why Metadata Is Not Understanding: The Case for Knowledge Graph Version Control"
date: "2026-02-17"
author: "John Schmotzer"
excerpt: "Entire just raised $60M to bolt metadata onto Git. Here's why that's the wrong architecture - and what we're building instead."
slug: "metadata-is-not-understanding"
---

# Why Metadata Is Not Understanding: The Case for Knowledge Graph Version Control

*John Schmotzer - February 17, 2026*

---

Last week, Thomas Dohmke - former CEO of GitHub - raised $60 million for Entire, a startup building what he calls "a new developer platform for the AI coding era." His thesis is one I agree with completely: Git was never designed for a world where machines are the primary producers of code. The traditional workflow of issues, repositories, pull requests, and deployments is cracking under the weight of AI-generated code at scale.

Where I disagree is on what comes next.

Entire's first product, Checkpoints, captures the prompts and transcripts that produced a given commit and links them to the Git SHA. It's a metadata layer bolted onto Git - a log of what the AI said while it was working.

At Control Vector, we've been building something architecturally different: CV-Git, a version control system built on knowledge graphs that captures not just what the AI did, but *why the code exists* - the semantic relationships, causal chains, and design decisions that give a codebase its meaning.

This isn't a funding announcement. This is a technical argument. I want to explain why the distinction between metadata and understanding matters, and why it will determine which tools survive the AI coding era.

## The Problem We Agree On

Dohmke is right about the problem. When multiple AI agents are producing code at scale, traditional Git becomes insufficient. A diff tells you what changed. A commit message tells you what the author *claims* changed. Neither tells you:

- Why this design decision was made instead of an alternative
- What other code depends on the reasoning behind this change
- What would break if this decision were reversed
- How three agents coordinated (or failed to coordinate) their changes

This is the context crisis. I wrote about it formally in the Context Manifold paper (arXiv, January 2026), which presents a mathematical framework for modeling code context as a navigable topological space rather than a flat sequence of tokens. The core insight is that software repositories contain explicit structural relationships - function calls, type references, dependency chains - that are invisible to both traditional Git and vector similarity search.

Entire and Control Vector both see this problem. The question is whether you solve it by logging more text or by building a new representation.

## Entire's Architecture: Metadata on Git

Based on what Entire has published, their approach has three planned components:

1. **A Git-compatible database** to unify AI-produced code
2. **A "universal semantic reasoning layer"** for multi-agent coordination
3. **An AI-native user interface** for agent-human collaboration

Today, they've shipped component zero: Checkpoints, a CLI tool that pairs commits with the prompts and transcripts that produced them. Components two and three are on the roadmap but unshipped and, as far as I can tell, undefined beyond marketing language.

Checkpoints solves a real problem - prompt context is ephemeral and losing it makes AI-generated code harder to review. But the approach has a fundamental architectural limitation: **prompt logs are unstructured text**. They capture the conversation that produced code, but not the semantic structure of the decisions made.

This matters when you try to answer real engineering questions at scale.

## CV-Git's Architecture: Knowledge Graphs as the Representation Layer

CV-Git takes a different approach entirely. Instead of bolting context onto Git commits, we model the codebase as a knowledge graph - a typed, traversable structure where nodes represent code entities (functions, classes, modules, tests, commits) and edges represent typed relationships (calls, imports, inherits, tests, depends_on, authored_by).

In the Context Manifold framework, this graph is one half of a dual representation. The other half is a vector embedding space that captures semantic similarity. Together, they form what we call a Context Manifold - a topological space that is locally Euclidean (supporting vector similarity operations) but globally non-linear (capturing the complex structural relationships that define how software actually works).

The mathematical formulation defines a query-adaptive geodesic:

> Γ_q(n, m) = α_q · d̂_G(n, m) + (1 − α_q) · d̂_V(n, m)

where d̂_G and d̂_V are normalized graph and vector distances, and α_q adapts based on the query's structural requirements. Simple "find similar code" queries weight toward vector distance. Complex "trace this decision through the system" queries weight toward graph traversal.

Critically, the system doesn't just retrieve context - it *navigates* it. Using recursive manifold navigation (inspired by recent work on Recursive Language Models), the LLM decomposes complex queries into sub-queries, traverses the graph iteratively, and aggregates results. This enables reasoning about codebases of arbitrary size without stuffing everything into a context window.

## The Five Queries Entire Can't Answer

Architecture arguments are abstract. Concrete queries are not. Here are five questions that are routine on a knowledge graph and impossible on prompt logs:

### 1. Impact Analysis

**"What breaks if I reverse the decision to switch from session tokens to JWTs?"**

CV-Git traces the causal chain: the decision node connects to every implementation node it influenced, which connects to every test node that validates those implementations. You get a precise blast radius.

Entire gives you a text search across prompt logs for the word "JWT." You'll find the conversation where the decision was made, but you won't find all the downstream code that was shaped by it - especially code written by other agents in other sessions whose prompt logs never mention "JWT" because they were just told to "update the auth middleware."

### 2. Multi-Agent Conflict Detection

**"Did Agent A's refactor of the payment service conflict with Agent B's changes to the order pipeline?"**

CV-Git's graph knows that Agent A modified `processPayment()`, which is called by `submitOrder()`, which Agent B also modified. The structural dependency is explicit in the graph. You can detect the conflict *before* it manifests as a runtime bug.

Entire sees two separate prompt logs and two separate commits. The connection between them exists only in the call graph of the actual code - which Entire doesn't model.

### 3. Design Decision Archaeology

**"What design patterns does this codebase use, and where did each one originate?"**

CV-Git's knowledge graph encodes architectural patterns as first-class relationships. The graph knows that `UserRepository`, `OrderRepository`, and `PaymentRepository` all implement the Repository pattern, and can trace when and why that pattern was introduced.

Entire would require searching every prompt log for mentions of "repository pattern" - assuming the agents used that term, which they may not have.

### 4. Safety Boundary Detection

**"Show me every path from user input to database query that doesn't pass through validation."**

This is a graph traversal problem. CV-Git walks the call graph from input handlers to database accessors and flags paths that bypass validation nodes. This is the kind of query that CV-Safe - our safety architecture analysis tool - performs natively on the knowledge graph.

Entire has no mechanism for this. Prompt logs don't encode call graphs.

### 5. Causal Tracing Under Failure

**"A bug appeared in production after last Tuesday's deployment. Trace the causal chain from the root design decision to the failure point."**

CV-Git traverses backward from the failure point through the graph: which function failed, what calls it, what design decisions shaped those callers, what agent sessions made those decisions, and what constraints they were operating under. The full causal chain is a graph path.

Entire can show you the prompt logs from Tuesday's sessions. The causal chain between them - the structural reason *why* one decision led to a failure three layers of abstraction away - isn't captured because it exists in the relationships between code entities, not in the text of AI conversations.

## The Historical Pattern

This is not a new dynamic in technology. Every paradigm shift follows the same arc: first, we bolt adapters onto the old system. Then someone builds the native architecture, and the adapters become legacy.

Relational databases didn't win by adding query languages to flat files. Git didn't win by adding branching to SVN. Kubernetes didn't win by orchestrating VMs. In each case, the native architecture - the one designed from the ground up for the new paradigm - eventually displaced the adapter.

Entire is building a metadata adapter for Git. It's a useful adapter, and it will help some teams in the short term. But the AI coding era doesn't need better Git logging. It needs a new representation layer that understands code the way knowledge graphs understand relationships - structurally, traversably, and causally.

## Where Each Approach Wins

I want to be honest about the tradeoffs, because architecture decisions are always about tradeoffs.

**Entire wins when:**
- Your primary concern is prompt auditability - knowing what conversation produced a given commit
- Your team's AI usage is mostly single-agent, single-session
- You need something that drops into an existing Git workflow with zero friction
- Your codebase is small enough that structural relationships are obvious from reading the code

**CV-Git wins when:**
- You need to reason about *why* code exists, not just what conversation produced it
- Multiple agents are modifying interdependent systems
- Safety, auditability, or regulatory compliance requires causal traceability
- Your codebase is large enough that no human (or AI) can hold the full structure in memory
- You're operating in environments where "search the prompt logs" isn't a sufficient answer

For regulated industries - defense, automotive, aerospace, medical devices - the distinction isn't academic. When you need to demonstrate that an AI-generated control system was produced through a traceable chain of verified design decisions, prompt logs don't satisfy the requirement. Knowledge graphs with typed causal edges do.

## The Empirical Evidence

In the Context Manifold paper, we evaluated hybrid graph-vector retrieval across 70 real-world Python repositories with 44,488 function-level queries. The results showed strong heterogeneity by codebase structure:

- **High-coupling systems** (edge density > 3.0): +4.1% improvement in dependency coverage with graph-augmented retrieval
- **Utility libraries** (edge density < 1.5): -5.2%, meaning vector-only retrieval is optimal for simple, loosely-coupled code

This is the honest result: knowledge graph retrieval isn't universally better. It's better *when the code has structural complexity worth modeling*. For a collection of utility functions with no interdependencies, a vector database is sufficient.

But the codebases that matter most - the ones with hundreds of interacting services, complex dependency chains, and safety-critical requirements - are exactly the ones where structural representation provides the greatest advantage. And with recursive navigation, projected improvements on complex multi-hop queries exceed 400% over static retrieval.

The adaptive routing built into CV-Git handles this automatically: simple queries use vector search, complex queries use graph traversal, and the system learns which strategy fits each query and codebase.

## What Comes Next

Entire just raised $60 million to prove that this market exists. I'm grateful for the validation. The AI code management problem is real, it's urgent, and it's now priced at $300 million by serious investors.

The question for the industry is whether we solve it by logging more text alongside our commits, or by building the representation layer that actually captures how software works.

We're building the latter. CV-Git is open, the Context Manifold paper is public, and we're actively working with design partners in defense, automotive, and enterprise software to validate the architecture on production codebases.

If you're running multi-agent AI coding workflows and hitting the limits of "search the prompt logs," I'd like to talk.

**John Schmotzer**
*Founder & CEO, Control Vector LLC*
*schmotz@controlvector.io*

---

*The Context Manifold paper is available at [controlvector.io/research]. CV-Git is at [github.com/controlVector/cv-git].*
