# RDF4J-style provenance implementation

Target: PR #672 commit `6ae0e5ee2658554621345be66b691a3e80b154d6`.

## Architecture

The implementation replaces the parser's `WeakMap<Term, Span>` with two
independent event streams:

1. `onToken(token, start, end, sourceId)` records the lexical stream in a
   packed `TokenLog`.
2. `onQuadOrigin(quad, subjectId, predicateId, objectId, graphId)` records a
   fixed-width semantic occurrence row.

The parser carries four integer occurrence IDs beside its existing
subject/predicate/object/graph state. Context frames carry the same four IDs,
so subject reuse, lists, blank nodes, graphs, paths, formulae, triple terms,
annotations, and explicit quantifiers preserve occurrence rather than term
identity. Synthetic components use ID `-1`.

`ProvenanceIndex` stores occurrence rows in a `Uint32Array`. A value-keyed map
points to an integer for the common one-utterance case and allocates an array
only for duplicate utterances. Public `{ start, end, line }` ranges are created
only when `get` or iteration is requested.

The parser never mutates an RDF/JS term and no term is used as a provenance
key. Frozen and interned custom factories therefore retain distinct locations
for separate occurrences of the same object.

## Consumer surface

```js
const { quads, provenance, tokens, prefixes } =
  new ProvenanceParser(options).parse(input);

const utterances = provenance.get(quads[0]);
const firstSubjectRange = utterances[0].subject[0];
const rawSubject = input.slice(firstSubjectRange.start, firstSubjectRange.end);

for (const token of tokens) {
  // token: { id, type, line, start, end }
  const rawLexeme = tokens.lexeme(token.id);
}
```

Advanced consumers can subscribe to `Parser`'s two events directly and choose
their own retention strategy.

## Correctness

- All 19 submitted provenance tests pass unchanged.
- Six additional tests cover the independent event streams, the compact token
  log, BOM-relative offsets, unchanged ordinary token shapes, observer
  isolation, and frozen/interned RDF/JS terms.
- A compatibility corpus covering duplicates, predicate/object lists, nested
  collections, TriG, directional literals, N3 literal subjects, triple terms,
  RDF 1.2 annotations, and forward/backward paths produces the same public
  ranges as the submitted implementation.
- The frozen/interned test is intentionally different: the submitted WeakMap
  collapses three positions onto one object, whereas occurrence IDs preserve
  all three offsets and both utterances.
- The complete Jest suite passes: 20 suites and 6,570 tests.

## Benchmark

Node 22.21.1 on `darwin-arm64`; 100,000 unique N-Triples, 6,677,780 UTF-16
code units; 7 interleaved rounds after 2 warmups, with 3 parses per sample.
Values are medians. The host was under variable load, so the within-run ratios
are more meaningful than the absolute times.

| Implementation | Median | vs PR plain | Retained heap | ArrayBuffers |
|---|---:|---:|---:|---:|
| PR #672 parser, provenance disabled | 651.1 ms | 1.00x | 28.0 MiB | 0 |
| PR #672 submitted provenance | 2,768.1 ms | 4.25x | 118.6 MiB | 0 |
| Event parser, provenance disabled | 573.9 ms | 0.88x | 28.0 MiB | 0 |
| Lexical token log only | 764.9 ms | 1.17x | 28.0 MiB | 5.0 MiB |
| Full event provenance | 1,179.3 ms | **1.81x** | **38.7 MiB** | **6.5 MiB** |

Full event provenance reduces the measured slowdown from 4.25x to 1.81x. It
retains 10.7 MiB of ordinary heap and 6.5 MiB of typed-array storage above
plain parsing, versus 90.6 MiB of additional ordinary heap for the submitted
implementation.

## Prototype limitations

- `ProvenanceParser.parse` remains synchronous and string-backed, as in PR
  #672. A streaming provenance wrapper needs a source-retention policy.
- Positions and IDs use 32-bit unsigned arrays, limiting a single retained
  document to fewer than 2^32 UTF-16 code units and token occurrences.
- The implementation is deliberately explicit in `N3Parser`: every semantic
  state transition carries its corresponding origin. This is more code than a
  term side table, but it makes occurrence semantics reviewable and correct.
