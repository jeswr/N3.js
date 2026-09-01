import { Lexer, Parser, Store, ProvenanceParser, ProvenanceIndex, TokenLog, termKey, DataFactory } from '../src';

const BASE_IRI = 'http://example.org/';

function parse(doc, options = {}) {
  return new ProvenanceParser({ baseIRI: BASE_IRI, blankNodePrefix: '', ...options }).parse(doc);
}
function slice(doc, r) {
  return doc.slice(r.start, r.end);
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
      expect(utts[0].subject[0].start).not.toBe(utts[1].subject[0].start);
    });

    it('stores a compact list after the second duplicate utterance', () => {
      const doc = '<s> <p> <o> .\n<s> <p> <o> .\n<s> <p> <o> .';
      const { quads, provenance } = parse(doc);
      expect(provenance.get(quads[0])).toHaveLength(3);
      expect(provenance.utteranceCount).toBe(3);
      expect([...provenance][0]).toHaveLength(3);
    });

    it('reuses the subject span across a predicateObjectList', () => {
      const doc = '<s> <p1> <o1> ;\n    <p2> <o2> .';
      const { quads, provenance } = parse(doc);
      const [u1] = provenance.get(quads[0]);
      const [u2] = provenance.get(quads[1]);
      expect(u1.subject).toEqual(u2.subject);
      expect(slice(doc, u2.predicate[0])).toBe('<p2>');
      expect(u2.predicate[0].line).toBe(2);
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

    it('distinguishes positions when a frozen factory interns terms', () => {
      const nodes = new Map();
      const factory = {
        ...DataFactory,
        namedNode(value) {
          let term = nodes.get(value);
          if (!term) {
            term = Object.freeze(DataFactory.namedNode(value));
            nodes.set(value, term);
          }
          return term;
        },
        defaultGraph() { return Object.freeze(DataFactory.defaultGraph()); },
        quad(subject, predicate, object, graph) {
          return DataFactory.quad(subject, predicate, object, graph);
        },
      };
      const doc = '<http://x> <http://x> <http://x> .\n<http://x> <http://x> <http://x> .';
      const { quads, provenance } = parse(doc, { factory, format: 'N-Triples' });

      expect(quads[0].subject).toBe(quads[0].predicate);
      expect(quads[0].predicate).toBe(quads[0].object);
      const utterances = provenance.get(quads[0]);
      expect(utterances).toHaveLength(2);
      expect(utterances.map(utterance => [
        utterance.subject[0].start,
        utterance.predicate[0].start,
        utterance.object[0].start,
      ])).toEqual([[0, 11, 22], [35, 46, 57]]);
      expect(Reflect.ownKeys(quads[0].subject)).toEqual(['id']);
    });
  });

  describe('independent event streams', () => {
    it('exposes a lexical token log without retaining parser token objects', () => {
      const doc = '<s> <p> "value"@en .';
      const { tokens } = parse(doc);
      const observed = [...tokens];
      expect(observed.map(token => token.type))
        .toEqual(['IRI', 'IRI', 'literal', 'langcode', '.', 'eof']);
      expect(tokens.lexeme(0)).toBe('<s>');
      expect(tokens.lexeme(2)).toBe('"value"');
      expect(tokens.lexeme(3)).toBe('@en');
    });

    it('keeps document-relative offsets after a leading BOM', () => {
      const doc = '\ufeff<s> <p> <o> .';
      const { quads, provenance, tokens } = parse(doc);
      const [utterance] = provenance.get(quads[0]);
      expect(utterance.subject[0].start).toBe(1);
      expect(slice(doc, utterance.subject[0])).toBe('<s>');
      expect(tokens.lexeme(0)).toBe('<s>');
    });

    it('reports compact quad origins independently from token events', () => {
      const tokenIds = [], origins = [];
      new Parser({
        baseIRI: BASE_IRI,
        onToken(token, start, end, sourceId) {
          tokenIds.push({ type: token.type, start, end, sourceId });
        },
        onQuadOrigin(quad, subject, predicate, object, graph) {
          origins.push({ quad, subject, predicate, object, graph });
        },
      }).parse('<s> <p> <o> .');

      expect(tokenIds.map(token => token.sourceId)).toEqual([0, 1, 2, 3, 4]);
      expect(origins).toHaveLength(1);
      expect(origins[0]).toMatchObject({ subject: 0, predicate: 1, object: 2, graph: -1 });
    });

    it('does not let a token observer corrupt semantic correlation', () => {
      const origins = [];
      new Parser({
        baseIRI: BASE_IRI,
        onToken(token) { token.sourceId = 999; },
        onQuadOrigin(quad, subject, predicate, object) {
          origins.push({ subject, predicate, object });
        },
      }).parse('<s> <p> <o> .');
      expect(origins).toEqual([{ subject: 0, predicate: 1, object: 2 }]);
    });

    it('does not add source IDs to ordinary lexer tokens', () => {
      const tokens = new Lexer({ lineMode: true })
        .tokenize('<http://s> <http://p> <http://o> .');
      expect(tokens.every(token => !Object.hasOwn(token, 'sourceId'))).toBe(true);
    });

    it('forwards both event streams supplied to the provenance wrapper', () => {
      const tokenIds = [], quadOrigins = [];
      parse('<s> <p> <o> .', {
        onToken(token, start, end, sourceId) { tokenIds.push(sourceId); },
        onQuadOrigin(quad, subject, predicate, object, graph) {
          quadOrigins.push([subject, predicate, object, graph]);
        },
      });
      expect(tokenIds).toEqual([0, 1, 2, 3, 4]);
      expect(quadOrigins).toEqual([[0, 1, 2, -1]]);
    });

    it('grows its compact token and origin tables', () => {
      const tokens = new TokenLog('a b', 1);
      tokens._add({ type: 'word', line: 1 }, 0, 1, 0);
      tokens._add({ type: 'word', line: 1 }, 2, 3, 1);
      expect(() => tokens._add({ type: 'word', line: 1 }, 0, 1, 3))
        .toThrow(/Unexpected token occurrence ID/);
      expect(tokens.range(-1)).toEqual([]);
      expect(tokens.range(99)).toEqual([]);
      expect(tokens.token(-1)).toBeNull();
      expect(tokens.lexeme(-1)).toBe('');
      tokens._finish();
      expect([...tokens]).toHaveLength(2);

      const provenance = new ProvenanceIndex(tokens, 1);
      const quad = DataFactory.quad(
        DataFactory.namedNode('urn:s'),
        DataFactory.namedNode('urn:p'),
        DataFactory.namedNode('urn:o'),
      );
      for (let occurrence = 0; occurrence < 17; occurrence++)
        provenance._add(quad, 0, 0, 0, -1);
      provenance._finish();
      expect(provenance.get(quad)).toHaveLength(17);
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
    // prefix already holds the datatype.
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

    it('keys triple terms, variables and the default graph', () => {
      const doc = '<a> <b> <<( <s> <p> <o> )>> .';
      const { quads, provenance } = parse(doc);
      expect(provenance.get(quads[0])).toHaveLength(1);
      expect(termKey(DataFactory.variable('v'))).toBe('?v');
      expect(termKey(DataFactory.defaultGraph())).toBe('');
      expect(() => termKey({ termType: 'Unheard' })).toThrow(/unknown termType/);
    });

    it('carries origins through formula and triple-term list items', () => {
      const docs = [
        '( { <a> <b> <c> } ) <p> <o> .',
        '<s> <p> ( { <a> <b> <c> } ) .',
        '( <<( <a> <b> <c> )>> ) <p> <o> .',
        '<s> ( <<( <a> <b> <c> )>> ) <o> .',
        '<s> <p> ( <<( <a> <b> <c> )>> ) .',
        '<s> <p> ( << <a> <b> <c> >> ) .',
      ];
      for (const doc of docs)
        expect(parse(doc, { format: 'text/n3' }).quads.length).toBeGreaterThan(0);
    });

    it('carries origins when an IRI replaces a property-list placeholder', () => {
      const docs = [
        '[id <s> <p> <o>] .',
        '<s> [id <p> <inner-p> <inner-o>] <o> .',
        '<s> <p> [id <o> <inner-p> <inner-o>] .',
      ];
      for (const doc of docs)
        expect(parse(doc, { format: 'text/n3' }).quads.length).toBeGreaterThan(0);
    });

    it('keys every supported RDF/JS term shape', () => {
      expect(termKey(DataFactory.namedNode('urn:n'))).toBe('<urn:n>');
      expect(termKey(DataFactory.blankNode('b'))).toBe('_:b');
      expect(termKey(DataFactory.literal('plain'))).toBe('"plain"');
      expect(termKey(DataFactory.literal('hello', 'en'))).toBe('"hello"@en');
      expect(termKey(DataFactory.literal('hello', { language: 'en', direction: 'ltr' })))
        .toBe('"hello"@en--ltr');
      expect(termKey(DataFactory.literal('1', DataFactory.namedNode('urn:type'))))
        .toBe('"1"^^<urn:type>');
      expect(termKey(DataFactory.literal('\\"\n\r'))).toBe('"\\\\\\"\\n\\r"');
      expect(termKey(DataFactory.quad(
        DataFactory.namedNode('urn:s'),
        DataFactory.namedNode('urn:p'),
        DataFactory.namedNode('urn:o'),
      ))).toBe('<<(<urn:s> <urn:p> <urn:o>)>>');
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

    it('exposes size and iteration over utterance lists', () => {
      const { provenance } = parse('<s> <p> <o> .\n<s> <p> <o2> .');
      expect(provenance.size).toBe(2);
      expect([...provenance].map(utts => utts.length)).toEqual([1, 1]);
      expect(new ProvenanceIndex().get(DataFactory.quad(
        DataFactory.namedNode('x:s'), DataFactory.namedNode('x:p'), DataFactory.namedNode('x:o'),
      ))).toEqual([]);
    });
  });

  describe('the quad-origin event', () => {
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
