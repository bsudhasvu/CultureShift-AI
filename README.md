# CultureShift AI

## Constraint-Aware Cultural Adaptation Using Qloo

CultureShift AI is a Qloo-powered cultural decision agent that helps adapt an experience toward a new audience while protecting cultural elements that must not be changed.

The core principle is simple:

> Reach a new audience with the minimum cultural change while preserving explicitly protected identity.

## The Problem

Cultural adaptation can easily become over-adaptation.

A system may find something that is highly appealing to a target audience, but that solution may remove or alter the cultural characteristics that the creator wants to preserve.

CultureShift treats those protected characteristics as hard constraints rather than soft preferences.

## How CultureShift Works

The decision pipeline is:

1. Define the target audience.
2. Define the cultural attributes that must be preserved.
3. Use Qloo to test candidate compatibility with each protected constraint.
4. Intersect the feasible candidate sets.
5. Select the lowest feasible intervention scope.
6. Send only the surviving minimum-scope candidates to Qloo for audience-affinity ranking.
7. Return the highest-ranked feasible cultural bridge.

The important design principle is:

**constraints first, ranking second.**

This prevents a higher audience-affinity result from overriding a protected cultural requirement.

## Intervention Scope

CultureShift uses four intervention levels:

| Scope | Meaning |
|---|---|
| 0 | No change |
| 1 | Discovery and framing |
| 2 | Accompaniment and context |
| 3 | Core modification |

Lower intervention scope is always preferred when feasible.

Qloo is used to rank candidates only after the protected constraints have been applied and the minimum feasible scope has been selected.

## Live Demonstration

The deployed demonstration uses:

- Target audience: BTS
- Protected cultural attribute: Indian classical music
- Protected instrument: Sitar

The executed production result found:

- Anoushka Shankar
- Ravi Shankar

as candidates satisfying both protected constraints.

A.R. Rahman was filtered from the final constrained ranking because it did not satisfy the complete protected constraint set.

Among the surviving candidates, Qloo ranked:

1. Anoushka Shankar - affinity 0.7199
2. Ravi Shankar - affinity 0.7067

The live decision therefore selected:

**Anoushka Shankar**

with:

**Scope 2 - Accompaniment and context**

## Why the Ordering Matters

CultureShift does not simply ask Qloo:

> "What will this audience like most?"

Instead, it asks:

> "Which options satisfy the cultural requirements, and among the least invasive feasible options, which does the target audience prefer?"

This makes cultural preservation a hard decision constraint rather than a post-processing preference.

## Architecture

```text
User
  |
  v
CultureShift Web UI
  |
  v
Cloudflare Worker
  |
  +---- Protected constraint evaluation
  |          |
  |          v
  |        Qloo
  |
  +---- Minimum intervention selection
  |
  +---- Final candidate ranking
             |
             v
           Qloo
             |
             v
      Explainable decision

