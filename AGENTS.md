# Working vocabulary and principles

## Vocabulary

- **Landmine** — a decision that costs nothing now and blows up later. By the
  time it detonates, it is load-bearing. Examples include an unmeasured limit
  or a silent catch.
- **Receipt** — the measurement behind a number. No receipt, no number.
- **Tripwire** — a limit placed past where any good widget goes, so only broken
  things touch it. Good widgets never feel that it exists.
- **Simple** — how cleanly the logic breaks down. Each step follows from the
  last, with no step doing two jobs.
- **Obvious** — the next reader never asks, “Why is this here?” Obviousness is
  measured by the reader. Obvious is not always simple; sometimes the obvious
  solution has more parts.

## Boil the ocean

When planning, do not be afraid to suggest seemingly insane solutions. We are
effectively rethinking and rebuilding what it means to make a desk-widget
platform. It needs to be cross-platform while having an amazing developer
experience. The syntax should resemble TSX/JSX so developers and agents who are
familiar with the web can transition easily. Efficiency should be extremely
high, with memory and CPU usage as low as possible, without trading away that
developer experience.

## Every number needs a receipt

A limit without a measurement is a landmine. Before writing any number—such as
`max_nodes`, a byte cap, or a timeout—measure the real thing, then size the
limit as a tripwire. Capacity is free until touched: reserve generously, commit
lazily, and never zero an arena eagerly. If a good widget hits a budget, the
budget is wrong. Remeasure and update the receipt.

Record this repository's reproducible measurements in
`docs/CAPACITY_RECEIPTS.md` beside the command that produced them.

## A limit developers can hit is a limit they must see

Developers will not read our code; their agents read our errors. An agent can
fix `max_nodes=128, asked for 129`. It cannot fix a blank window. Every budget
failure must name the budget, the limit, and the requested amount: at the
weaver check when knowable there, and loudly at runtime otherwise. A silent
budget is worse than no budget.

## Fight for the obvious solution

Measure twice, cut once. Understand the problem fully before building, because
cleverness is what gets written when we have not. The biggest simplicity win
is refusing to solve problems we do not have. Good code is the simplest thing
that delivers full functionality and performance, with nothing traded away and
nothing bolted on. Push back when there is a more obvious solution.

## Build for the long term

- Make architectural decisions for the long term. Do not accept a stopgap that
  works only for now and is meant to be replaced later.
- Grow the system in layers. Start from the smallest version that works end to
  end, then add each capability on top of a product that already works. Never
  trade a working product for unfinished complexity.
