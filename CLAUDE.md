# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Dice Wars played on a sphere: a procedurally generated planet of hexagonal
territories, rendered with three.js.

## Commands

```bash
npm test                                   # every test in every package
npm run dev                                # vite dev server (--host, so a phone on the LAN can reach it)
npm run lint                               # the conventions lint on its own
npm run build                              # lint, site -> dist/, the deployability guard, then the previews

node --test packages/planets/test/settings.test.js       # one file
node --test --test-name-pattern "banked dice" packages/planets/test/*.test.js   # one test

# how strong an AI is, and what it costs to be that strong (minutes, not seconds)
node packages/planets/scripts/arena.js duel --b expert:follow=0
node packages/planets/scripts/arena.js timing --players 2
```

The user usually already has a dev server running — on 5173 or another
port — so check for one before starting your own. When previewing or
verifying a change in a browser, point it at whichever port is already live
rather than launching a second `npm run dev`.

There is no linter and no build step for tests — they are plain
`node --test` ESM files with no framework, no transpiler, and no mocking
library. `npm test` globs `packages/*/test/*.test.js`, so a new test file is
picked up by existing there.

## Layout

An npm workspace with two packages:

- **`packages/core`** (`@dicewars/core`) — the rules. Pure, dependency-free,
  and knows nothing about planets, three.js, or the DOM. Its whole surface is
  `src/index.js`.
- **`packages/planets`** (`@dicewars/planets`) — the world, the renderer and
  the interface. Depends on core and three.js.

Core does not know about planets; planets is a consumer of core. Keep it that
way — a second board shape (the classic flat map) should be able to sit
alongside `packages/planets` without core changing.

## Core: the rules

State is a plain object, actions are plain objects, and `reduce(state, action,
deps)` returns `{ state, events }` without mutating anything. Both sources of
chance arrive through `deps`, so a test or a replay can pin either:
`deps.rollDie` for the dice a battle is fought with, `deps.rng` for where
end-of-turn reinforcements land. Reinforcements scatter deliberately — placing
them in board order piles every die onto the same few territories, game after
game.

The graph is topology only — which node ids touch which. No coordinates, no
shape. `setNeighbors`/`updateAdjacency` exist so a world can rewire itself
between rounds (the planned moon mode) without core learning any geometry.

`serializeState`/`reviveState` are the state as plain JSON and back, which is
what a saved game is made of. They read the edges out of the *graph* rather
than out of whatever world description built it, because a board that has been
rewired mid-game has to be saved as it stands. `seededRng` lives here too: both
sources of chance already arrive through `deps`, and a generator that repeats
is what makes that worth anything — a test pins a game, a save pins a world.

Terms that recur:

- **node / territory** — one playable area, holding an owner and 1–8 dice.
- **reserve** — end-of-turn reinforcements with nowhere to land because the
  player's territories were full. Banked (capped at `MAX_RESERVE`), paid out
  later. The UI calls these "banked dice".
- **largest connected region** — what reinforcement is paid on.

`attack` events carry every individual die face (`attackRolls` / `defendRolls`)
as well as the totals, because the renderer lands the dice on their actual
values. `ATTACK` also emits `eliminated` when it takes a player's last
territory.

`src/ai/` holds the opponents. One interface throughout — a **strategy** is
`(state, playerId) -> { from, to } | null`, called again after every attack and
returning null to end the turn — because that is the shape the classic
dicewars-js AIs were written in, and `wrapLegacyAi` has to bridge to it anyway.
Three are shipped, weakest first:

- `createSimpleStrategy` — takes the biggest dice advantage on offer.
- `createDefensiveStrategy` — the classic `ai_defensive`, translated. Attacks
  only where it expects to keep what it wins.
- `createExpertStrategy` — prices every attack as an expected change in the
  value of the position, looks one move past the best few, and takes the best
  while any is worth making. It wins 80% of games against the simple one and
  69% against the defensive one, six-handed. Costs about 0.5ms for the median
  AI turn on a default planet, against 0.05ms for the simple one.

The `difficulty` setting picks three rungs off those, and `strategyFor` in
`settings.js` is the whole of the mapping: Normal is `createSimpleStrategy`,
Expert is `createExpertStrategy`, and **Hard is the expert with `income` at
zero** (`HARD_WEIGHTS`).

**`hard` changed meaning when Expert was added above it**, and there is no save
migration — a match saved as Hard before that resumes against the weaker of the
two. That is a deliberate call rather than an oversight: the alternative was a
version bump on every save to correct an opponent nobody had complained about,
and `readSavedGame` already normalizes by membership, so an old `hard` lands on
a real rung rather than nowhere. What still holds is the invariant that
matters — a save carries its settings, so nothing changes difficulty *while*
it is being played.

The middle rung exists because the gap it fills was the real one. Normal to
Expert is 79.7% — nearly four to one in odds — while every variant of the
expert sits within a point or three of every other, so a tier carved off the
*top* would have been one nobody could tell from the one below it. There is no
headroom up there either: unpruning the second ply entirely (`breadth` 8,
`decided` 3, no `dominance` cutoff) measures 51.2% ±1.6 against the shipped
budgets, which is not significant, for 47% more CPU and a two-handed worst turn
of 17.8ms against 7. A genuinely stronger opponent needs new judgement, not
more search.

**It is one weight rather than a third strategy**, so the rungs stay ordered
when either is touched: Hard is Expert with the *first* thing that separates
the expert from everything else taken away. It still knows the real odds, still
prices the counter-attack, still spends a doomed stack — it just does not know
that reinforcement is paid on the largest connected region, so it wins ground
that never pays for itself.

One consequence to know before writing a test for it: **`sprawl` partly covers
for the missing term**, since it reads `board.income` — the region size on the
board — rather than the weight. So Hard still avoids growing a detached outpost
and will still take a join for that reason, which means a board that separates
Expert from Normal does not necessarily separate it from Hard. The test that
does gives every candidate a capture out of the largest region, so `sprawl`
cannot break the tie and only income is left to.

`risk: 0` was the other candidate and is the instructive rejection, because
head-to-head it looks *better*: it beats Normal 66.5% six-handed where
`income: 0` manages 69.1%, and both look like a rung. Measured against the
strongest opponent instead, they are nothing alike:

| players | Normal | `risk: 0` | **`income: 0`** |
|---------|--------|-----------|-----------------|
| 2       | 31.9%  | 34.0%     | **39.4%**       |
| 4       | 23.5%  | 31.3%     | **39.3%**       |
| 6       | 20.3%  | 22.8%     | **41.6%**       |
| 8       | 19.0%  | 19.5%     | **41.2%**       |

(win rate against Expert, 2,400 games a cell.) A middle rung has to be between
its neighbours *and stay there across the table size*. `risk: 0` collapses onto
Normal from the strong side at six and eight players — 22.8% against 20.3% — so
it is not a middle rung at all, it is Normal with a different personality.
`income: 0` holds about 40% at every table size, a 2.3-point spread against
`risk: 0`'s 14.5, while beating Normal everywhere (53.9 / 62.6 / 69.1 / 69.2).
It is also the cheapest of the three: a median AI turn of 0.10ms against
Expert's 0.31 and `risk: 0`'s 0.67, which attacks far more per turn for having
stopped caring what a fight costs.

Two things were tried and rejected inside the choice. Half weight (`income: 1`)
is not a rung — 48.8% ±1.8 against Expert, statistically the same opponent. And
Hard keeps `sprawl`: turning it off made it *weaker* against Normal with no
change against Expert.

The defensive one is not offered. It is the translated legacy AI, kept because
it is a second opinion to measure against, and because **which of the two weak
AIs is stronger depends on how many are sitting at the table.** Two-handed it
wins under a third of its games against Normal; eight-handed it wins more than
half. Same two AIs, same planet generator:

| players | defensive vs simple | (as first measured) |
|---------|---------------------|---------------------|
| 2       | 30.6% ±1.0          | 36.5% ±3.0          |
| 6       | 52.9% ±0.9          | 45.2% ±3.1          |
| 8       | 55.4% ±1.1          | 53.3% ±3.1          |

The right-hand column is what this said until it was re-measured, and it is
kept because the gap is a warning rather than a curiosity. The shape held — the
curve climbs with the table, steeply — but the *level* moved by eight points at
six players, enough to cross over: the defensive AI is no longer the weaker of
the two there, which is what the original text claimed and used to justify not
offering it. Two things landed in between, both of which change the board
rather than either AI: the seating correction, and the terrain rework that took
mean territory adjacency from 4.79 to 4.48 and traded land borders for
chokepoints. Refusing fights you cannot hold is worth more on a board with more
chokepoints, so the second is the likely mover, but that has not been isolated.
The lesson to take is that **an AI-versus-AI number is a measurement of the
generator as much as of the AIs**, and does not survive a change to the
generator. The left-hand column is 12,060 games at six players and about 8,000
at each of the others, over independent seed blocks.

It is still not offered, but the reason is now taste rather than strength: it is
a legacy translation kept as a yardstick, and a difficulty ladder wants rungs
that are reliably ordered at every table size, which these two are not.

That flip is the most interesting thing either of the weak AIs does, because
neither of them knows how many players there are — so nothing about *them*
changed between those rows, and what moved is which habit the board rewards.
It points at a gap all three share: none of them has any notion of *when in the
game it is*. Early, the board is a
scramble for room and refusing fights is expensive; late, it is a few big
stacks and position, and it is not. The defensive AI is playing a late-game
habit throughout, which costs it on the open boards of a small table and pays
on the crowded ones of a large one. The expert has one set of weights for the
whole match too. A strategy that told the two phases apart is the obvious thing
none of this has tried, and is worth more than another ply of search.

`surrender.js` is neither a strategy nor a rule. `surrenderedPlayerIds(state)` is
everyone left with no way back into the game: behind on **both** total dice —
the army they have — and largest connected region — the income they are going
to get, since reinforcement is paid on it — by `SURRENDER_TUNING`'s factor of
four. Neither measure works alone. Region on its own is wrong often enough to
call one game in three for the wrong player, because a third of the planet in
four disconnected clumps looks feeble and is not. Dice on its own is fooled by
a board no AI plays but a person might: stacks piled eight deep on a handful
of territories, a huge army earning almost nothing.

What makes it safe to end a game on is that **the leader can never be in the
set** — `dice * ratio <= dice` is false at any ratio above one for anybody
still holding a die — so a field where every opponent has surrendered is one
where the player left standing leads both the army and the income. That part
is construction, not measurement.

The ratio itself was measured: 700 seeded games across 2 to 8 players and both
difficulties, each replayed once per seat to ask whether that seat would have
been handed a match it was not going to win. Quote that rate per **firing**
rather than per seat — the seats it never speaks up for are not evidence of
anything.

The thing to know before touching the number is that **tightening it does not
stop the game being called, only delays it**. A sixth fires on 694 seats and a
quarter on 695, all but identical; what changes is when.

| ratio | wrong | fires at | earliest | saves | board held | opponents left |
|-------|-------|----------|----------|-------|------------|----------------|
| 1/4   | 1     | 73%      | 17%      | 71s   | 79%        | 2              |
| 1/5   | 0     | 79%      | 32%      | 51s   | 83%        | 2              |
| 1/6   | 0     | 84%      | 32%      | 42s   | 86%        | 1              |

Both misfires found at a quarter share a shape — they fire while the field is
still full, on a player who is wide rather than deep — and neither fires at a
sixth. `preview/surrender.html` stands on one of them and is the record of why
the number is what it is. A further guard on how many players are left was
considered and not taken: at a sixth there is nothing left for it to catch,
and "Play on" covers what measurement cannot.

`battleOdds.js` is shared ground: the exact chance an attack of *a* dice beats
a defence of *d*, as whole numbers of ways divided once at the end, so a battle
that cannot be lost is exactly 1. Dice difference is a poor stand-in for it —
"one die up" runs from 84% down to 67% across the range.

Four things about the expert are worth knowing before touching it.

Its `EXPERT_WEIGHTS` were found by playing rather than derived, and they pull
against each other hard: `denial` at 0 was harmless until `relief` moved and
then cost thirty points, so a retune wants re-measuring against the whole set
rather than one weight at a time.

What made the difference between "loses to the defensive AI" and "beats it
three to one" was not the search — it was two structural terms. It counts what
a capture does to the *opponent's* largest region, not only its own; and it
judges what its territories can survive against the dice they will have *after*
end-of-turn reinforcement, which is the term that stops it sprawling into
ground too thin to hold.

And the second ply is narrow on purpose. A turn is a run of attacks, so each of
the best `breadth` moves is played out — the winning branch only — and credited
with what the board it lands on is worth, discounted by `follow`. It exists for
the two things one ply cannot see at all, both of which are about a *sequence*
rather than a fight: a join two territories away, which scores enormously for
its second half and nothing at all for its first; and a stack about to be
walled in behind its own lines. (The second turned out to be mostly handled
already — the one-ply term for how exposed an emptied attacker is left happens
to fire on exactly the same geometry, and picks the right attacker about 77% of
the time in that shape without ever knowing why.)

Measured with `scripts/arena.js` against the same AI with `follow` at 0, which
is exactly the AI that shipped before the second ply — half the seats each,
alternating, every game played twice with the camps swapped over the same
planet and the same dice — it wins **54.1% of 4,432 six-player games**. The
edge grows with the table and vanishes without one: 50.6% two-handed (3,200
games), 52.0% four-handed, about 56% eight-handed. That is the shape to expect
from it. A crowded board is where the close calls and the two-step joins are;
a duel has neither, and there it is a wash rather than a loss.

**Those numbers predate `sprawl`, and it took most of them.** Re-measured with
the term in, the second ply is worth 51.0% ±0.9 of 12,000 six-player games and
51.4% ±1.3 of 6,000 eight-player ones — still real, and about a third of what
it was. The overlap is not a coincidence: half of what the lookahead existed to
see was ground worth taking only for what it joined up, and `sprawl` reaches
the same conclusion one ply earlier and for a different reason. What is left is
a point of strength for 60% more CPU a turn (0.98ms against 0.61ms), which is
still a trade worth having on a budget that peaks at 10ms — but it is now close
enough to the line that it is the first thing to reconsider if the frame ever
needs the room.

And it will not grow ground that earns nothing. Reinforcement is paid on the
largest connected region but *scattered over every territory owned*, so a
capture that leaves an outpost still detached wins land that pays nothing and
then soaks `income / held` dice a turn away from the land that does. `sprawl`
charges exactly that, and only ever fires on a capture launched out of a
detached region: an attack from the largest region is by definition adjacent to
it, so it always grows it by at least one, and — the part that matters — a
capture that *rejoins* an outpost scores its whole region and is never charged.
Without that last exemption the AI could be walled off from its own ground for
good.

It is worth more than it looks. Only about 4.6% of its attacks were candidates
— by round 10 the expert already keeps 97% of its holdings on its main region —
but against the same AI with `sprawl` at 0 it wins **55.6% of 8,010 six-player
games**, 54.5% four-handed (6,000) and 53.7% eight-handed (6,000). It costs
nothing on the clock — the tail is slightly *cheaper*, because a refused move is
a move not looked at twice.

**Self-play alone would not be evidence**, since an AI can be tuned into
beating a copy of itself without playing any better. So it is measured against
the two opponents it did not come from as well, 2,400 games a cell:

| players | vs simple | vs defensive | vs itself |
|---------|-----------|--------------|-----------|
| 2       | 68.2 → 68.1 | 75.5 → 75.6 | 51.1      |
| 4       | 72.3 → **76.5** | 67.3 → **72.2** | 54.5 |
| 6       | 74.9 → **78.7** | 63.1 → **69.8** | 55.6 |
| 8       | 75.5 → **81.0** | 60.6 → **63.8** | 53.7 |

Three independent opponents, the same sign and very nearly the same shape:
nothing at all in a duel, and worth four to six points from four players up.
That the *duel* column is flat across all three is what makes the two-player
result a finding rather than noise — there are simply few detached outposts on
a board split between two players, so there is nothing for the term to be right
about.

The control is what makes the mechanism believable, because "refuse some
attacks" is the obvious confound. Blanket caution is strictly bad: `minGain` at
0.5 is a wash, at 1 it wins 40.6%, at 2 it wins 20.2%, and at 4 it does not win
a single game in two thousand. The gain is in *which* attacks are refused, not
how many.

**2 is not the strongest setting, it is the strongest one that harms nothing.**
The curve plateaus from about 4 upwards and never comes back down — 4, 8, 16
and even 1000 all measure the same 57.5–58% six-handed, and 4 beats 2 head to
head at 52.1% ±1.6 — because past that point the term simply refuses every
detached capture and the whole effect is binary. But a duel is the one table
where that is a real cost: `sprawl` at 4 measured **48.6% ±1.1 of 8,010
two-player games**, a small but genuine loss, where 2 measured 51.1%. Two-handed
the board is two masses rather than a scatter, so there are few detached
outposts to be disciplined about and the refusals land on the only fights going.
Keeping the bound under `elimination` (12) is the same argument from the other
end: the penalty can never exceed `sprawl` itself, since `income <= held`, so a
last-territory capture out of an outpost still goes through.

Three budgets keep the cost of that off the frame, and none of them costs
anything measurable in strength — `decided` at 1 measured 53.3% against 53.3%
unpruned, and `dominance` at 2.5 measured 53.9%. They matter because the cost
lands in one block: `planAiTurnMoves` works a whole AI turn out before any of
it is shown, so the slowest turn in a match is a frame either dropped or not.
Unpruned, a six-player match peaked at 20ms; pruned it peaks at about 10ms,
against 4ms for the one-ply AI, with the median at half a millisecond and the
99th percentile at five. Two-handed is the worst case for all of them and peaks
at about 11ms, against 9ms one ply.

Anyone tempted to tidy the defensive one: its counter-attack test compares the
strongest rival to the attacker's dice, though a winner garrisons the prize
with `dice - 1`. That off-by-one is load-bearing. Closing it takes the AI from
winning 23 games in 100 to winning 1 — at this scale a single die is most of
the margin, so it refuses nearly every fight, and reinforcement being paid on
the largest connected region makes refusing to grow a slow way to lose. The
module says so too, next to the line.

## Planets: generation, game, render

**`src/geometry/`** builds a Goldberg polyhedron: subdivide an icosahedron,
take the dual, and every original vertex becomes a pentagon while every
subdivision vertex becomes a hexagon. `vec3.js` is deliberately plain objects
rather than three.js `Vector3`, so world generation stays testable under plain
`node --test`.

**`src/world/`** generates a planet: carve ocean out of the full sphere first
(leaving a connected land mass), group only the land into territories (so the
territory graph is connected for free), then rotate the whole thing so the
strongest ring of territories runs along the equator. `generateWorld.js`
returns exactly what `createInitialState` needs plus the extra geometry a
renderer wants.

`oceans.js` decides where the water goes, and the thing it is really deciding
is whether the planet is **worth looking at**. A planet is boring when the
water is one cap on one side and the land is the cap opposite: a couple of
peninsulas, nothing to sail round, every player looking at the same continent
from a different edge of it. What is worth having is water that *wraps* — a
ring of land with ocean over both poles, or the near miss of that, where the
land almost closes the loop and one narrow strait keeps the ocean a single
body. Those two are the same planet either side of one strait closing, which
is why nothing here counts ocean bodies.

`landClustering` is how that is measured: the mean resultant length of the
land cells' directions. Cells are near enough equal area that counting them is
weighting them, so it is the length of the average land direction — a cap
covering fraction `f` of the sphere reads exactly `1 - f`, so at the 40% water
the game ships with, **0.40 is as cap-like as a planet can physically get and
0 is a ring**. One number over the whole planet, no thresholds inside it, and
it agrees with the eye across the range rather than at the ends.

Measured with it, **61.8% of the planets the old carver dealt were boring**
and half were flatly cap-like. The cause was the seeding: ocean seeds were
placed uniformly at random, and at 40% water every basin is angularly
enormous, so two seeds an ordinary distance apart merge into one lobe long
before either finishes growing. A quarter of planets were dealt a single basin
outright, which is a cap by construction.

**The fix is placement, and it is not where it looks.** Adding basins does
help — four uniform ones score 0.217 median against one basin's 0.345 — so the
tempting change is to raise the count and stop. Two basins *placed apart*
score 0.174. Count buys blobs; placement buys the ones that end up opposite
each other. `seedCandidates` is best-candidate sampling at best-of-8,
deliberately not an exact antipode, so basins are reliably opposed without
every planet arriving on the same axis.

On top of that sits a guard rather than a shaper. A carve scoring over
`maxClustering` is thrown away and retried, up to `attempts`; spread seeding
already clears the bar 93% of the time, so this averages 1.07 carves and costs
nothing measurable (12.4ms against 12.5ms). The bar is at 0.28 because planets
between 0.20 and 0.28 still wrap most of the way round and are worth keeping
for variety — tightening it does not make planets better, only more alike.
Together: **0% boring against 61.8%, and 78% now wrap the planet outright.**

Territory statistics barely move — 56.9 territories against 56.5, the same
size distribution, the same count of dead ends. What does move is mean
territory adjacency, 4.79 down to 4.48, which is the trade being made: more
coastline is fewer land borders and more chokepoints.

**Lakes** are single cells of water with land the whole way round, punched
after the basins are grown. Two things make them cheap. A lake site is a land
cell with land on every side, which is both what tells a lake from a bite out
of the coast *and* what stops two ever merging into a pond — punching one
turns its neighbours into coast, and coast is not a site, so nothing has to
remember where the last one went. And removing such a cell cannot disconnect
the land, because the cells around a cell of a Goldberg polyhedron form a
cycle, so any path through it can go round it. They are spent out of the same
water budget as the basins, so `oceanFraction` keeps meaning "how much of the
planet is water" however that water is arranged. Nothing downstream needed
changing: the renderer derives water from "has no territory", and
`diceGroundRadius` already treats a non-member cell as foreign, so dice will
not land in one.

A trap worth knowing before measuring any of this: `seededRng` is an LCG, so
its **first** draw is very nearly a linear function of the seed — across seeds
1..200 it only moves from 0.236 to 0.314. Anything the carver decides from its
first draw is therefore near-constant across a sample built from small seeds,
and the old carver's basin count was exactly that. Measure with whole-range
seeds drawn from one generator, which is also what a real game deals itself.
`preview/terrain.html` is where all of this is looked at rather than argued
about: one seed carved both ways side by side, the lakes, and the distribution
counted live.

`seating.js` is who gets dealt what, and it exists because **moving first was
most of the game**. Every seat played by the same AI — so nothing separates
them but where they sit — seat 1 of six won 25.9% of 20,006 games against seat
6's 10.3%, and a duel was 91.9% to 8.1%. The advantage follows the *turn order*
rather than the deal: reverse the order over an unchanged board and the curve
reverses with it. Hard was worse than Normal (30.2% to 8.7%), because a better
player converts a tempo edge more reliably.

Three things correct it, and only the first is a bug fix.

- **The remainder.** `playerIds[i % playerIds.length]` shorts the *last* seats
  every single game — 59 territories over six players is five seats with 10 and
  one with 9, always the same one. Over 20,000 planets that was 9.82
  territories for seat 1 against 8.98 for seat 6, worth about a fifth of the
  whole gap. Rotating where the deal starts removes it and costs nothing.
- **One extra territory**, last seat over first, straight-lined between.
- **A ramp of scattered dice**, `SEAT_DICE_RAMP` per territory a seat holds.

Six-handed that leaves **0.6 points of spread against 15.6** — about 96% of the
advantage gone — for one more territory and about 2.3 more dice. Measured
through the real generator at 30,002 games a table: 2.9 points of spread at two
players against 83.8, 2.3 at four against 30.2, and 0.6 to 0.7 from five up.
Three players is the one that resists, keeping about four points of wobble on
its middle seat; no shape of ramp fixed it and bending the ramp to starve it
made things worse.

The **split between land and dice is the interesting decision**, because land
alone can flatten every table size and was where this started. It is a small
component on purpose. Land is the strongest currency going — reinforcement is
paid every turn on the largest connected region, so it is an income stream
where dice are a lump sum — and that is exactly why a land-only fix is wrong
twice over: it wanted the last of six seats to open with 11.3 territories
against 8.4, an empire visibly half again the size, and it is the currency a
*stronger* player exploits best. Per unit, dice deliver 2.35 to Normal and 2.32
to Hard; land delivers 2.15 and 1.72. Moving the work into dice cut the two
difficulties' disagreement from 66% to 14%, which is what makes one number
serve both — Normal is flattest at 0.245 six-handed and Hard at 0.28.

That difficulty-robustness matters for the planned mixed AI, and the shape of
it was measured rather than assumed: rotating one Hard AI through every seat of
a Normal table, **one setting flattens both roles at once**, and the Hard AI in
that field wants the *Normal* number. The correction tracks the table as a
whole rather than who sits in which chair, so a mixed field blends its seats'
rates.

`SEAT_DICE_RAMP` climbs at small tables (0.47 for two players against 0.23 for
six) because dice saturate: a duel's gap is three times a six-player gap, and a
die stops being worth 0.23 log-odds once ten are being handed over — by then it
is worth about 0.15. That saturation is the whole reason land is in the mix at
all rather than dice doing everything.

Every entry in that table is measured rather than fitted, and the column does
not scale as one: the tail runs slightly hot at large tables and slightly cold
at small ones, so trimming the whole column 10% improved six and eight players
and took a duel from 1.9 points of spread to 7.0. There is also a rounding trap
underneath it. The land step is a single territory and seats take whole ones,
so flooring the exact shares and handing out the leftovers puts every seat on
one of two integers — at 57 territories over six seats, five seats on 9.33 and
the last on 10.33, the whole step arriving as a cliff on the tail rather than a
ramp across the order. That over-paid the last seat by about 1.2 points while
the other five sat flat. `seatTerritoryCounts` rounds by carrying one random
offset along the running total instead, so each seat's *expected* share is its
exact share and the average across planets is a straight line.

Two alternatives were measured and rejected. **Clumping** — dealing later seats
contiguous blobs — hits a wall: it moves a duel from 90.5/9.5 to 76.9/23.1 and
no further, because blobs of 20 do no better than blobs of 10. **Raising the
one-die territories to two** costs the same dice as scattering and leaves more
imbalance (2.4 points against 1.6); a single die is defenceless but also cheap
to lose, so protecting it buys less than spending that die where it can fight.

A **global** floor is a different proposition and is worth knowing about: dice
of 2–3 instead of 1–3, for everyone, is not a handicap at all and still shrinks
the Normal gap by a fifth (a flat 3 shrinks it by half), because the ragged
opening board is a large part of what moving first is worth. It was not taken —
it helps the weak AI far more than the strong one, so it *widens* the gap
between the difficulties — but it is the lever to reach for if the handicap
ever needs to be smaller.

Turn-order changes were measured and are **out of model deliberately**.
Reshuffling the living players every round is exactly neutral by construction,
for any field including a human of unknown strength, and needs no calibration
at all — but shuffling mid-match is not this game, and it would empty the
`start` setting of meaning. Snake order (1..P then P..1) is worse than doing
nothing: it turns the ramp into a U, because the last seat takes two turns back
to back at the turn of the round.

`scripts/seats.js` is the tool all of this was measured with — same sharding
and same shape of answer as `arena.js`, but what it holds still is the AI
rather than the seat. It carries every lever that was tried (`tilt`, `ramp`,
`floor`, `clump`, `remainder`, mixed lineups, alternative turn orders), and
`--level 1` measures the correction the generator actually ships. Passing
`levelSeats: false` to `generatePlanetWorld` is the board as it was dealt
before any of this, which is what the handicaps are measured against.

**`src/game/`** is the layer between core and the screen:

- `createGame.js` — turn flow, selection, when the AI plays. **No three.js**,
  time arrives via `tick(dt)` rather than a clock, so a hundred turns can be
  played in a test instantly. It emits events; the renderer listens. Passing
  `humanPlayerId: AUTOPLAY` leaves nobody in the human seat, which is how a
  whole match is played out unattended.

  It also decides when to *offer* the match won: at the end of the player's own
  turn — the one moment the board is settled and they are looking at it — if
  every opponent left has surrendered (`surrenderedPlayerIds`), it emits `surrendered`.
  Nothing about the game changes. `phase` is still `attack`, the AIs go on
  playing exactly as they were, and `playOn()` does no more than stop it being
  offered again. That is deliberate: a surrender is an opinion about the
  position rather than an outcome of it, and one the player has to be able to
  disagree with — which they cannot do if the match has already been ended
  underneath them. It is asked once per match, and `playedOn` travels in the
  save, so a reload is not a fresh chance to ask.
- `session.js` — one match: a world, a game, and everything drawn for it,
  created from settings and disposed whole. "New game" throws one away and
  builds the next rather than resetting a dozen things. It also decides what is
  worth saving and hands it to `onSave`; where that goes is `main.js`'s
  business, so nothing in here knows that localStorage exists.

  It is the composition root, so it is the one place allowed to reach for
  everything. Two things it used to hold outright have moved out, and both
  moved for the same reason: they were rules and state buried in a closure
  nothing could construct in a test.
- `autoFollow.js` — who is driving the camera. A hand on the planet takes it
  off the match, and every automatic move is off until it is handed back; this
  is which drags count (`dragTakesCamera`), where a press should go
  (`aimKind`), and when a handover's pan home is held back (`panHomeBlocked`).
  Pure, and deliberately ignorant of what a replay or a banner *is* — both
  arrive as a plain flag from the caller. `session.js` keeps only the half that
  can actually move a camera, and `hud.js` keeps `autoFollowButtonView`, which
  is about where the offer is *drawn*.
- `outcomeBanner.js` — the banner that interrupts play, and what the match
  does behind it. Three things put one up and they differ in two ways that used
  to be decided at the call sites: whether the match is **held** for an answer,
  and whether the banner is an **ending to come back to** after a replay.
  `BANNER_RULES` is that table, and getting either column wrong fails quietly —
  a match carved up behind a question, or a win that stops existing on reload.
  What a banner *says* is still `outcomeView` in `hud.js`.
- `replayPlayer.js` — the replay painted onto the planet. While it is open the
  surface, the dice, the poles, the stats row and the readout are all drawn
  from a *reconstructed* board rather than from the live match, which is held
  still underneath. It is handed the same objects live play draws through, and
  the three questions a step has to ask the camera (`focusFights`,
  `isSwinging`, `cameraFreed`) and nothing more.

  What deliberately stayed in `session.js` is the **handover** —
  `openReplay`/`closeReplay`, which decide when the replay has the board at
  all. That is a question about the match rather than about a step: it settles
  whatever move was mid-air, takes the camera off whoever had it, and puts the
  live board and its banner back afterwards.
- `replay.js` — every move of the match, in order, plus the board they build
  forward from (the **anchor**). Nothing per step is remembered: a step is
  rebuilt by walking the moves over the anchor, which is what makes the
  history at a step (`historyThroughStep`) and the board at a step
  (`boardAfterAttacks`) two views of one record rather than two records.

  It is the *only* record. The battle log the history panel reads is derived
  from it, because storing both meant writing every fight down twice and the
  duplicate was 87% of a save.

  `serializeReplay` leaves out everything a walk recovers — who was attacking,
  who was defending, the totals, who won — so a fight is written as its two
  territories and the faces they rolled and nothing else. That is a whole
  eight-player match in about 20KB against 88KB for the shape these moves have
  in memory. It stays JSON, and stays readable in a console: bit-packing gets
  it under 5KB, which is not worth a bit reader on a 5MB storage budget.

  `REPLAY_LIMIT` caps it at 1000 moves. Nothing currently playable comes close
  — eight players on a default planet run about 750 — so the cap is for the
  planet sizes not offered yet, where a match runs to tens of thousands of
  moves. Past it the *oldest* moves go and the anchor advances over them,
  which is what keeps trimming lossless for every step still standing. It is
  also why a pass is recorded on the move rather than inferred from "no attack
  since the last payout": trimming removes exactly the attacks that would
  disprove one.
- `saveGame.js` — a game, written down so a reload picks it up. The planet is
  stored as the **seed it grew from**, not as its geometry: a world is a
  deterministic function of `(seed, settings)`, so one number rebuilds every
  cell. Everything that cannot be recomputed — owners, dice, whose turn,
  banked dice, the replay, whether a surrender has been *offered* and whether
  it has been waved away — is stored outright.

  Those last two are separate fields on purpose, and storing only the second
  was a bug. `playedOn` is set by answering, and the surrender banner has three
  buttons of which only one answers: "New game", "Play on", and **"Watch
  replay", which answers nothing**. A player who took the replay door and then
  reloaded came back to an ordinary game in progress — no banner, because the
  offer is emitted at the end of a turn and is asked once per match, and no
  Replay button either, because `replayButtonView` reads `playedOn`. The win
  they had been handed simply stopped existing until they played another whole
  turn. So `surrenderOffered` travels too, `session.js` writes it the moment
  the offer is made rather than waiting for the next `change` (the match is
  held behind the banner, so there may not be another one), and a restore with
  it set but `playedOn` clear puts the banner back by hand — the same hand a
  restored finished game gets, one step earlier.

  **The surrender is the only interrupt that needed this**, which is why it was
  the one that got missed. A knockout banner is recoverable without any stored
  flag, because `humanEliminated` is read back off the board and is exactly
  what `replayButtonView` keys on; "you are out" is a question already
  answered. A surrender is the one piece of match state that is *not* derivable
  from the position — the board looks identical whether or not the player has
  been told about it.

  That trade has exactly one failure mode: change the generator and the same
  seed grows a *different* planet. Hence `worldFingerprint`, a hash of the
  territory graph and the cell-to-territory mapping, checked against the world
  the seed just rebuilt. Note that territory ids are list positions (`0`, `1`,
  `2`), so comparing ids would pass for any two planets that happen to have the
  same number of territories — which is why the fingerprint hashes shape rather
  than names. A mismatch discards the save and deals a fresh game.

  Saving happens on every `change` event rather than on a timer or on
  `pagehide` (which is not reliable on mobile) — **and on every move the
  moment it is decided, which is earlier than that.** An attack resolves in
  full when it is declared: `reduce` has already run, and the `attack` event
  carries every face the dice will land on. Saving when the animation ended
  therefore made the save something the player could *refuse* — read the total
  off the faces, reload before they stop, and the restored board is the one
  from before the fight, ready to be fought again for a different answer. A
  payout is the same trick against `rng` rather than `rollDie`: the scatter is
  decided at `reinforce` and a scatter nobody liked could be reloaded away.

  So `createGame` exposes `settledState` — the board once whatever is in
  mid-air has landed, and the identical object as `state` when nothing is —
  and `session.js` snapshots off that, writing from the `attack` and
  `reinforce` handlers. Only one move is ever outstanding, so there is only
  ever one thing to settle.

  Two things had to move with it. The **replay is recorded at the declaration
  too**, not at `resolved`, because a save whose board is a move ahead of its
  own replay comes back missing the fight that produced it. And the
  `eliminated` event, which is deliberately held back until the dice land —
  a knockout is news that belongs after the roll that did it — now *also*
  travels on the `attack` payload, for the one listener that cannot wait: the
  replay entry it is tagged onto is being written a whole animation early.
  Everything that merely shows a knockout still reads the event.

  The `change` that follows lands on exactly the board `saveOutcome` already
  wrote, so it does not write it again (`outcomeSaved`); the only thing given
  up is a camera that moved during the animation, which is stored a move
  behind rather than wrongly — and the camera has always been opportunistic in
  a save, since nothing but a board change ever wrote one.

  A finished game is saved too, rather than cleared. There is no turn left to
  take, but the replay is in there, so a reload opens back onto the ending it
  finished on with "Watch replay" still on it — which is also why `session.js`
  puts that banner up by hand when it restores a game already won, since `over`
  will never fire for one.
- `settings.js` — every configurable option declared once as data
  (`SETTING_DEFINITIONS`). The menu renders itself from that list, so a new
  option is added here and nowhere else.

  Two flags say how finished an option is. `available: false` means it is
  plumbed but its feature is unbuilt: the menu greys it out with its `note`
  *and* `normalizeSettings` pins it to its default, so nothing downstream is
  ever handed a setting it cannot honor (this is how `moon` sits).
  `hidden: true` means the menu does not draw it at all — for something that
  works but is not ready to be offered, where a greyed-out row would advertise
  a half-finished feature rather than promise a coming one (this is how `size`,
  the planet's subdivision count, sits). The menu and its preview render from
  `MENU_SETTINGS`, which is `SETTING_DEFINITIONS` minus the hidden ones;
  everything else in the pipeline still sees all of them.

  A choice's values are usually numbers, and `normalizeSettings` rounds and
  clamps those onto the nearest one offered — so a planet size from a build
  that had more of them lands somewhere rather than nowhere. They can also be
  names (`difficulty` is `normal`/`hard`/`expert`), and there is no nearest
  `hard`, so those normalize by membership and anything else is the default.

  Settings are parsed **once, at the edge** — `resolveSettings` for the page,
  the menu for anything the player picks, `readSavedGame` for a game being
  resumed. Everything downstream
  (`playerIdsFor`, `resolveStartSeat`, `subdivisionsFor`, `createSession`)
  takes an already-normalized object and trusts it. Re-validating deeper in
  would mean no caller could be sure which layer had the last word.

**`src/render/`** — pure decisions are split out from DOM and three.js
plumbing wherever it is worth testing. `hud.js` exports `playerPanelView`,
`turnIndicatorView` and `outcomeView` as pure functions and applies them just
below; `rollTimeline.js` is the animation's timing and `diceScatter.js` its
landing spots, neither with any three.js in it at all. Modules importable
without a DOM are testable, so keep `document` access inside functions rather
than at module top level.

A replay starts playing the moment it opens: somebody who has just pressed
"Watch replay" has said what they want, and leaving them on a still board to
go and find the play button asks the question twice. Any touch of the
transport pauses it — `seekReplay` stops the timer before it paints, so the
track and the arrows take it back off the player's hands the moment they reach
for it. That also means the timer is the *default* state rather than the
exception, which is why `session.dispose` closes the replay: the interval
outlives the markup and would go on painting steps onto a planet that has been
taken out of the scene.

There are two doors into it and the banner is only one of them. Every banner
that can offer a replay does — a win, a win by surrender, and being knocked
out, where there is most to look back at, since the match you were playing is
over whatever the board goes on doing without you. And an offer once made is
never withdrawn: `replayButtonView` puts a **Replay** button on the controls
row, beside the menu, the moment the match has an ending to look back at — it
is over, the player is out of it, or they have been offered the win and waved
it away. All three are read back off the match rather than latched when
the banner went up, which is what makes the button survive a reload: the board
says who won and who is out, and `playedOn` travels in the save. Before this,
"Look at the board", "Spectate" and "Play on" all closed the banner for good
and left the replay one press away and unreachable.

Two of those banners go up over a match that is **still running**, and the
match is held behind them until they are answered (`BANNER_RULES` in
`outcomeBanner.js`). Without it the AIs went on taking turns underneath: you
were told you were out while the planet carried on being carved up, and
dismissing the banner dropped you into a board several turns past the one it
went up over. Both banners are questions, and a question that goes stale while
it is being asked is worse than not asking it. Holding is safe because both
arrive at a settled moment — a knockout is emitted after its attack has been
applied, a surrender is judged at the end of a turn — so unlike the replay
there is never a move in mid-air to put down first. The banner covers the whole
HUD, so answering it is the only way out and the hold cannot be stranded.

That second door opens onto a match that may still be *running* — playing on
past a surrender, or watching from a knockout — so two things follow.
`settleLiveBoard` finishes whatever move was mid-air first, in one long
`game.tick`, so what the overlay covers is a whole move rather than half of
one (`createGame` guarantees only one can ever be outstanding, since a turn
cannot end on top of a pending attack). And the match is *held* while the
replay has the planet — `game.tick` is the only clock in it, so not calling it
is the whole of the pause. There is one board between them, and letting the AI
take three turns behind the overlay would mean closing it dropped the player
somewhere they never saw happen. Closing puts the banner back only if the match
actually *ended* — `BANNER_RULES` remembers a win and a surrender and
deliberately not a knockout, since a game carrying on without you has no
ending screen to return to and "You are out" is a question already answered.

**It comes back with its hold, and that is the part that is easy to get
wrong.** Every answer releases the hold and **"Watch replay" is an answer** —
it is the one button that settles nothing — so a banner put back by only
*showing* it again returns over a match that is running. That was the bug: a
surrender banner restored after a replay let the AIs take a round of turns
behind a "You win" card, with the turn-handover flash going off behind it, and
"Play on" then dropped the player onto a board several turns past the one they
had been offered. `restore` is therefore a full `raise`, which re-applies the
kind's rule rather than needing to know which kind it is holding: a win holds
nothing because there is nothing left to play, and a knockout is never
remembered, so it never reaches the restore path at all.

A replay throws its dice too, at `REPLAY_TIMING` — briefer than even the AI's
pace, because the track advances itself every `REPLAY_STEP_MS` and a throw
still in the air when the next step arrives is a throw nobody sees land. Only
a step *forward* animates: playing and `›` both move one at a time and are
worth watching, while dragging the track is a scrub through dozens of steps
and stepping back is arriving at a board rather than watching it happen.

An animated step paints the board from *before* its attack, so the stacks are
standing where they are about to be thrown from, and lands on the board after
it once the dice stop. That landing has to call `diceLayer`'s `reroll` for
both territories rather than relying on `update`, which rebuilds a stack only
when its dice *count* changes — a defender taken with exactly as many dice as
it was holding keeps its count while every one of its dice is lying scattered
on the ground. Live play calls `reroll` by hand for the same reason.

**Graph** opens the match as a shape rather than as a sequence:
`replayChart.js` draws a line per player over every step the track can reach,
on two tabs — territories held, and dice standing on them. It is the one thing
watching a replay cannot say. The planet shows a moment, and a run of moments
watched one after another is still not a shape: who was ahead at halfway, when
somebody's collapse actually started, and whether an empire was wide or deep
are all questions about a curve.

The series is `standingsOverReplay`, a third view of the one record alongside
the board and the history, derived on demand rather than tallied as the match
is played — a whole match's shape is nothing the moves do not already say, and
a step is one pass over the board with `REPLAY_LIMIT` bounding the steps. It
samples immediately after each attack and nowhere else, which is exactly where
`boardAfterAttacks` stops for the same step, so the chart and the planet under
it cannot disagree about where the track is standing. `dice` is the dice on
the planet rather than those plus the banked reserve: what the chart is read
against is the board, and banked dice are a promise rather than an army —
already called out on their own as the "+n" on a tile.

Three decisions in it are worth keeping. The **lines are the whole match from
the moment the panel opens**, and only a dashed cursor moves with the track: a
chart that grew as the replay played would hide exactly what somebody opened
it to see. The **scale is the peak itself**, not a round number above it —
rounding 60 territories up to 100 spends two fifths of a short plot on
nothing, and a peak is a fact about the match worth reading in its own right.
And the panel **starts shut on every open**, because what "Watch replay" was
pressed for is the match on the planet, and the chart costs the planet the
bottom of the screen for as long as it is up.

Attacking dice don't tumble in place: they are thrown out across the
territory and land flat, so a roll of eight can be read at a glance instead of
being stacked inside itself. Two rules make that work, and they meet in
`diceScatter.js`:

- **How much ground there is.** `territoryCenters.js` `diceGroundRadius` is
  the largest circle around the mount point that is entirely this territory's
  land. A cell owns the ground nearest its own center, so stepping `d` from
  the mount point brings the nearest foreign center `d` closer and pushes the
  nearest own center `d` away; they meet at `(clearance - home) / 2`. It is a
  worst-direction bound rather than an average, because a die that strays onto
  the neighbour is precisely the confusion the dice exist to prevent.
- **How much room a die needs.** A die that has stopped tumbling is yawed by a
  whole number of quarter turns, so its footprint is an *axis-aligned* square,
  and two of them are clear as soon as they're a die apart in x **or** in z.
  That Chebyshev distance is what the lattice, the jitter cap and the tests
  are all stated in — keeping circumscribed circles apart instead would cost
  40% more room and eight dice would no longer fit anywhere.

The pitch shrinks until the pile fits the ground it has, and stops at dice
touching — past that there is nothing left to give, so a pile that still
doesn't fit overhangs the border rather than dice landing inside one another.
Not overlapping is the guarantee; staying inside is the strong preference.
Because `diceGroundRadius` takes the worst direction, that trade bites less
often than it looks. It is also the half of the dice that pays for their size:
a resting stack is one or two columns and has room to spare, while a thrown
pile is spread across the whole territory, so raising `DIE_SIZE` costs the
throw and almost nothing else. Measured over 1,106 territories on 20 default
planets, dice landing on a neighbour's land:

| die size | 4 dice | 6 dice | 8 dice |
|----------|--------|--------|--------|
| 0.035    | 0.1%   | 0.1%   | 2.0%   |
| 0.042    | 0.4%   | 3.6%   | 8.7%   |

0.042 is what ships. The four-dice column is what most throws actually are,
and it barely moves; the eight-dice column is the price, and it is paid for
the second or two a battle is in the air rather than on the board you look at
in between.

`lightRig.js` is the lights, and the first thing to know is how little they
touch: the planet is `MeshBasicMaterial` and the pole markers are an unlit
additive shader, so **the dice are the only lit thing in the scene**. Lighting
and the planet's colours are therefore independent problems — the one place
they meet is dice painted by owner.

The rig is aimed off the **camera** rather than off the world, and that is
structural rather than a tuning. Dice stand on a sphere, so their up faces
point every way there is, while the camera orbits freely — a key light fixed
in the world lights one hemisphere of dice and leaves the rest on ambient,
which does not shade a normal map, so the pip dimples stop existing entirely
on the far side. Measured on the up faces of the territories actually in view,
the single directional light at `(3, 5, 4)` that shipped before this read a
median Lambert term of 0.75 and 0.62 from two camera positions and **0.00**
from the other two — a straight-down look at the south pole, and the equator
facing away. Carried by the camera it reads 0.74 from all four, identically,
because the angle between an up face and the light no longer depends on where
the camera went. The claim is not that the numbers are better; it is that
there is no view left to tune *for*.

Three lights, and the key's off-axis angle is the whole of the modelling: an
up face carries the *number* and keeps `cos`, the two visible sides carry the
*cube* and get `±sin`, and nothing can have both. At 20° up and 24° across —
which compose to 31° off, not 44 — that is 0.86 and 0.51. The fill is opposite
in azimuth and weak: a shadow side, not a second key. Ambient is the floor and
is deliberately low, since it was 0.6 of a 1.8 total before, a third of every
surface arriving as the one term that cannot describe a shape.

`preview/dice.html` is where all of that is judged, and it carries the old rig
on a toggle so the two can be turned on one board rather than described. It
also holds the two open questions next to it: dice painted by owner
(`createPlayerDiePipMaterials`, a `tint` toward white until the pips have
somewhere to stand, with `readableTextColor` picking the ink) and a die-size
slider.

**Colour is a separate pipeline from light, and it was being encoded twice.**
The palette is written as sRGB — the HUD hands those exact numbers to a CSS
`rgb()` — but a three.js vertex colour is read as *linear* and encoded to sRGB
on output, so the planet was showing the whole palette lightened and flattened.
Yellow was authored `242,191,38` and displayed `249,225,108`, which put it
ΔE2000 11.4 from orange where the two are 19.4 apart as written. `planetSurface`
now linearizes at the buffer write (`palette.js` `linearRgb`), and the output
encoding puts it back exactly: a territory and its swatch in the HUD are the
same colour.

Three things about where that conversion sits. It is at the **very last step**
and nowhere earlier, so every tint upstream — selection, attacker, defender —
still means the fraction between two sRGB colours it was judged as; blending in
linear instead would move all of them. Nothing else needed it: a `THREE.Color`
built from a hex is converted by three.js itself, so the boundary lines and the
pole marker were always right, and the dice textures already carry
`SRGBColorSpace`. And **the working space is still linear, which is what the
lighting wants** — this is not a move away from sRGB but the correction that
makes the displayed result the sRGB the palette asks for.

The failure mode is worth recognising again, because it does not look like a
fault: a pastel planet is a plausible planet, and nothing gives it away until
it is put beside the swatches it is supposed to match. `planetSurface.test.js`
states the claim in what reaches the *screen* rather than in what sits in the
buffer, since asserting the buffer against the palette directly is exactly the
test that passed all the way through. The comparison grid on `preview/dice.html`
is the record of what it cost.

The AI plays where it likes, and most of that is round the back of the
planet, so `cameraFocus.js` swings the orbit camera over to an AI attack that
isn't in view — along the shortest arc, and never for the player's own
attacks, which they just clicked. `cameraFraming.js` holds every decision in
it as pure functions:

- **What can be seen.** `visibleAngle` is how far around the planet from the
  point facing the camera you can still see. Two things cut it off and the
  nearer wins: the horizon (`acos(1 / distance)`) and, once you zoom in past
  the planet, the edge of the frame. Zoomed all the way in, the frame bites at
  about 12° where the horizon is still 48° away.
- **How close to the edge is too close.** `framingOf` places a point on a
  scale of 1 (dead center) to 0 (right on that edge), and
  `DEFAULT_FRAMING.margin` is the tuning lever: below it, the camera moves.
  Deliberately measured on the *screen* rather than around the planet, because
  the limb foreshortens hard — a fight 70% of the way to the horizon in angle
  is already 91% of the way out on the disc, and a lever stated in angle would
  quietly tolerate dice seen edge-on. On a default planet, the current 0.2
  moves the camera for roughly three AI attacks in four and leaves it in
  motion about a quarter of the time; dropping the lever to 0 (move only when
  the fight is strictly off screen) only takes that to one in two. Most of the
  planet is simply not facing you, and no setting changes that — what the
  lever really trades is how squashed the dice may be when it does hold still.
- **How far a drag turns it.** OrbitControls turns pixels into degrees at one
  fixed rate, and degrees are the wrong unit: a drag pushes the *surface*
  around, and how much surface a degree is worth is entirely how close the
  camera is. Near the middle of the disc — which is where a finger is — the
  scale is `1 / (distance - 1)`, so zoomed all the way in the planet is several
  times the size it is at the framed view and one unchanged rate throws it
  several times as far. `orbitRotateSpeed` is exactly that ratio, taken against
  `framingDistance`, and `createViewer` writes it onto `controls.rotateSpeed`
  every frame so a wheel and a resize are both already in it. `halfFov` appears
  on both sides and cancels, which is what keeps a phone and a desktop feeling
  the same — each is measured against how far *it* has to sit back. It is
  capped at 1 and so only ever slows the drag down: further out than the framed
  view the surface already moves slower than the finger, and the direction
  worth correcting is the one that is uncontrollable rather than the one that
  is merely gentle.

A swing is paced by distance and capped at 0.55s, which is shorter than an AI
attack's aim-plus-roll, so the camera has arrived before there is anything to
read. A hand that **turns** the planet cancels it outright; a zoom doesn't,
since that says nothing about where to look, and the swing keeps whatever
distance the player lands on.

That rule is read off the **movement** rather than off the gesture, and the
difference is a pinch. The three zooms — the wheel, a pinch, a middle-button
dolly — all say where the player wants to be and nothing about where they want
to look, but only the first of them looks like a zoom to OrbitControls: its
`state` reads as a one-finger *rotate* for the moment between the two fingers
of a pinch landing, and again as one of them lifts. Asking it which gesture it
is in therefore called a pinch a drag, and the camera came off the match before
it had zoomed a single pixel — on the one device where pinching is the only way
to zoom at all. Comparing where the camera is looking against where we last
left it makes all three one case, and needs nothing of the controls but the
`change` they already announce every move with. What tells our own swing from a
hand is a flag set across `aimAt`, since the controls announce both the same
way.

The camera also turns **back to the player's own ground** when a turn hands to
them (`lookAtHoldings` / `holdingsFocus`), because the other side of following
the AI round the back for a minute is that the board handed back is often
somebody else's half of the planet. It fires from `endTurn`, which
`finishReinforce` emits once the previous player's payout has finished landing
— both the moment the player is actually handed the board and the first moment
the camera is free without cutting an animation short. Held back for the four
states where moving the planet is wrong rather than merely unhelpful: the
player is out, the match is over, the replay has the planet, or a banner is
holding it.

Two things about how it aims. It goes on **how many territories end up on
screen**, not on the largest connected region — what a camera can show is
decided by angle, and connectedness is a fact about the territory graph, so
two territories can share a border and still want different framings. Counting
what lands on screen also degrades gracefully: on an opening board of
scattered singletons there is no region to speak of, and a region-based aim
would pick an essentially arbitrary one, where this aims at whichever quarter
of the planet holds most of you. And it **seeds from the territories
themselves** rather than sampling the sphere evenly, sliding each seed a
couple of times toward the middle of whatever it can see. The best aim is
always near a territory, since an aim near nothing sees nothing — which is
what keeps this at 0.4ms for a 40-territory empire instead of a scan of the
whole sphere.

It only fires when **none** of the player's territories is on screen, and it
draws back only when the wider view strictly shows more, never inwards — the
same bargain `framePlanet` makes about distance, applied to direction. Seeing
some of your own ground is enough to know where you are, and a camera that
moved anyway would be taking a view away from somebody who has one.

**A hand on the planet takes the camera off the match entirely**, and that is
the one thing none of the rules above could express. Every one of them is
about *where* to move; none of them is about somebody who does not want the
camera moved at all. A player dragging round the planet is nearly always
reading it — counting an opponent's stacks, working out where a border is —
and before this they got about one AI attack's worth of looking before the
camera swung off to a fight somewhere else. So `cameraFocus` reports drags
(`onDrag`, once per hand and on exactly what cancels a swing — a zoom is not
one, for the reason it never was), and the camera being *freed* suppresses all
three automatic moves: the pan home, the swing to the AI's fights, and the
end-of-turn pull-back.

**`game/autoFollow.js` is where those rules live**, and it is pure — no
three.js, no camera object, nothing that knows what a replay or a banner is.
Whether a drag counts (`dragTakesCamera`), where a press should go
(`aimKind`), and when a handover's pan home is held back (`panHomeBlocked`)
are each a case that is easy to write the plausible version of and get
backwards, so they are stated once and tested. `session.js` keeps only the
half that can actually move a camera. The one rule that stays in `hud.js` is
`autoFollowButtonView`, which is about where the offer is *drawn*.

The part that needs care is giving it back, because a camera that has silently
stopped following is indistinguishable from one that is broken. Hence
`autoFollowButtonView` — an offer that goes up on the drag and stays up until
it is answered, centred in the band above the controls where the hint sits
left and the payout tray fills from the left, so it is the only thing in the
middle. It is the recenter button a map offers once you have scrolled away
from where you are driving.

**A replay follows too, so the offer is made there as well**, and the view
answers *where* rather than just whether: `'replay'` seats it in the replay
card's own head beside Graph, because the card is docked over exactly the band
`'controls'` uses. One rule and one handler, two seats. What it buys is
watching one corner of the planet while the track runs — a replay otherwise
swings to every step's fight, which is right for watching a match back and
wrong for watching one region of it.

Note which silencer had to survive that: **`isOver` is read after
`replayOpen`, not before.** A finished match silences the offer because nothing
moves the camera again — but a replay of a finished match moves it constantly,
and almost every replay watched is of one, so the obvious ordering would have
hidden the button in the place it is most useful.

**Whether a drag counts is decided by whose turn it was, and the offer then
outlives that turn.** Those are two different rules and conflating them was the
first thing got wrong here.

A drag during an AI's turn suppresses the pan home, so the player's own turn
*opens* on the view they chose rather than on their ground. That is right, and
it is exactly why the offer has to still be standing when they get there —
taking it down at the handover would leave them holding a board they cannot see
with nothing on screen to fix it. So `autoFollowButtonView` does not ask whose
turn it is at all.

A drag during the player's *own* turn is never recorded, because there would be
nothing to record: every automatic move belongs either to a turn that is not
theirs or to the handover at one end of it, so a freed camera suppresses
precisely nothing during their turn. `dragTakesCamera` asks `isHumanTurn`
once, when the drag happens, and that one question is the whole of the
distinction — which is why it takes the turn as an argument rather than the
offer asking about it later.

Three things then answer an offer that is standing: the button, **picking a
territory to attack from** (silently — they are looking straight at ground they
just found), and ending the turn as the backstop for one simply ignored. In a
replay only the button does; opening or closing one resets the flag outright,
since there is one planet with two things that drive it and whichever has just
been handed it starts out driving.

**Dragging the track is not a seek the camera chases.** A hand scrubbing passes
through dozens of steps, and the board deliberately *waits* for a swing to land
before it paints (`replayPlayer`'s `pendingStep`), so chasing them made the one
thing a scrub is for lag behind the hand doing it. The track's `input` therefore seeks
unsettled — repaint, no camera — and its `change` is the release the camera
answers. Everything else (the arrows, the timer, a click on the track) is
settled by definition.

There is a second moment besides the handover where a turn can fail to open on
your own ground: **a save reopened.** `endTurn` will not fire again for a turn
that already began, so a game reloaded on the player's own turn came back
pointing wherever the camera was saved — very often the last attack an AI made
before handing over — and nothing would move it until the turn was over.
`createSession` therefore aims at the player's holdings on open as well, under
the handover's own rule (only when none of that ground is on screen, so a
camera deliberately left there is left alone) and `instant`, for
`framePlanet`'s reason. It is gated on `isHumanTurn` because that is the only
restore point with nothing coming: reopened mid-AI-turn, the next attack swings
the camera itself within a second.

**Pressing it moves the camera in the same breath**, `force`d past
`holdingsFocus`'s and `clusterFocus`'s "it is on screen already" rules — those
are right for a handover nobody asked for and wrong for a request, since the
player pressed the button precisely because what they could see was not the
view they wanted. The other two answers move nothing at all, which is the
difference: a player picking a territory has found their own way there, and a
player ending their turn is handing the board over anyway.

**A press restores the distance as well as the direction**, and for a while it
only did the second. The camera it is putting back is one that had been *pulled
back*: `endTurn` frames the whole planet before handing over, so a turn spent
following the AI is a turn spent at that distance. Restoring only where it was
looking therefore answered half the press — a run round the back, swung to from
a tight zoom, arrived with the fight after it still off screen. Home already
drew back (`holdingsFocus` compares the near view against the wide one), and
the fights did not: `clusterAim` has no distance in it at all. `clusterFocus`
is the missing half, and it stands to `clusterAim` exactly as `holdingsFocus`
stands to `holdingsAim`.

Two things about it. It draws back **only when the wider view frames strictly
more of the run**, outwards only — the bargain the rest of the module makes,
so a player who zoomed in to read a stack and pressed the button on a single
pending fight keeps the zoom and gets the fight up close. And it picks the aim
against the distance it is about to *arrive* at rather than the one it is
leaving, which is why it is one decision rather than a pull-back bolted
alongside a `clusterAim`: from a tight zoom nothing but the first fight ever
fits, so an aim chosen there would swing to that one and need swinging again
for its neighbour a second later — the exact thing `clusterAim` exists to
avoid.

**The automatic swing still keeps whatever zoom the player is on**, and that
default is the deliberate half of `pullBack`. A zoom never takes the camera off
the match (`onControlsChange` reports turns and not distance), so a player who
pinches in mid-AI-turn is still being followed, and the swings go on centring
each fight — at their zoom, which is what pinching in asked for. What they get
is more swings showing less each, not a view they cannot read, and it settles
itself at the handover: the pan home draws back if it needs to, and their own
`endTurn` frames the planet outright. There is no button in that state and
should not be, because nothing is being suppressed.

**Where a press goes is not the same all match**, and getting this wrong is
the obvious mistake: home is only the answer on your own turn. On somebody
else's, the camera's job is the fight, and the run of attacks being shown is
the thing the player pressed the button to catch up with — taking them home
mid-AI-turn shows them the one part of the planet where nothing is happening.
`aimKind` picks between the two, and the run being shown is the only state it
needs: the `upcoming` run off the last attack event, emptied at `endTurn`. It
answers `fights` as a *preference* rather than a verdict, so a run the camera
cannot frame still falls through to home rather than leaving a press
unanswered.

The flash is deliberately *not* suppressed. It is information about the match
rather than a movement of the camera, and somebody studying the board is
precisely who most needs telling their turn has come round — which is why the
flash is not one of `panHomeBlocked`'s four states. And none of this is saved:
it is a fact about the hand on the planet in this sitting, like the pressed
territory, and a reload is somebody arriving at the board fresh.

**How far back the camera sits** is the other half, and it is a phone problem.
`narrowHalfFov` is the tighter of the two frustum half-angles, because "in
frame" has to mean in frame in both directions — and on a phone held upright
the horizontal one is less than half the vertical, so a planet comfortably
framed on a desktop spills off both sides. `framingDistance` is how far out
that puts the camera: a unit sphere's silhouette has angular radius
`asin(1 / distance)`, perspective puts screen offsets in proportion to `tan`,
so the disc and the frame compare directly as `tan(asin(1/d))` against
`tan(halfFov)`. `DEFAULT_FRAMING.shave` (0.075 of the radius off each edge)
is deliberately not zero: the extreme left and right of the disc are limb, seen
so edge-on that dice there are unreadable anyway, and giving those two slivers
up buys apparent size everywhere that isn't. A portrait phone opens at about
4.9 radii against a desktop's 3.2.

It is applied at two moments, both through the same outwards-only rule.
A session frames the planet the instant it opens, over whatever camera it
inherited — the viewer's `ROOMY_DISTANCE` default for a fresh game, or the
camera a save just restored. That second case is the one worth remembering:
`saveGame` stores where the player left the camera, so without this a phone
reloading a game in progress restores a distance saved on a wider screen (or
from before this rule existed) and lands straight back in the view the rule
exists to prevent. And ending *the player's own* turn pulls back, because the AI
attacks wherever it likes and the view that suits someone else's turn is the
one with the whole planet in it. Outwards only — a player already further back
can already see everything this would, so hauling them in would be taking away
a view they chose. Any touch of the controls ends a pull-back, including a
drag; unlike a swing, this one is *about* distance, so a pinch or a wheel
outranks it.

A battle has two readings, both built every time and picked between with one
class (`is-compact`), so switching costs no rebuild. Which one shows is decided
differently in the two places a battle appears:

- **The history is always compact**, whatever room a row has. A row there is a
  summary you scan down, and thirty of them read better as thirty identical
  shapes than as two layouts alternating line to line. It also means a history
  row is never measured — only its dice strip's edge fades depend on width.
- **The readout at the top is full only when it earns it**: at most
  `FULL_READING_MAX_DICE` (four) a side, *and* only if the full reading fits.
  Width prevails — the dice rule is only ever consulted for a battle that would
  fit anyway. It is checked first because counting dice is free and skipping the
  measurement skips a forced reflow.

The cap is about legibility rather than room: five dice a side still fits a
desktop readout and is still refused, because the point where faces become a row
to count comes before the point where they stop fitting. `.battle-current` is
`overflow: hidden`, so a full reading that overruns truncates rather than
scrolls — which is why the fit is measured rather than hoped for.

**Four things say whose game this is**, and they are deliberately different
kinds of thing, because "which colour am I" is a standing fact you may want
three minutes in, while "it is your turn now" is a moment. A persistent badge
cannot mark a handover and a flash cannot answer a question asked later.

- **The caret** (`is-you` on the stats tile) is the standing answer. A shape
  rather than a word or a colour, because every other affordance the tile has
  is taken: the border and its glow say whose turn it is (and say it again,
  brighter, for a winner), the lower-right corner is the banked-dice badge,
  the middle is the dot a knocked-out tile folds to — and colour cannot mark
  it either, since every tile is already its player's colour. It sits *inside*
  the tile: `.hud-player` clips its own overflow to fold up on a knockout, and
  that clip is the padding edge, so `top: 0` is as high as it can go — which
  is also where it wants to be, flush against the border and as far from the
  name below as the tile can give it. On your own turn it goes white with the
  border it is resting against: the two are touching, so sharing a colour
  makes them one mark rather than a coloured notch inside a white frame.
  The top padding is on every tile,
  not just the marked one, so marking a tile never makes it a different size.
  The colour *name* stays on the tile — a tile reading only "YOU" would leave
  "Blue is playing" and the battle history with nothing to attach to — and the
  `aria-label` says "Red, you".
- **The rail** (`is-your-turn` on `.hud-controls-row`) is the standing answer
  to "is it me now". Present while the turn is yours, absent otherwise, so it
  is readable at any point in a turn rather than only at its start, and being
  present-or-absent rather than one hue against another it does not depend on
  telling colours apart. It is a **divider**: it runs off the left edge of the
  screen and sits in the gap above the button row, so everything transient —
  the payout tray, the first-timer's prompt — is above the line and the
  controls are below it. Reaching the edge is what makes it read as a rule
  across the interface rather than as an underline belonging to one of the
  words. `.hud-controls` names `--controls-gap`, `--controls-inset` and
  `--turn-rail` so the rail can centre itself in that gap and cancel out that
  padding; three places that have to agree, and would drift silently if each
  wrote its own number. The right end fades rather than stopping, capped in
  `rem` so the taper does not grow silly on a wide screen but falling back to a
  share of the rail below that — a fixed 8rem is most of the whole line on a
  phone, which leaves barely any solid colour to fade *from*.
- **The pan and the flash** mark the moment. Above.
- **The corner line** (`turnIndicatorView`) carries the words, and the change
  worth knowing is that it is now anchored on **you** rather than on whoever
  is playing. `Blue is playing` was three ways redundant — the stats row
  already borders the current player, the rail already says whether the turn
  is yours — and it answered a question nobody was asking. What a random seat
  leaves you needing is *which of these colours am I*, and it leaves you
  needing it for a while: `resolveStartSeat` defaults to any seat, so a
  six-player game can open with five AI turns carving the planet up before you
  get a move.

So the corner says one of two things, and they are one sentence at two
moments. Between your turns it names your colour as a chip (`You are red`); on
your own turn it is a **dot** in that same colour beside the words. Having
been told you are red, a red dot is what makes `Your turn` the sentence
continued — a second chip spelling the word out again would read as a change
of subject. The endings keep their old wording, and are still the states the
line alone can say once their banner has been dismissed, which is the same
argument `replayButtonView` makes about the replay.

**The dot means "yours, now", and nothing else does.** Every other line marks
its subject as a chip instead — `You` for your own win or your knockout, the
winner's name in their colour for somebody else's — which leaves the dot
appearing on exactly one line in the whole game. That is worth more than the
consistency it costs: the dot arriving is then part of what says the planet is
yours again, alongside the rail and the flash, rather than a decoration that
has been sitting there all along changing colour. `Nobody wins` names nobody
and so takes neither. Note the chipped word is not always a colour name — it is
whatever the line is *about*, which for a win or a knockout is the person.

Order matters in that function and is not arbitrary. The result is decided
first, then the **unattended match** (`AUTOPLAY`), then the knockout. The
autoplay check has to come before the knockout because `humanEliminated` is
derived from whether the human seat still holds ground, so an empty seat reads
as eliminated — checked the other way round, a match nobody is playing would
announce that somebody had been knocked out of a game they were never in. It
comes *after* the result because how a match ended is worth reading whoever, if
anyone, was at the keyboard.

`turnIndicatorView` returns `before`/`color`/`after` rather than one string,
for the same reason `attackHintView` does: a word that has to be set in a
player's colour cannot just be part of a sentence. `turnIndicatorText` joins
them back up for tests. `.hud-color-chip` is shared by the corner and the
first-timer's prompt, which say it in the same voice and should not drift.

That chip explicitly clears the corner line's `text-shadow`. The glow is there
so the line can be read over a moving planet; a chip has its own opaque
background and never had that problem, and inheriting the glow hurt the half of
the palette whose ink is dark. **Purple is the case that shows it** — 4.78
against its own background, the tightest margin in the palette and only just
over AA, with a black halo eating into the edge the letterforms are carried by.
Not a *lighter* glow for dark ink, which is the tempting fix: `readableTextColor`
measures against a flat background, so any halo makes that measurement — and
the test asserting the whole palette clears AA — stop describing the screen,
and it would be a second rule tracking where that function flips.

The one state that says nothing at all is an **unattended match** —
`createGame`'s `AUTOPLAY` leaves nobody in the human seat, so a line about
which colour you are has no subject. `.hud-buttons` takes `margin-left: auto`
so the controls stay pinned right when it is hidden; without it they jump
sides, since `space-between` puts a lone child at the start.

`humanPlayerId` is told to `createHud` once rather than also threaded through
`playerStatsFor`, for the same reason the pointer kind and the colour name are
filled in there: it is a fact about the interface rather than about the board,
and one source is what stops the caret and the rail ever disagreeing.

The **payout tray** — a chip per die a turn just earned, peeled back one at a
time by `reinforceDropped` as each die lands — empties right to left, top to
bottom, and **that direction is set in CSS, not in the JS that removes the
chips**. This is the counter-intuitive part and the reason the tray is worth a
paragraph. The chips are identical and the row is left-aligned, so the ones
still standing always occupy the first *n* slots however `reinforceDropped`
picks: popping the last chip and shifting the first draw the same picture,
pixel for pixel. Nothing in the JS can change the direction. What decides
which line goes first is which line the *last slot* is on, and that is
`.hud-reinforce`'s `flex-wrap`. `wrap-reverse` puts the first flex line at the
bottom and each new line above it, so the short partial line is on top and
drains first; plain `wrap` puts it at the bottom and gives the opposite. The
count is capped at `MAX_RESERVE`, 64, and a phone fits about fifteen chips to
a line, so wrapping is an ordinary late-game turn rather than an edge case.
`preview/payout.html` stands the two directions side by side, draining off one
clock, with a step button — because a whole payout is capped at a second
however many dice are in it, which is not long enough to read a direction in.

`turnFlash.js` is the loud half of marking that handover: a brief veil over the
whole view, which is the one cue that cannot be missed by looking somewhere
else, because there is nowhere else to look. Two decisions in it are worth
keeping. It is **DOM over the canvas rather than `scene.background`** — a
background flash lights only the ring of empty space around the planet, and how
much of the frame that is varies enormously (a portrait phone frames at about
4.9 radii against a desktop's 3.2), plus it stops working the day the
background grows stars. And the shape is a **vignette**, clear over the middle,
because the point is to announce the board rather than hide the one thing the
player has just been handed. It sits *under* the HUD: greying out the controls
at the moment you have been invited to use them is the opposite of the point.
`flashOpacity` combines the flashes with `max` rather than by adding them, so a
spacing tighter than one flash's own length runs them into a plateau instead of
stacking past `peak` — otherwise the number named "how grey it gets" would be a
lie at some settings. `preview/handover.html` is where the shape and the timing
are judged, at both framings, with the pan on the same page.

The flash **runs with the pan rather than following it**: `focusOwnGround`
starts the swing and plays the flash in the same breath. They are two halves of
one handover — the planet coming back to you, and being told so — and the flash
is what marks the moment that happens. Held until the camera settled, as it was
before, it announced the handover up to half a second after the handover, which
reads as a second event rather than as the same one. Overlapping them is safe
because of the shape the flash already has: a vignette is clear over the middle,
so the planet turning underneath it is never the part that gets covered.

That also puts the whole guard in one place. The four suppression rules are
checked once, where the pan is decided, and there is no longer a gap for a
knockout or a replay to arrive in between deciding to flash and flashing —
which is what `pendingFlash` and its re-check in `tick` existed for. A pan
cancelled by a hand on the planet needs nothing either: the flash has already
been and gone by the time a hand can reach it.

`prefersReducedMotion` is read **at play time** rather than latched at startup,
so switching the system setting takes effect on the next turn with nothing
listening for it. `REDUCED_TURN_FLASH` is one slow swell instead of two quick
ones and dimmer, but deliberately still *something*: the request is for less
movement, not for less information. The previews pin the flag off rather than
asking the browser, so the page shows what it says it is showing on a machine
that has reduced motion switched on — the same bargain `coarsePointer` makes
on the hints page.

`fireworks.js` is the other DOM animation over the canvas, and it is the
contrast that makes the paragraph above mean something. It fires on a banner
opening as `'won'` — which `outcomeView` folds a surrender into alongside
running the board out, the right seam because the two are one thing to the
player and the difference between them is a sentence under the title. And
**reduced motion turns it off outright rather than softening it**, which is the
opposite of what the flash does, for the reason the flash gives: the flash
carries the fact that a turn has been handed over and somebody who asked for
less movement did not ask to be told less, while this says nothing the title
does not already say. Decoration is the one thing it is safe to simply not
show.

It is also the one animation in the game that is **not ticked**. Everything
else runs off the session's frame loop because it has to agree with the planet
— a roll lands when the dice land — but a banner has no planet and no loop, and
a spark's whole life is "travel there, fade out", which is what a keyframe is
for. So `play` builds the show as a couple of hundred absolutely positioned
dots with their delays already on them, hands it to the compositor, and clears
it with one timer; no JavaScript runs while it plays. The layer is measured
exactly once, at `play`, which is why it is fired *after* `banner.hidden =
false` — a layer inside a `display: none` banner measures zero, and a show
measured against nothing is dots that travel nowhere.

Two decisions inside `fireworksShow` are worth keeping, and both are about
reading as fireworks rather than as particles. Bursts go off in a **ring**, at
`clear` to `edge` of the way out — an ellipse in percentage space, so it takes
the banner's own proportions, which is right because what it is keeping clear
is a card wider than it is tall. And sparks are laid on **even spokes and then
jittered** by under one spoke, so a burst always covers the full circle;
uniformly random angles clump, and a clumped burst reads as a spill. Both are
what `fireworks.test.js` asserts, along with the two that are really about the
mechanism: nothing lands over the card, and every spark is out before
`duration`, since `duration` is also the timer that empties the layer.

Two constants are shared deliberately and must not be duplicated:
`pips.js` (where the dots sit on a die face) is read by both the 3D dice
texture and the flat SVG dice in the battle readout, and `diceStacks.js`
`stackSlots` (four to a column, then a new column) is read by both the dice on
the planet and the stack marks in the readout. `scripts/lint-conventions.js`
asserts neither has grown a second copy.

### Who owns a press

Two things want every press on the planet — tapping a territory to attack, and
dragging to turn the planet — and `pointerArbiter.js` decides which of them has
it. Presses are handed to the registered handlers **in order**: the first one
keeps a press until it returns `YIELD`, and ownership only ever moves forward,
so a press that has become a drag can never go back to being a tap. `main.js`
registers exactly two, and reading those two lines is the whole of the policy:
`select` first, `orbit` last.

Before this the two ran side by side. The orbit controls turned the planet from
the first pixel, and whether a press had been a tap was worked out at the *end*
from how far it had travelled. That reads the gesture backwards: nothing could
be said about a press until it was over, so nothing could be **shown** about it
either. Now a press is owned while it is still down, which is what makes the
press mark below possible at all — and the planet no longer slides under a
finger that only meant to point at something.

**Arbitration is `stopImmediatePropagation`, and that is why the arbiter is
created before the controls** in `createViewer`. The orbit controls act on the
press they are given, so the only way to hold them off is not to give them one,
and listeners on one element run in the order they were added. The other half
of the bargain is `onAdopt`: a handler taking a press mid-gesture was never
told it started, so `viewer.orbitHandler` hands the controls a press of its own
— a synthetic `pointerdown` at the point the drag has reached — and they take
it from there on their own document listeners. The drag therefore picks up from
where the slop was crossed rather than from where the finger first landed,
which is what a drag threshold always feels like.

Three rules keep the edges honest. **Only a first, primary press can be a
tap**: a second finger is a pinch, so it goes straight to the controls and the
candidate still holding out is handed on before it, in the order they were
pressed. **A press with nothing under it is given up at once** rather than
sitting dead for a slop's worth of travel — pressing the ocean turns the planet
from the first pixel. And **a press already being tracked is not started
again**, which is what lets the hand-off re-dispatch a press without the finger
being tracked twice.

`DRAG_SLOP` is unchanged from the release-time check it replaced — 5px for a
mouse, 6 for a pen, 14 for a finger, which lands on a soft contact patch
several millimetres across and drifts inside it. What changed is *when* it is
consulted: the moment it is exceeded, rather than at the end.

### The press mark

`HIGHLIGHT.pressed` is the territory a finger is on right now, still down. It
answers a different question from every other mark on the board — not "what
could you do here" but "this is the one you are touching, let go and it
happens" — so releasing is a confirmation rather than a guess, and dragging
away is a visible cancel.

It has to be told apart from the pale lift a legal target wears, which is the
mark it will most often be sitting *on top of*, so it is a white lift three
times that one's rather than a slightly brighter version of it, and it outranks
every other mark. `preview/touch.html` puts all five marks on all eight player
colours side by side, which is where that "distinct enough" judgement is made
by eye rather than argued about here; the amount is the one number to turn.

What the mark promises is `createGame`'s `pressActionOn` — `'attack'`,
`'select'`, `'drop'` or nothing — and `clickTerritory` is written in terms of
the same function rather than repeating the rules, so the mark shown under a
finger and the thing that happens when it lifts cannot drift apart. The session
holds the pressed territory, not the game: it is a fact about a pointer rather
than about the match, and nothing about it belongs in a save.

The one press with nothing to mark is a tap on the ocean while holding a
territory. It still has to be *taken* — letting go there is how you put that
territory back down — so it is the one case where a press is owned with nothing
on screen to show for it.

### Cancelling an attack

A declared attack can be taken back for about a second, before its dice come
up. The × sits on the battle readout, and **any press on the planet does the
same thing** — the player is watching the dice they just threw, on the far side
of the screen from the readout, so a window this short has to have no target to
find and hit. Both ways in go through `session.cancelAttack`, which is what
decides whether it is still early enough.

**Nothing in the rules is unwound, because nothing had happened yet.**
`performAttack` runs `reduce` at the declaration but parks the result in
`pending`; `finishAttack` swaps it into `state` when the countdown runs out. So
for the whole animation the live board is still the pre-attack one, and a
cancel is dropping `pending` and putting back the three things declaring an
attack disturbed: the selection, `attackedThisTurn`, and the replay entry.

`attackedThisTurn` is **restored rather than cleared**. A cancelled attack is
not an attack, but the player may have made a real one earlier in the same
turn, and clearing it would report that turn as a pass.

The selection coming back is what makes it an undo rather than a reset: the
fight you cancelled is one press away, not two, because the attacker is back
in your hand.

**The window is load-bearing for game integrity, not just for the save.**
Cancel and re-declare rolls fresh dice, so an offer that outlived *any* of the
outcome becoming visible would be a re-roll button. `cancelWindow(timing)` is
therefore stated as a function of the animation — `aim` plus the fraction of
`roll` before `settleFrom`, less a slow frame's margin — and
`rollTimeline.test.js` pins it by asserting `sampleAttack(cancelWindow(t),
t).settle` is still exactly 0. It is not a tunable constant and must not become
one.

**The bounce is that window made visible**, and it is the reason it is long
enough to use. `settleFrom` had to move from 0.55 to 0.75 of the roll beat to
buy a person time to react — 0.25s of `aim` is not time to see a bar, decide,
and hit it — and dice that simply hang in the air for that extra time look
broken rather than undecided. So the player's throw lands, bounces once and
settles, which takes the same 1.0s it always did. It is on the player's own
throw and nowhere else: `AI_TIMING` and `REPLAY_TIMING` settle early and do not
bounce, because **a throw nobody can cancel has nothing to withhold.** The two
go together and neither is a free choice.

Three things about the shape of it, all of which it got wrong first time and
all of which read as "unnatural" rather than as anything nameable:

- **`travel` is one curve across the whole roll and must not be split at the
  touchdown.** Two eased halves meet with zero slope between them, so the die
  slid, stopped dead on the ground, and set off again — which is the one thing
  a bounce never does. Sliding on through is both simpler and what actually
  happens: a bouncing thing keeps the speed it had, and the die still has
  about 30% of its distance to cover when it first lands.
- **The arcs are parabolas, not sine.** The difference is small in the air and
  obvious at the landing, where a sine comes in soft and a thrown die does not.
- **The bounce's timing is not a second number.** `touchdownAt` derives it from
  the height, because under gravity a hop's time goes as the square root of its
  height — a bounce a quarter as high lasts half as long. Picking the two
  independently is exactly how a bounce ends up looking wrong. It also falls
  out of the arcs that the die leaves the ground at `sqrt(height)` of the speed
  it arrived at, which is the coefficient of restitution, consistent for free
  rather than as a third number to get wrong.

- **The flight ends at `groundedAt`, not at the end of the roll.** The roll has
  two halves and that is the seam: a flight, and then the die on the ground.
  Everything that can only honestly happen against something solid happens
  after it — the tumble braking, the faces resolving — and nothing needing air
  happens after it. Before this the die braked and settled onto its face
  *in mid-air*, which is the same class of thing as the two above.

  **`settleFrom` is one moment wearing three hats and they have to be the same
  moment**: the flight ends, the tumble starts braking, and the faces start
  resolving. Splitting them is how this was wrong twice. It is also where the
  cancel window closes, which is not a coincidence — a die rocks onto its face
  once it has stopped bouncing and not before, so "the answer is not in the
  picture yet" and "the dice are still in the air" are the same statement.
  `groundedAt` and `firstLandingAt` are that arithmetic in one place;
  `touchdownAt` is where the bounce sits inside the flight, and
  `firstLandingAt` is where the flight sits inside the roll.

And the worst of the four, which is about the tumble rather than the arc:
**rotation must not slow to nothing mid-flight and then appear to pick up
again.** `spin` was `easeOutCubic` across the whole roll, which is down to 12%
of its starting rate by the first landing — so the die bounced essentially
motionless and `settle` then swung it onto its face, reading as the rotation
restarting. Nothing is touching a die in the air, so nothing is slowing it
down: `tumbleAt` holds **one rate for the whole flight** and comes off it only
over the settling stretch, where a real die is scrubbing spin off against the
ground. The rate is `2 / (1 + settleFrom)` rather than 1 because the braking
tail covers half the ground a constant rate would, and spending the flight at
that rate is what still lands it on a whole number of turns.

**Do not extend the cancel window by arguing the dice are spinning too fast to
read.** That was proposed once the tumble held its speed, and it is the wrong
reason: the window is not protected by illegibility, it is protected by the
answer not being in the picture at all. While `settle` is 0 the orientation is
`tumble ∘ restQuaternion` — the *stacked* orientation turned about an arbitrary
axis — and has no relationship to the rolled face. That is provable and
testable; "too fast to read" is neither, and it does not survive a screenshot
or a frame-stepped recording. The moment the offer closes is itself observable,
so the last frame before the bar empties is exactly the frame somebody would
look at.

The window can still only move by moving `settleFrom`, since they are the same
number, and the trade is poor: taking it to the apex of the bounce (0.823) buys
**73ms — 7.7% — for 29% less time to land the die on its face**, and the settle
blend has an arbitrary rotation to cover, so compressing it is how the landing
gets a snap in it.

What makes the impact read, now that speed no longer marks it, is that the die
**changes the axis it tumbles about** when it lands (`bouncedAxis`). Carrying
on about the very same axis reads as having passed through the ground. It is
**composed onto what has already been turned rather than switched to** — a
switch would snap the die to a different orientation on the frame it lands,
which looks like a dropped frame rather than an impact — so the orientation
carries straight through and only the direction of turning changes. It is off
for throws with no bounce, which is the whole of what keeps the AI's and the
replay's dice as they were.

The save needs no new timing. `saveOutcome` still writes the post-attack board
the instant the attack is declared, which is what stops a player reading the
dice and reloading; the `cancelled` handler simply writes over it with the
board as it stands. Written there rather than left to the `change` that follows,
for the reason `saveOutcome` exists at all — that is the moment the truth about
the match changed.

`replay.dropLast` unwrites the entry, and takes the elimination tagged onto it
with it. Safe because a cancel can only ever be the last thing recorded — the
board is held behind a pending attack, so nothing else can have been written
since, the same argument `recordElimination` makes. At `REPLAY_LIMIT` there is
one loss and it is not a correctness one: if that entry's own `record` pushed
the log over the cap, the oldest move was folded into the anchor and popping
does not unfold it, so the replay still rebuilds exactly the right board, one
move shorter of history than it could have been.

**Cancelling an attack is not a third entry in the arbiter.** It is another
thing a tap can mean, so `selectPress` asks it first, before it asks what is
under the press. It was a handler of its own in front of `select` for exactly
as long as it took to try it, and that **stops selection working entirely**: a
handler that yields on `onDown` hands the press over through `onAdopt`, which
`select` does not implement and which `handOn` ignores the return of anyway —
so every press arrived owned but never started, and nothing on the board could
be picked up. `pointerArbiter.test.js` states both halves of that so it cannot
be re-introduced, and it is why `orbitHandler` — the one thing genuinely
behind another — carries an `onAdopt` that synthesises the press it never saw
begin.

**Only a tap cancels, and that is why the press is held rather than answered
on the way down.** Turning the planet is reading it, and a player who reaches
for the planet mid-throw is looking at the board rather than changing their
mind about it — so `onDown` only asks whether there is anything to cancel
(`canCancelAttack`) and keeps the press, `onMove` hands it to the camera past
the slop exactly as it always would, and `onUp` is where the cancel actually
happens. Answering on the press instead meant a pan cancelled the attack under
the hand that was only trying to look at the board.

The tap is then **swallowed rather than passed on**. Falling through to the
rest of the release would let one press cancel the attack and — since
cancelling puts the attacker back in the player's hand — immediately declare
another one on the same target, the exact opposite of what pressing it meant.

**The two halves of a fight land a beat apart.** The attacker's dice come to
rest, and `stagger` later the defender's do — a fight's two totals are not
equal things, the attacker's is a number and the defender's is the answer, and
landing both at once makes the reader do the reading and the subtraction in the
same moment. It is the player's own fight only, like the bounce and for a
related reason: this is the fight worth dramatising, and a quarter of a second
on every AI attack is a turn that crawls.

It costs nothing in safety and *cannot*: the attacker's dice are untouched, so
the earliest anything can be read is exactly where it was, and the outcome —
which needs both halves — now arrives strictly later than it used to.
`cancelWindow` is measured off the attacker's clock for that reason and does
not mention the stagger. `attackDuration` does, since the defender's dice are
the last thing to come to rest and that is what "over" means.

**Once the cancel window has shut, a press skips the rest of the wait**
(`canFastForward`). An attack past that point is a thing the player is only
*waiting* on: the board it lands on is decided and already saved, and the
animation is the last second of a move they have finished making — so making
them sit through it to pick their next attacker is making them wait for
nothing.

The mechanism is one line in `pressActionOn`: **the board a press is answered
against is `pending ?? state`** — the board it will land on rather than the one
still being shown. The dice are decided, so a press answered against what is on
screen would act on a board that no longer exists by the time the finger comes
up. `clickTerritory` then lands the attack before carrying the answer out, and
nothing about the move changes; it simply stops being watched.

That is also what makes the press **pick the territory up as well as skip the
wait** — one press to be playing again rather than one to stop watching and
another to act — and it works on the territory just captured as readily as on
any other, since by the board being answered against it is already theirs.

Two waits are deliberately not skippable. A **payout** is the turn ending and
there is nothing for the player to do into it, and an **AI attack** is not
theirs to be waiting through — both fall out of `canFastForward` requiring a
pending attack on the human's own turn.

The toast (`CANCELLED_TOAST`, "You canceled the attack") is past tense and
names *you* as the one who did it, because the one thing it must not read as is
the move having been *rejected* by the game. It is not ticked — it has no
planet to agree with — so it runs on a timer, the same argument `fireworks.js`
makes, and it sits at the top of the transient band above the controls rather
than beside the auto-follow offer and the payout tray: all three are
occasional, any two can coincide, and a row that reflows because two turned up
at once is worse than a column that grows upwards.

It **fades** rather than vanishing, because nothing is waiting on it and it
should leave the way a thing leaves that nobody is watching — a line that
blinks out reads as having been dismissed by something, which invites a look at
what. `hidden` is still what takes it out of the layout, since the band has to
close up behind it, so the class carries the opacity and `hidden` goes back on
a fade later; `--toast-fade` is written from `TOAST_FADE_MS` so the transition
and that delay cannot drift into a fade cut off halfway out. The class also
cannot go on in the same frame the element stops being `display: none` — there
is no layout in between for a transition to start from — hence the frame's
wait.

**Picking a territory to attack with takes it down early.** Its own clock is
the backstop for a cancel nobody followed up on; a player who has moved on
should not have a line about the last attack sitting over the next one. That
makes the order inside `cancelAttack` load-bearing: the attacker goes back in
the player's hand **before** `cancelled` is emitted, because putting the board
back is part of cancelling rather than a consequence of it — announced the
other way round, the cancel's own restore would take down the toast the cancel
had just put up. `createGame.test.js` pins the order for exactly that reason.
### The explainer

`explainer.js` is "How the game works", opened from the menu and drawn over
it. It covers the rules a player can lose a match without ever working out:
that attacking empties the attacker whichever way the fight goes, that the
defender takes ties, that a one-die lead is worth far less between big stacks
than small ones, that income is paid on the largest *connected* region, that
the payout scatters where it likes, and that what will not fit is banked.

It is **not a tutorial** and deliberately says nothing about which button to
press — `attackHintView` says that once, on the first turn, which is when it
is worth saying. This is for somebody who has played a few games and wants to
know why they keep losing.

An overlay in the same page rather than a page of its own, for two reasons
pointing the same way: `assert-deployable` holds the deployed site to one
page, and a player reading this mid-match should be handed their match back
rather than a fresh one. It opens over the menu and the menu stays open
underneath, which is also the whole of the pause — `main.js` already stops
ticking the session while `menu.isOpen()`.

The content is **data rather than markup** (`EXPLAINER_SECTIONS`), so the
document can be checked without a browser: that every section has something to
read and something to look at, that every figure is of a kind there is a
builder for, and that the tie figure is actually a tie.

**The odds are read out of `winProbability` rather than typed in.** They are
exactly the numbers core deals, so a change to the rules moves the document
with it — and the two claims the figures make are asserted against core rather
than against the prose: every even fight comes out under half, and the one-die
lead decays monotonically from 84% at two against one to 67% at eight against
seven.

Those figures are a **labelled table with bars** rather than a chart, and that
is a deliberate demotion: every value is printed, which a chart should not do,
but there is no axis and no hover here to carry them instead and this is as
much a thing to look a number up in as a shape to read. The bars are neutral
because **every saturated colour in this game names a player** — a coloured bar
in a figure about nobody in particular reads as somebody's. The track is the
full 0–100%, since a percentage drawn on a cropped scale is a lie about its own
size, and the even-stacks figure carries a dashed half-way mark because what it
is showing is that every bar falls short of it.

The UI figures are the **real components** — `dieChip` for the dice, and
`createPlayerTile`/`paintPlayerTile` for the banked-dice badge. That tile was
a closure inside `createHud` and is now exported for this, which is the whole
of that refactor: a tile the explainer built for itself would be a second copy
of the markup, free to drift from the one on screen. Only the *shape* is
shared — every number and state class still arrives through `playerPanelView`.

**The 3D figures are committed PNGs, not live planets.** A document with five
WebGL contexts in it costs more than it explains, and half of them are
before-and-after pairs meant to be read against each other rather than turned.
`EXPLAINER_CAPTURES` is the contract: `preview/figures.html` shoots one picture
per entry, a test asserts the list and what the sections ask for agree, and the
page itself banners any entry it has no recipe for.

Two things follow from a picture being a committed file. It **goes stale
silently** when the renderer or the generator moves — the same failure the
surrender preview's pinned seeds hit — so the harness pins its seed, builds its
boards by hand, aims a fixed camera with the orbit controls *disabled*, and
saves at exactly 600×400 whatever screen took it: re-shooting gives back the
same pictures rather than similar ones, in one press. And the pictures can
simply be **absent** — a fresh clone is in that state — so a capture that fails
to load is replaced by a dashed box naming the shot it is standing in for,
which is a document with its pictures pending rather than a broken page. The
files live in `packages/planets/public/explainer/`.

The payout figure is not staged: it runs `reduce(state, endTurn())` with the
rng pinned, so where those dice land is genuinely where the game scatters them
— including onto the two stranded territories that earned none of them, which
is the entire point of the picture.

### The title screen

The menu with no match behind it, which is what somebody opening the game for
the first time gets — and until now was a settings dialog over a black screen.
`menuActionsView` decides it (`brand`), and it is the same question the rest of
that function asks: a menu with nothing to resume has no board to cover up, so
it wears the name and lets what is behind it through. From inside a match it is
the ordinary dialog, blur and all, and the name goes back to being the panel's
own quiet heading.

`menuBackdrop.js` is what is behind it: **a real planet, generated and played
rather than drawn.** The alternative is a committed picture, and
`EXPLAINER_CAPTURES` is the record of what that costs — a file that goes stale
silently the day the generator or the renderer moves, on the one screen
everybody sees first. It costs about 35ms: 20ms to grow a world and under 15ms
to play it, once, on the open that has nothing else to do. Nothing in it is
seeded, deliberately — the board is never saved, replayed or looked at twice,
so a seed would be a number kept for nobody, and a different planet every visit
is the one claim a title screen is really making.

Four decisions in it are worth keeping.

**It is placed by skewing the frustum rather than by moving the camera.**
Wherever the planet is asked to sit, the camera goes on looking straight at it
and `camera.setViewOffset` renders an offset window of a larger frustum. Moving
the camera instead would have lit it differently and foreshortened it — the
lights are aimed off the camera (`lightRig.js`), and every framing decision the
game makes assumes the planet is in the middle of the frame, which is why
`dispose` clears the offset *before* a session frames the planet it is about to
build.

**Where it sits is two numbers**: its middle on the right edge of the window,
the top of it `top` of the way down, and the furthest left it comes in frame at
`reach` across the page. The same two whichever way the window is turned — what
differs is their values, `wide` against `tall`.

`top` is the one both windows have to honour, and it is why `reach` can be
negative. `wide` is a planet rising out of the bottom right corner, a quarter of
the way down and half of the way across. `tall` is a much bigger planet: a panel
the full width of the window leaves only the band above it and the band below,
and what fills those is a planet that runs *past* the left edge rather than
stopping short of it. It still has to crest under the top of the screen — the
top of a globe is most of what says it is one, and a disc overrunning the top
edge as well as the bottom is a coloured wall — and it crests far higher than
landscape's quarter, because the band between the title and the panel is the
only clear sky a phone has. On the shortest phone there is, nothing is left over
to centre the panel in and it starts about 70px down, so a crown much below that
is behind it and a quarter of the way down is behind it on every phone.

**The radius is solved for rather than picked** (`radiusReaching`), because a
radius that looks right on 16:9 is a different fraction of the next window:
chosen for a desktop it reaches nothing like halfway on an ultrawide and a third
of the way on a 4:3, so the two things being asked for would only hold at one
aspect.

It is **two cases, and which applies is geometry rather than orientation.** A
disc is widest at its own middle, so normally the leftmost point in frame is
simply the radius left of the right edge — that is the portrait answer, and it
is what lets a negative reach mean anything at all. But a planet big enough to
put that middle below the bottom of the window is never seen at its widest: the
furthest left it gets in shot is where its edge crosses the bottom edge, and it
takes a *larger* radius to reach as far. That is the landscape answer, and it is
the sagitta relation on the two points the numbers name. `distanceForDisc` in
`cameraFraming.js` is how far back either puts the camera — the same trig
`framingDistance` was already doing, now said once and used from both ends of
its range.

That radius is then **read back off the distance rather than used as asked**,
because `nearest` can refuse it. `wide` is a statement about the width and the
frame is a fixed lens, so a window wide enough asks the camera closer than the
orbit controls will go (`minDistance`, 1.5) — an ultrawide asks for 1.22, where
the horizon is 35° off and there is barely a handful of territories in shot. A
16:9 window sits at 1.67, so nothing ordinary is touched; past about 1.9:1 the
planet quietly stops growing. Placing from the radius that will actually be
*drawn* is what keeps the anchor honest there: placing from the one that was
wanted gives a clamped window a planet both smaller and sitting lower than the
anchor says.

**Which way round it starts is searched for** (`aimSpin`), because the corner
this is framed in shows a fifth of the planet at most, and two things can go
wrong with a fifth taken at random. Two fifths of a planet is ocean, so an
unaimed backdrop deals a dark blue basin often enough to matter. And by the
time a leader holds a third of the planet — which is where `lead` stops the
match, "midway" being a property of the picture rather than a count of turns —
they can hold the whole of the visible face, and a face that is one empire
wall to wall says nothing about a planet being fought over. The blue player's
does not even read as land. So `faceScore` is the sum of the square roots of
what each player holds in frame: steep where somebody has a territory or two
and flat where they have plenty, so a second colour is worth more than a tenth
territory of the first. It is a search rather than an aim point because the
window is a corner of the frame rather than a cone about the view axis — there
is no direction to average towards that means "in shot" here.

It turns slowly, about three and a half minutes to the revolution, which is
also slow enough that the face `aimSpin` picked is still most of what is on
screen for as long as anybody is looking. Reduced motion stops it outright
rather than slowing it, on `fireworks.js`'s argument rather than
`turnFlash.js`'s: this says nothing, so it is safe to simply not show.

One thing about the CSS. The title-screen rules are keyed on `.is-title`
itself rather than on `#menu.is-title`, because the menu is mounted somewhere
else too — `preview/menu.html` puts it in a stage of its own, and a rule that
only reached the overlay would have that page drawing both headings at once.
The scrim is the exception and is keyed on the id, because that one really is
about the overlay.

## Rendering conventions

- The planet mesh gives each cell its own private vertices so a cell can carry
  one flat color. That layout also means a cell owns a contiguous run of
  vertices and triangles, which is what makes both picking (`faceCellIds`) and
  in-place recoloring (`cellVertexRanges`) possible.
- Only recolor what changed, and remember that `needsUpdate` on a three.js
  `BufferAttribute` is **write-only** — it reads back as `undefined`, so
  guarding on it silently skips the GPU upload and the planet keeps whatever
  colors it was first built with.
- The HUD is DOM over the canvas, not text in the scene. `#hud` ignores the
  pointer as a whole; individual controls opt back in, so dragging anywhere
  else still orbits the planet.
- One stylesheet, `src/render/hud.css`, shared by the game and every preview
  page.

## Previews

`/preview/` is a directory of development pages showing each piece of the
interface in every state it reaches, without playing a game to get there. They
use the real components and the real stylesheet — a preview that can drift
from the game is worse than none.

- Pages live in `preview/*.html` with their scripts in `src/preview/`.
- `src/preview/pages.js` is the manifest; the directory page renders from it,
  and tests check the manifest and the folder still agree. `vite.preview.config.js`
  lists them again for the build, so a new page goes in both.
- Two pages name a *specific* match rather than showing a state:
  `surrender.html` plays two seeded games out headlessly, hands each to a real
  `createSession` as a save, and lets the session's own restore path draw the
  planet and the replay. Pinning `rollDie` and `rng` as well as the world seed
  is what makes "the game where the surrender was wrong" a thing that can be
  looked at twice.

  **Both of its matches went stale once, and the way they went stale is the
  point.** A seed is only a match while everything it feeds stays put; the
  terrain rework grew a different planet from the same number, so neither
  pinned game was the game its caption described and neither fired a surrender
  at all. That is checkable at any commit by playing the seeds headlessly.

  It failed *silently and totally*, which is the part worth remembering.
  `readoutFor` dereferenced a `surrender` that was now `null`, and it did so as
  an **argument** to the first `addScenario` call — so the module threw at the
  top level and neither scenario drew. A page that exists to be looked at
  rendered nothing, and `npm run build` did not notice, because compiling a
  preview only catches a break at compile time. Both halves of that are now
  fixed: `readoutFor` prints what the seeds *do* grow when nothing fires, and a
  scenario declares what it `expects` so the page can put a **stale** banner
  over a caption that no longer matches its match. The point is not to keep
  working when a claim goes stale — a caption is prose about a specific game —
  but to say so on the page instead of dying, or drawing a different match
  under the old words.

  The seeds were then re-chosen, by sweeping 3,566 six-player expert matches
  and judging every seat at both tunings: **3,559 firings at the shipped sixth,
  none wrong; 3,568 at a quarter, two wrong** (about one in 1,800). That
  supersedes an earlier re-measurement here which reported zero wrong calls in
  2,726 firings and concluded exhibit 1 had no replacement — it does, and both
  of the two found share the shape the original pair had: they fire early, on a
  field nobody has been knocked out of, on a player who is wide rather than
  deep. `difficulty` in both was repointed from `hard` to `expert` when the
  ladder gained a rung, which keeps the *intent* — the strongest opponent.
- `terrain.html` opens on a pinned seed for the same reason, and the seed is
  chosen to be *typical* rather than damning: its old carving scores 0.317,
  which is the old carver's median. A comparison page that opened on the worst
  case it could find would be an advert rather than evidence.
- `attack.html` is a playground rather than a set of states: a real board that
  **refills itself**, so a throw can be watched as many times as it takes to
  judge one. It exists because the throw is the hardest thing in the game to
  catch in a match — two seconds long, needs a fight to happen at all, and the
  interesting half of it is over in under one — and because `stagger` and the
  bounce height are taste rather than measurement, so they are on sliders with
  the derived numbers (whole throw, when the cancel closes, when the dice are
  down) printed beside them.

  It drives `createGame`, `createHud` and `createRollAnimation` directly rather
  than going through a session, because the board has to be *replaceable* and
  the board belongs to the game: refilling is a fresh `createGame` over an
  edited state rather than a reach into the live one. Two things follow. The
  rebuild waits for the frame loop rather than happening inside `resolved` —
  the old game's `change` is still to come and would repaint the board the
  refill had just replaced. And there is no camera, no saving and no AI here,
  which is the point: a board that keeps playing stops being a fixture.
- `explainer.html` and `figures.html` are a pair: the first is the document
  the menu opens, laid out flat and including the state a clone that has not
  committed the pictures yet is in; the second is where those pictures come
  from. Neither is optional furniture — the explainer is the one piece of
  interface that cannot be reached by playing, and the figures page is the only
  way to take its captures again after the renderer moves.

  Each figure prints what its board actually holds (`describe`), because the
  captions make numeric claims — six held, four of them joined — and a caption
  is prose about a specific board. **Territory ids are numbers**, so an
  override map keyed by an object literal stringifies every key and the edits
  land *beside* the territories they were meant to replace: the board grew past
  its own size, the player held twice what the caption said, and their largest
  joined region was 3. Every picture would have been wrong and every caption
  would still have read as if it were not. Hence a Map, and hence the readout.

  One figure is a match **played** rather than a board arranged: the mid-game
  shot runs `runAiTurn` for ten rounds and photographs whoever ended up with a
  full interior and a ragged front. That is not a position anyone would think
  to build, which is the point — staging it would be drawing the conclusion
  rather than finding it. It needs nothing extra pinned to be reproducible,
  since `createExpertStrategy` carries no rng of its own, so the dice and the
  scatter are the only chance in it.

  Two things about the staged empire are worth keeping. It is **small — four
  joined and two stranded** — because the point of the figure is the *gap*, and
  a gap you have to turn the planet to see is not a picture of anything. And
  the stranded pair sits **exactly two steps out**, one territory of somebody
  else's ground away: further and it leaves the frame, adjacent and it is not
  stranded. Two steps is the nearest a territory can be and still be plainly
  cut off.

  The camera distances are **derived, not chosen** (`distanceShowing`): a
  capture is always saved at one size, so the frustum is known exactly, and
  `visibleAngle` answers how far back to stand to fit a given spread. A
  hand-picked distance is one more thing that quietly stops being right when
  the seed or the renderer moves.
- `replay-perf.html` is the odd one out: numbers rather than a component. It
  plays real matches and puts them through the real save path against real
  `localStorage`, under a key of its own so a game in progress is never
  overwritten. A stub store would time nothing worth knowing — `setItem` is a
  synchronous main-thread write and its cost is the whole reason a save's size
  matters. It reports rather than asserts, for the same reason the conventions
  lint is not in `npm test`: a wall-clock budget cries wolf on a slow machine.
- Preview CSS styles the caption, never the exhibit. A descendant selector
  rooted at the preview's own furniture (`.scenario p`) outranks the game's own
  rules on specificity and will silently restyle what the page exists to show.
  Use `>`. The conventions lint checks this.

**Previews are never deployed.** `npm run build` puts the site in `dist/`,
asserts nothing preview-shaped got in (and that `index.html` is the only page),
then compiles the previews separately into `dist-preview/` purely so a break
fails the build.

`dist/` is what gets published, and **pushing to `main` publishes it** — the
`deploy` job in `.github/workflows/ci.yml`, which runs after the tests and the
build and uploads the artifact that build made rather than building a second
time, so the bytes served are the bytes checked. The repository's Pages source
has to be *GitHub Actions* rather than a branch.

The site's `base` is **relative** (`./`), so one build works at the root of a
domain and under a repository path — a project site is served from
`/dicewars-planets/`, where a root-absolute asset URL resolves off the top of
the domain instead. Hard-coding that path would break on a custom domain, and
would make a local build differ from the deployed one. What it costs is one
rule: **anything reaching for a file by URL goes through
`import.meta.env.BASE_URL`, never a leading slash.** `explainer.js`'s pictures
are the only place in the game that does, and the failure if that regresses is
the quiet kind — every capture 404s and the document draws its "capture
pending" boxes on a deployment that has the files.

## Testing style

Tests are written to say what the code should do and why, not to restate the
implementation. A few patterns worth continuing:

- Prefer testing a claim the implementation does not itself guarantee — e.g.
  `readableTextColor` picks the better of two inks, and the test asserts the
  better one actually clears WCAG AA across the whole palette.
- When fixing a bug, check the new test actually fails against the old code.
- Shared fixtures live in `packages/core/test/support/` — `seededRng`,
  `rollsOf`, `chainState`/`chainWorld`. Planets reaches them through the
  `@dicewars/core/test-support` export, so there is one seeded generator in the
  repo rather than one per test file.
- **A test that plays a whole match out has three sources of chance to pin, and
  only two of them are in `deps`.** `rollDie` is the dice and `rng` is where
  reinforcement scatters; the third is the AI's own tie-break jitter, since
  `createGame` defaults its opponent to `createSimpleStrategy()` and that closes
  over an `rng` of its own which is `Math.random` unless it is given one.
  Pinning the first two and stopping measurably changes nothing — 6.7% of runs
  deadlocked either way, over 258 different matches in 300 runs — where pinning
  all three gives one match every time. Verify by asserting there is a single
  distinct *outcome* over many runs, not by counting green ones: at that rate,
  twenty clean runs happen a quarter of the time by luck, which is how a
  previous attempt at this was recorded as fixed when it was not.

## Conventions lint

`packages/planets/scripts/lint-conventions.js` holds the checks that read the
source as *text*: a class agreeing with the stylesheet that makes it visible, a
shared constant not having grown a second copy, a preview not restyling its own
exhibit, the CSS invariants behind the layout.

These deliberately do **not** live in `npm test`. They are coupled to how the
code is written rather than to what it does, so a rename or a reformat can fail
one without anything being broken — and a test suite that cries wolf stops
being read. `npm run build` runs them, so the site still cannot be built after
drifting.

The file is in two halves. The structural checks guard things nothing else
connects. The appearance checks assert exact CSS declarations and are the
brittle ones; the right home for them is a couple of headless-browser layout
assertions, and when that exists that block should go rather than grow.
