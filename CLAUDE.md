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

The `difficulty` setting picks between the first and the last: Normal is
`createSimpleStrategy`, Hard is `createExpertStrategy`, and `strategyFor` in
`settings.js` is the whole of the mapping. A save carries its settings, so a
match started on Hard is finished on Hard.

The defensive one is not offered. It is the translated legacy AI, kept because
it is a second opinion to measure against, and at the default six players it is
genuinely weaker than Normal: 45.2% against it, over 1,008 games. **But that
ordering is not stable across the table size.** Two-handed it wins 36.5%, and
eight-handed it wins 53.3% — the same two AIs, the same planet generator, and
the stronger of them depends on how many are sitting at the table:

| players | defensive vs simple |
|---------|---------------------|
| 2       | 36.5% ±3.0          |
| 6       | 45.2% ±3.1          |
| 8       | 53.3% ±3.1          |

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

Three things about the expert are worth knowing before touching it.

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
  banked dice, the replay, whether a surrender has already been waved away —
  is stored outright.

  That trade has exactly one failure mode: change the generator and the same
  seed grows a *different* planet. Hence `worldFingerprint`, a hash of the
  territory graph and the cell-to-territory mapping, checked against the world
  the seed just rebuilt. Note that territory ids are list positions (`0`, `1`,
  `2`), so comparing ids would pass for any two planets that happen to have the
  same number of territories — which is why the fingerprint hashes shape rather
  than names. A mismatch discards the save and deals a fresh game.

  Saving happens on every `change` event rather than on a timer or on
  `pagehide` (which is not reliable on mobile). An attack that is still being
  animated is deliberately *not* saved: the state it will land on has not been
  applied yet, so a reload mid-roll un-throws those dice rather than storing
  half a battle.

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
  names (`difficulty` is `normal`/`hard`), and there is no nearest `hard`, so
  those normalize by membership and anything else is simply the default.

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
match is held behind them until they are answered (`interrupt` in
`session.js`). Without it the AIs went on taking turns underneath: you were
told you were out while the planet carried on being carved up, and dismissing
the banner dropped you into a board several turns past the one it went up
over. Both banners are questions, and a question that goes stale while it is
being asked is worse than not asking it. Holding outright is safe because both
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
actually *ended* — `lastOutcome` is set for a win and a surrender and
deliberately not for a knockout, since a game carrying on without you has no
ending screen to return to and "You are out" is a question already answered.

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

A swing is paced by distance and capped at 0.55s, which is shorter than an AI
attack's aim-plus-roll, so the camera has arrived before there is anything to
read. A hand on the planet cancels it outright — a wheel zoom doesn't, since
that says nothing about where to look, and the swing keeps whatever distance
the player lands on.

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

Two constants are shared deliberately and must not be duplicated:
`pips.js` (where the dots sit on a die face) is read by both the 3D dice
texture and the flat SVG dice in the battle readout, and `diceStacks.js`
`stackSlots` (four to a column, then a new column) is read by both the dice on
the planet and the stack marks in the readout. `scripts/lint-conventions.js`
asserts neither has grown a second copy.

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
fails the build. Point GitHub Pages at `dist/`.

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
