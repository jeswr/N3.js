# Numeric array versus copied-index snapshots

## Assessment

Retain the numeric array for PR 598. A copied index is viable and can save
substantial memory on densely populated index branches, but it is not a general
improvement. Its memory cost varies sharply with data shape, and resuming readers
requires enumeration and skipping that the array avoids. The candidate does not
provide a meaningful reduction in code complexity.

The comparison uses the array implementation in `2c12f506e7703a4f7a20354da0f59eac6a0649ce`
and [this alternative implementation](fixtures/N3Store-index-snapshot.patch).
Only `snapshotMatch` and `iterateSnapshot` differ. The production implementation
has not been changed by this experiment.

## The copied-index candidate

The candidate uses the existing `indexMatch()` helper to deep-copy only the
matching portion of one index per graph. It chooses the same SPO, POS, or OSP
index as the active reader, preserving traversal order. It does not copy all
three indexes or construct any RDF terms during capture.

On resumption, it skips complete leaves using their existing `SIZE` counters,
then skips within the first unread leaf before constructing terms. Upper-level
`SIZE` counters count immediate child keys, not quads, so they cannot be used to
skip entire graphs or subject branches. It constructs no skipped quads. An
independent review and the store tests verified these properties.

## Performance

Ratios are **copied index / numeric array**; lower is better. Capture measures
the parent mutation that freezes the active readers. Resume measures consumption
of the remaining quads. Total is capture plus resume. Heap is the incremental
retained heap after that mutation and a forced GC; for snapshot mode it also
includes the materialized view that both implementations must create.

### 32,768-quad stores

| Scenario | Capture | Resume | Total | Retained heap |
| --- | ---: | ---: | ---: | ---: |
| Dense, first quad consumed | 0.71× | 2.13× | 1.47× | 0.27× |
| Dense, 99% consumed | 0.72× | 9.59× | 1.07× | 0.27× |
| Balanced, first quad consumed | 1.08× | 1.54× | 1.37× | 2.17× |
| Balanced, 99% consumed | 0.80× | 4.10× | 0.89× | 2.14× |
| Sparse, first quad consumed | 1.37× | 4.57× | 2.01× | 23.02× |
| Sparse, 99% consumed | 1.45× | 68.19× | 1.96× | 22.46× |
| Many graphs | 0.94× | 1.44× | 1.23× | 1.94× |
| Bound graph (256 matches) | 0.82× | 1.18× | 1.06× | 2.07× |
| Predicate-bound / POS | 0.48× | 1.50× | 1.06× | 0.34× |
| Object-bound / OSP | 0.67× | 1.51× | 1.17× | 0.42× |
| Selective subject (64 matches) | 0.99× | 1.28× | 1.09× | 2.98× |
| Materialized forwarded view | 0.95× | 1.56× | 1.29× | 2.17× |
| Snapshot view | 0.91× | 1.51× | 1.02× | 1.07× |
| Three overlapping readers | 0.93× | 1.46× | 1.28× | 2.17× |
| Nested quad objects | 0.83× | 1.06× | 1.02× | 4.40× |

### Scale check: 8,192-quad stores

| Scenario | Capture | Resume | Total | Retained heap |
| --- | ---: | ---: | ---: | ---: |
| Dense, first quad consumed | 0.68× | 2.07× | 1.53× | 0.27× |
| Dense, 99% consumed | 0.40× | 3.74× | 0.48× | 0.27× |
| Balanced, first quad consumed | 0.62× | 1.40× | 1.00× | 1.90× |
| Balanced, 99% consumed | 0.51× | 2.46× | 0.57× | 1.81× |
| Sparse, first quad consumed | 1.50× | 3.80× | 2.05× | 20.75× |
| Sparse, 99% consumed | 1.51× | 40.25× | 1.99× | 18.30× |
| Predicate-bound / POS | 0.44× | 1.77× | 1.23× | 0.28× |
| Object-bound / OSP | 0.30× | 1.89× | 1.06× | 0.31× |

The important tradeoffs are:

- **Dense data:** the tree keeps shared subject/predicate prefixes once. At
  32,768 quads, retained heap was approximately 303 KB versus 1.12 MB for the
  array. Capture was faster, but full resumption took about twice as long.
- **Sparse data:** one quad per subject creates many small objects in the
  copied tree. At 32,768 quads, the measured heap increment was 25.16 MB versus
  1.09 MB for the array. Capture and reading together took about twice as long.
- **Late readers:** copying an index does not give direct access to an ordinal
  offset. At 32,768 sparse quads and 99% already consumed, the first resumed
  result took approximately 5.05 ms with the copied index versus 0.008 ms with
  the array. For the dense case, enumerating a large leaf's keys took about
  0.715 ms versus 0.009 ms. These are absolute costs, not just large ratios
  caused by a small denominator.
- **Scaling:** the copied index's dense/late total-time advantage at 8,192
  quads did not persist at 32,768. Memory advantages on dense shapes and memory
  penalties on sparse shapes persisted at both sizes.

Some small/selective timings and the snapshot-mode total crossed parity across
paired rounds. They should not be read as established performance differences.
Memory deltas for small matches can also be sensitive to GC noise. The raw
samples and all paired ranges are included in the results file.

## Code complexity

Both variants have **58 nonblank, non-comment lines** across the two snapshot
helpers. Including comments and blank lines, the array has 67 lines and the
copied-index candidate has 62. These counts exclude the existing `indexMatch`
helper, which the candidate reuses and the library already needs elsewhere.

| Concern | Numeric array | Copied index |
| --- | --- | --- |
| Capture | Dedicated nested traversal, remapping IDs into S/P/O/G order | Shorter capture using the existing matching-index copier |
| Resume | Direct `4 * yielded` offset; one loop with term caches | Three-level traversal, leaf counts, skipped prefixes, and deferred term construction |
| Retained representation | Four IDs per matching quad | Prefix sharing, plus an object for each copied branch |
| Resumption cost before constructing a quad | Constant-time offset lookup | Visits preceding leaves and enumerates the first unread leaf |
| Additional state | Reader group and array | Same reader group, cloned graph indexes, and index-order metadata |

The copied version shifts complexity from capture to resumption. It is readable,
but does not remove the need to preserve traversal order or track each reader's
position. Adding descendant counts or a resumable index cursor could improve
late-reader behavior, but would be another implementation with more state and
would need its own measurements. This experiment evaluates the simple copied
index that reuses the current store helpers, not every possible tree design.

For a workload dominated by long-lived, dense snapshots that are rarely drained,
the copied index's memory advantage could justify choosing it. For the library's
general-purpose behavior, the array offers more predictable memory use and
faster resumption, without a larger implementation in substantive lines of code.

## Method and reproduction

Runtime: Node 25.1.0, esbuild 0.28.2, Darwin 27.0.0, arm64. Measured September 26,
2026. Each dataset size used seven ABBA rounds in fresh processes, for 56 worker
processes overall. Each worker ran 15 scenarios with four warmup cycles and eight
measured cycles. Each cycle opened fresh readers, forced GC before capture,
measured capture and resume separately, then allowed an event-loop turn so
weak-reference targets could become collectible. Timing runs were sequential.

Each reported ratio is the median of the seven paired ratios. Each paired ratio
compares the average of the two index samples with the average of the two array
samples in that round. It is not the ratio of two independently calculated
medians. Heap has one measurement per scenario per worker, paired in the same way.

Dense means one subject/predicate leaf containing all objects. Balanced means
64 quads per subject, four predicates, and 16 objects per leaf. Sparse means one
quad per subject. The graph fixture has 256 quads per graph. The selective subject
and bound graph scenarios match 64 and 256 quads respectively, even in the larger
store. Predicate/object cases select POS/OSP indexes. Most cases pause after one
quad; late cases pause at 99%, and the shared-reader case pauses at one quad,
50%, and 99%. All capture mutations delete a matching quad; setup and restoration
are excluded from timing. Before timing, the harness checks the complete ordered
remaining sequence. Timing loops also check result counts.

The harness is [N3StoreSnapshotRepresentations-perf.js](N3StoreSnapshotRepresentations-perf.js).
The machine-readable results, including every worker sample, are
[N3StoreSnapshotRepresentations-results.json](N3StoreSnapshotRepresentations-results.json).

```sh
repoDir="$PWD"
benchDir=$(mktemp -d)
mkdir "$benchDir/array" "$benchDir/index"
git archive 2c12f506e7703a4f7a20354da0f59eac6a0649ce | tar -x -C "$benchDir/array"
cp -R "$benchDir/array/." "$benchDir/index/"
patch -p1 -d "$benchDir/index" < perf/fixtures/N3Store-index-snapshot.patch
ln -s "$repoDir/node_modules" "$benchDir/array/node_modules"
ln -s "$repoDir/node_modules" "$benchDir/index/node_modules"
node_modules/.bin/esbuild "$benchDir/array/src/index.js" --bundle --platform=node --format=cjs --outfile="$benchDir/array.cjs"
node_modules/.bin/esbuild "$benchDir/index/src/index.js" --bundle --platform=node --format=cjs --outfile="$benchDir/index.cjs"
node perf/N3StoreSnapshotRepresentations-perf.js "$benchDir/array.cjs" "$benchDir/index.cjs" 7 8192 > "$benchDir/results-8192.json"
node perf/N3StoreSnapshotRepresentations-perf.js "$benchDir/array.cjs" "$benchDir/index.cjs" 7 32768 > "$benchDir/results-32768.json"
```

## Validation

The copied-index implementation passed all 7,097 tests with 100% statements,
branches, functions, and lines, plus Node and both browser builds. Its source
passes the repository's ESLint rules. The array implementation at the comparison
commit had already passed the same checks. Both variants passed every ordered
tail and result-count assertion in all benchmark workers. Repository lint passes
with the new harness, and the candidate patch applies cleanly to the comparison
commit.
