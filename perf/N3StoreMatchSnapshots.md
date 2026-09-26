# PR 598 reader snapshot review

The September 25 review comment concerns freezing active readers with
`[...this._sourceIterator()]`. This reconstructs every matching quad and its
terms during a parent mutation, including the prefix readers already consumed.
It can also invoke a custom factory while notifying mutation observers.

The observer and pattern-intersection design remains appropriate for the agreed
semantics. Notifications must precede mutation to preserve snapshot contents;
forwarded descendants must observe the root under their combined pattern. Weak
observers prevent discarded views from being retained. These mechanisms are kept.

The reader implementation is rewritten:

- Freeze a flat numeric ID array in the original SPO, POS, or OSP traversal order.
  No RDF factory calls occur during capture. Resume directly at the reader's
  offset, constructing only the quads it consumes.
- Readers of the same unchanged source share a reader-group object. After a
  freeze, only their iterator frames retain that group. This replaces the
  generation map and its counters, and lets abandoned readers' snapshots be
  collected even while the view remains alive.
- Route non-lazy `toArray()` calls through stable iteration. Previously, a
  factory that mutated the parent could make `toArray()` omit snapshot contents.

Lazy defaults, snapshot timing, forwarding constraints, nested semantics,
independent detachment, and the no-observer mutation path are preserved. Capture
still takes O(matching quads) time and space. Eliminating that scan would require
a broader persistent-index or copy-on-write design, with additional costs on the
ordinary store mutation path.

Copying only the selected matching SPO, POS, or OSP index is also a valid
snapshot representation. The indices are nested JavaScript objects; a shallow
copy would still share mutable branches, so those branches must be copied or
protected with copy-on-write. A copied index can share subject/predicate prefixes
within its tree, whereas the flat array repeats four IDs per quad. The array
provides direct resumption at `4 * yielded` for each reader; an index snapshot
would need a cursor or a traversal that skips the consumed prefix without
constructing terms. This comparison benchmarks the array against the previous
quad-array implementation, not against a copied index. It does not establish
which of those two ID-only representations is faster or smaller.

## Measurements

Baseline: PR head `c8abee037bb65d2cce0068f7cf4460717bb0c427`.
Comparison: this working implementation, using identical esbuild Node bundles.
Runtime: Node 25.1.0, Darwin 27.0.0, arm64. Measured September 26, 2026.

`N3StoreMatchSnapshots-perf.js` runs seven rounds in fresh processes in ABBA order,
with three warmups per scenario and GC between samples. An event-loop turn
between samples lets weak-reference targets become collectible. Each timing
store contains 8,192 quads. Iteration samples yield 262,144 quads; mutation samples
perform 16,384 operations; freeze samples capture 16 snapshots. The heap sample
measures retained memory after freezing one reader over 32,768 quads, after GC.

Ratios below are the median of each round's paired after/before ratio, not the
ratio of independently computed medians. Lower is better.

| Scenario | Median ratio | Paired range |
| --- | ---: | ---: |
| Lazy full iteration | 1.17 | 0.39–1.57 |
| Snapshot full iteration | 0.98 | 0.65–1.21 |
| Forwarded full iteration | 1.04 | 0.86–1.66 |
| Mutations without observers | 1.08 | 0.70–1.58 |
| Mutations with 64 non-matching observers | 0.89 | 0.72–1.35 |
| Snapshot freeze, unmaterialized | 0.82 | 0.61–1.22 |
| Forwarded freeze, unmaterialized | **0.64** | **0.49–0.87** |
| Forwarded freeze, materialized | **0.45** | **0.28–0.51** |
| Forwarded freeze and complete remaining iteration | 0.83 | 0.59–1.44 |
| Forwarded freeze with embedded quad objects | **0.20** | **0.13–0.25** |
| Retained snapshot heap | **0.33** | **0.329–0.331** |

Forwarded freeze latency and retained memory improved in every paired round.
Median retained heap decreased from 3,541,984 to 1,171,248 bytes. Other timings
were noisy and crossed parity; they do not establish an overall throughput
improvement or regression. The deterministic factory-spy tests separately
verify that capture constructs zero terms or quads, and that resuming does not
reconstruct an already-consumed prefix.

To reproduce, build the baseline and working tree against the same dependencies:

```sh
benchDir=$(mktemp -d)
mkdir "$benchDir/base"
git archive c8abee037bb65d2cce0068f7cf4460717bb0c427 | tar -x -C "$benchDir/base"
ln -s "$PWD/node_modules" "$benchDir/base/node_modules"
node_modules/.bin/esbuild "$benchDir/base/src/index.js" --bundle --platform=node --format=cjs --outfile="$benchDir/before.cjs"
node_modules/.bin/esbuild src/index.js --bundle --platform=node --format=cjs --outfile="$benchDir/after.cjs"
node --expose-gc perf/N3StoreMatchSnapshots-perf.js "$benchDir/before.cjs" "$benchDir/after.cjs" 7
```

## Validation

- `npm test -- --runInBand --roots src test`: 7,097 tests pass; 100% statements,
  branches, functions, and lines.
- `npm run lint` and `npm run build`: pass, including both browser bundles.
- `node perf/N3StoreMatchSemantics-perf.js 32`: all scenario assertions pass.
- Regression coverage includes every binding mask, materialized and
  unmaterialized reads, sparse graphs, nested quad terms, custom factories,
  overlapping reads, stream destruction, and abandoned-reader collection.
