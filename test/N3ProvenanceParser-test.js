import { Parser, Store, ProvenanceParser, ProvenanceIndex, EntityIndex, DataFactory } from '../src';

const BASE_IRI = 'http://example.org/';

function parse(doc, options = {}) {
  return new ProvenanceParser({ baseIRI: BASE_IRI, blankNodePrefix: '', ...options }).parse(doc);
}
function offset(doc, position) {
  const newline = /\r\n|\r|\n/g;
  let lineStart = 0;
  for (let line = 1; line < position.line; line++) {
    const match = newline.exec(doc);
    lineStart = match.index + match[0].length;
  }
  return lineStart + position.column;
}
function slice(doc, range) {
  return doc.slice(offset(doc, range.start), offset(doc, range.end));
}

describe('ProvenanceParser', () => {
  describe('utterance multiset semantics', () => {
    it('records two utterances for the same quad uttered twice', () => {
      const doc = '<s> <p> <o> .\n<s> <p> <o> .';
      const { quads, provenance } = parse(doc);
      expect(quads).toHaveLength(2);
      const utts = provenance.get(quads[0]);
      expect(utts).toHaveLength(2);
      expect(slice(doc, utts[0].subject[0])).toBe('<s>');
      expect(utts[0].subject[0].start).not.toEqual(utts[1].subject[0].start);
    });

    it('stores occurrence data directly for duplicate utterances', () => {
      const doc = '<s> <p> <o> .\n<s> <p> <o> .\n<s> <p> <o> .';
      const { quads, provenance } = parse(doc);
      expect(provenance.get(quads[0])).toHaveLength(3);
      const occurrences = Object.values(provenance._quadOccurrences)[0];
      expect(occurrences).toHaveLength(3);
      expect(occurrences[0]).not.toHaveProperty('quad');
      expect(slice(doc, occurrences[0].subject[0])).toBe('<s>');
    });

    it('reuses the subject span across a predicateObjectList', () => {
      const doc = '<s> <p1> <o1> ;\n    <p2> <o2> .';
      const { quads, provenance } = parse(doc);
      const [u1] = provenance.get(quads[0]);
      const [u2] = provenance.get(quads[1]);
      expect(u1.subject).toEqual(u2.subject);
      expect(slice(doc, u2.predicate[0])).toBe('<p2>');
      expect(u2.predicate[0].start.line).toBe(2);
    });

    it.each([
      ['LF', '\n'],
      ['CRLF', '\r\n'],
      ['CR', '\r'],
    ])('converts indented line positions after %s to source offsets', (_, newline) => {
      const doc = `<s> <p> <o> .${newline}  <s2> <p2> <o2> .`;
      const { quads, provenance } = parse(doc);
      const [utterance] = provenance.get(quads[1]);
      expect(utterance.subject[0].start).toEqual({ line: 2, column: 2 });
      expect(slice(doc, utterance.subject[0])).toBe('<s2>');
    });

    it.each([
      ['LF', '\n'],
      ['CRLF', '\r\n'],
      ['CR', '\r'],
    ])('converts a multiline literal containing %s to a source range', (_, newline) => {
      const lexicalLiteral = `"""first${newline}second"""`;
      const doc = `<s> <p> ${lexicalLiteral} .`;
      const { quads, provenance } = parse(doc);
      const [location] = provenance.get(quads[0])[0].object;
      expect(location).toEqual({
        start: { line: 1, column: 8 },
        end: { line: 2, column: 9 },
      });
      expect(slice(doc, location)).toBe(lexicalLiteral);
    });

    it('accounts for a byte-order mark when converting line positions', () => {
      const doc = '\uFEFF<s> <p> <o> .';
      const { quads, provenance } = parse(doc);
      const [subject] = provenance.get(quads[0])[0].subject;
      expect(subject.start).toEqual({ line: 1, column: 1 });
      expect(slice(doc, subject)).toBe('<s>');
    });

    it('gives synthetic blank nodes their introducing bracket span', () => {
      const doc = '[ <p> <o> ] <q> <r> .';
      const { quads, provenance } = parse(doc);
      const inner = quads.find(q => q.predicate.value === `${BASE_IRI}p`);
      const [u] = provenance.get(inner);
      expect(slice(doc, u.subject[0])).toBe('[');
      expect(slice(doc, u.object[0])).toBe('<o>');
    });

    it('spans literals, including language-tagged ones', () => {
      const doc = '<s> <p> "hello"@en .';
      const { quads, provenance } = parse(doc);
      const [u] = provenance.get(quads[0]);
      expect(slice(doc, u.object[0])).toBe('"hello"');
    });
  });

  describe('value-keyed lookup', () => {
    it('resolves quads reconstructed by a store', () => {
      const doc = '<s> <p> "lit" .';
      const { quads, provenance } = parse(doc);
      const store = new Store(quads);
      const rebuilt = store.getQuads(null, null, null)[0];
      expect(rebuilt).not.toBe(quads[0]);
      expect(provenance.get(rebuilt)).toHaveLength(1);
    });

    it('shares compact numeric quad identities with an N3 entity index', () => {
      const entityIndex = new EntityIndex();
      const { quads, provenance } = parse('<s> <p> "lit" .', { entityIndex });
      const allocatedIds = entityIndex._id;
      const quadId = entityIndex._termToNumericId(quads[0]);
      expect(quadId).toEqual(expect.any(Number));
      expect(Object.getPrototypeOf(provenance._quadOccurrences)).toBeNull();
      expect(provenance._quadOccurrences[quadId]).toHaveLength(1);

      const store = new Store({ entityIndex });
      store.addQuads(quads);
      expect(entityIndex._id).toBe(allocatedIds);
      expect(provenance.get(store.getQuads(null, null, null)[0])).toHaveLength(1);
    });
  });

  describe('TriG', () => {
    it('carries the graph label span', () => {
      const doc = '<g> { <s> <p> <o> }';
      const { quads, provenance } = parse(doc, { format: 'application/trig' });
      const [u] = provenance.get(quads[0]);
      expect(slice(doc, u.graph[0])).toBe('<g>');
    });
  });

  describe('RDF 1.2', () => {
    it('spans annotation-derived reification quads', () => {
      const doc = '<s> <p> <o> ~ <r> {| <a> <b> |} .';
      const { quads, provenance } = parse(doc);
      const reifies = quads.find(q => q.predicate.value.endsWith('#reifies'));
      const [u] = provenance.get(reifies);
      expect(slice(doc, u.subject[0])).toBe('<r>');
      const annot = quads.find(q => q.predicate.value === `${BASE_IRI}a`);
      const [ua] = provenance.get(annot);
      expect(slice(doc, ua.object[0])).toBe('<b>');
    });
  });

  describe('coverage of span-less and exotic terms', () => {
    it("gives 'a' predicates no span", () => {
      const doc = '<s> a <C> .';
      const { quads, provenance } = parse(doc);
      const [u] = provenance.get(quads[0]);
      expect(u.predicate).toEqual([]);
      expect(slice(doc, u.object[0])).toBe('<C>');
    });

    it('spans language-tagged literals inside collections', () => {
      const doc = '<s> <p> ("x"@en) .';
      const { quads, provenance } = parse(doc);
      const first = quads.find(q => q.predicate.value.endsWith('#first'));
      const [u] = provenance.get(first);
      expect(slice(doc, u.object[0])).toBe('"x"');
    });

    it('spans subject literals in N3 mode', () => {
      const doc = '"s" <p> <o> .';
      const { quads, provenance } = parse(doc, { format: 'text/n3' });
      const [u] = provenance.get(quads[0]);
      expect(slice(doc, u.subject[0])).toBe('"s"');
    });

    it('spans predicate literals in N3 mode', () => {
      const doc = '<s> "p" <o> .';
      const { quads, provenance } = parse(doc, { format: 'text/n3' });
      const [u] = provenance.get(quads[0]);
      expect(slice(doc, u.predicate[0])).toBe('"p"');
    });

    // Numbers and booleans reach the parser as a single `literal` token whose
    // prefix already holds the datatype, so they bypass the pending literal-token path.
    it('spans pre-datatyped object literals', () => {
      const doc = '<s> <p> 42, 1.5e0, true .';
      const { quads, provenance } = parse(doc);
      expect(quads.map(q => slice(doc, provenance.get(q)[0].object[0])))
        .toStrictEqual(['42', '1.5e0', 'true']);
    });

    it('spans pre-datatyped literals in collections', () => {
      const doc = '<s> <p> (42) .';
      const { quads, provenance } = parse(doc);
      const first = quads.find(q => q.predicate.value.endsWith('#first'));
      expect(slice(doc, provenance.get(first)[0].object[0])).toBe('42');
    });

    it('spans pre-datatyped subject and predicate literals in N3 mode', () => {
      const doc = '42 true <o> .';
      const { quads, provenance } = parse(doc, { format: 'text/n3' });
      const [u] = provenance.get(quads[0]);
      expect(slice(doc, u.subject[0])).toBe('42');
      expect(slice(doc, u.predicate[0])).toBe('true');
    });

    it('indexes triple terms', () => {
      const doc = '<a> <b> <<( <s> <p> <o> )>> .';
      const { quads, provenance } = parse(doc);
      expect(provenance.get(quads[0])).toHaveLength(1);
    });

    it('gives rdf:nil subjects (empty collection) no span', () => {
      const doc = '() <p> <o> .';
      const { quads, provenance } = parse(doc);
      const [u] = provenance.get(quads[0]);
      expect(u.subject).toEqual([]);
    });

    it('constructs without options', () => {
      const { quads } = new ProvenanceParser().parse('<http://x/s> <http://x/p> <http://x/o> .');
      expect(quads).toHaveLength(1);
    });

    it('iterates over utterance lists without exposing counts', () => {
      const { provenance } = parse('<s> <p> <o> .\n<s> <p> <o2> .');
      const utteranceLists = [...provenance];
      expect(utteranceLists.map(utterances => utterances.length)).toEqual([1, 1]);
      expect(utteranceLists[0][0].quad.termType).toBe('Quad');
      expect(provenance).not.toHaveProperty('size');
      expect(provenance).not.toHaveProperty('utteranceCount');
      expect(new ProvenanceIndex().get(DataFactory.quad(
        DataFactory.namedNode('x:s'), DataFactory.namedNode('x:p'), DataFactory.namedNode('x:o'),
      ))).toEqual([]);
    });
  });

  describe('term-symbol tracking', () => {
    it('keeps the opening token active for delayed literal construction', () => {
      const doc = '<s> <p> "typed"^^<type>, "directed"@en--ltr, 42 .';
      const { quads, provenance } = parse(doc);
      expect(quads.map(q => slice(doc, provenance.get(q)[0].object[0])))
        .toStrictEqual(['"typed"', '"directed"', '42']);
    });

    it('does not attach source tokens to emitted quads or implicit reification terms', () => {
      const { quads } = parse('<s> <p> <o> ~ .');
      const reifies = quads.find(q => q.predicate.value.endsWith('#reifies'));
      expect(reifies).toBeDefined();
      expect(Object.getOwnPropertySymbols(reifies)).toHaveLength(0);
      expect(Object.getOwnPropertySymbols(reifies.subject)).toHaveLength(0);
      expect(Object.getOwnPropertySymbols(reifies.object)).toHaveLength(0);
    });

    it('preserves custom factory receivers and method arities', () => {
      function recordingFactory(calls) {
        const factory = Object.create(DataFactory);
        for (const name of ['namedNode', 'blankNode', 'variable', 'literal', 'defaultGraph', 'quad']) {
          Object.defineProperty(factory, name, {
            value(...args) {
              calls.push({ name, arity: args.length, receiver: this });
              return DataFactory[name](...args);
            },
          });
        }
        return factory;
      }

      const doc = '<s> <p> [ <q> "value" ] .\n<s> <p> <<( <x> <y> _:z )>> .';
      const plainCalls = [], trackedCalls = [];
      new Parser({ baseIRI: BASE_IRI, blankNodePrefix: '', factory: recordingFactory(plainCalls) }).parse(doc);
      const trackedFactory = recordingFactory(trackedCalls);
      parse(doc, { factory: trackedFactory });
      expect(trackedCalls.map(({ name, arity }) => ({ name, arity })))
        .toStrictEqual(plainCalls.map(({ name, arity }) => ({ name, arity })));
      expect(trackedCalls.every(({ receiver }) => receiver === trackedFactory)).toBe(true);

      const variableCalls = [], variableFactory = recordingFactory(variableCalls);
      parse('?s <p> <o> .', { format: 'text/n3', factory: variableFactory });
      expect(variableCalls.find(({ name }) => name === 'variable').receiver).toBe(variableFactory);
    });

    it('does not change what the parser emits', () => {
      const doc = '@prefix ex: <http://ex.example/>.\nex:s ex:p [ ex:q (1 2) ], "x"@en--ltr .';
      // anonymous blank node labels come from a global counter, so compare
      // with labels normalized by order of first appearance
      function normalize(quads) {
        const seen = new Map();
        function label(l) {
          if (!seen.has(l)) seen.set(l, `bn${seen.size}`);
          return seen.get(l);
        }
        return quads.map(q => JSON.stringify(q.toJSON(), (k, v, o) => v))
          .map((s, i) => JSON.parse(s))
          .map(j => JSON.parse(JSON.stringify(j), (k, v) =>
            v && v.termType === 'BlankNode' ? { ...v, value: label(v.value) } : v));
      }
      const plain = new Parser({ baseIRI: BASE_IRI, blankNodePrefix: '' }).parse(doc);
      const tracked = parse(doc);
      expect(normalize(tracked.quads)).toEqual(normalize(plain));
    });
  });
});
