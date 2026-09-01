// **N3ProvenanceParser** combines two independent parser event streams:
// lexical token occurrences and semantic quad-origin rows.
//
// Terms remain ordinary RDF/JS values. The parser carries token occurrence IDs
// beside its subject/predicate/object/graph state, and this wrapper retains the
// IDs in compact arrays. Public Range objects are materialized only on lookup.
import N3Parser from './N3Parser';
import { termToId } from './N3DataFactory';

const NO_TOKEN = 0xFFFFFFFF;

export function termKey(term) {
  switch (term.termType) {
  case 'NamedNode': return `<${term.value}>`;
  case 'BlankNode': return `_:${term.value}`;
  case 'Literal': {
    const val = `"${term.value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r')}"`;
    if (term.language)
      return `${val}@${term.language}${term.direction ? `--${term.direction}` : ''}`;
    if (term.datatype && term.datatype.value !== 'http://www.w3.org/2001/XMLSchema#string')
      return `${val}^^<${term.datatype.value}>`;
    return val;
  }
  case 'DefaultGraph': return '';
  case 'Variable': return `?${term.value}`;
  case 'Quad': return `<<(${termKey(term.subject)} ${termKey(term.predicate)} ${termKey(term.object)})>>`;
  default: throw new Error(`termKey: unknown termType ${term.termType}`);
  }
}

export function quadKey(quad) {
  return termToId(quad);
}

export class TokenLog {
  constructor(input, capacity = Math.max(16, Math.ceil(input.length / 16))) {
    this._input = input;
    this._positions = new Uint32Array(capacity * 3);
    this._types = new Uint8Array(capacity);
    this._typeIds = Object.create(null);
    this._typeNames = [];
    this.length = 0;
  }

  _grow() {
    const positions = new Uint32Array(this._positions.length * 2);
    positions.set(this._positions);
    this._positions = positions;
    const types = new Uint8Array(this._types.length * 2);
    types.set(this._types);
    this._types = types;
  }

  _add(token, start, consumedEnd, sourceId) {
    if (sourceId !== this.length)
      throw new Error(`Unexpected token occurrence ID ${sourceId}; expected ${this.length}`);
    if (sourceId >= this._types.length)
      this._grow();

    // Several lexer rules consume trailing whitespace. Keep offsets for the
    // lexical spelling, while the parser remains free to consume past it.
    let end = consumedEnd, char;
    while (end > start && ((char = this._input.charCodeAt(end - 1)) === 0x09 ||
                           char === 0x0A || char === 0x0D || char === 0x20))
      end--;

    const position = sourceId * 3;
    this._positions[position] = start;
    this._positions[position + 1] = end;
    this._positions[position + 2] = token.line;

    let typeId = this._typeIds[token.type];
    if (typeId === undefined) {
      typeId = this._typeNames.length;
      this._typeIds[token.type] = typeId;
      this._typeNames.push(token.type);
    }
    this._types[sourceId] = typeId;
    this.length++;
  }

  _finish() {
    this._positions = this._positions.slice(0, this.length * 3);
    this._types = this._types.slice(0, this.length);
  }

  range(sourceId) {
    if (sourceId === NO_TOKEN || sourceId < 0 || sourceId >= this.length)
      return [];
    const position = sourceId * 3;
    return [{
      start: this._positions[position],
      end: this._positions[position + 1],
      line: this._positions[position + 2],
    }];
  }

  token(sourceId) {
    const [range] = this.range(sourceId);
    if (!range)
      return null;
    return {
      id: sourceId,
      type: this._typeNames[this._types[sourceId]],
      ...range,
    };
  }

  lexeme(sourceId) {
    const token = this.token(sourceId);
    return token ? this._input.slice(token.start, token.end) : '';
  }

  *[Symbol.iterator]() {
    for (let id = 0; id < this.length; id++)
      yield this.token(id);
  }
}

export class ProvenanceIndex {
  constructor(tokens = null, capacity = 16) {
    this._tokens = tokens;
    this._map = new Map();
    this._origins = new Uint32Array(Math.max(16, capacity) * 4);
    this._quads = [];
    this._length = 0;
  }

  _grow() {
    const origins = new Uint32Array(this._origins.length * 2);
    origins.set(this._origins);
    this._origins = origins;
  }

  _add(quad, subject, predicate, object, graph) {
    const occurrence = this._length++;
    if (occurrence * 4 >= this._origins.length)
      this._grow();
    const position = occurrence * 4;
    this._origins[position] = subject;
    this._origins[position + 1] = predicate;
    this._origins[position + 2] = object;
    this._origins[position + 3] = graph;
    this._quads[occurrence] = quad;

    const key = quadKey(quad), existing = this._map.get(key);
    if (existing === undefined)
      this._map.set(key, occurrence);
    else if (typeof existing === 'number')
      this._map.set(key, [existing, occurrence]);
    else
      existing.push(occurrence);
  }

  _finish() {
    this._origins = this._origins.slice(0, this._length * 4);
  }

  _materialize(occurrence) {
    const position = occurrence * 4, tokens = this._tokens;
    return {
      quad: this._quads[occurrence],
      subject: tokens.range(this._origins[position]),
      predicate: tokens.range(this._origins[position + 1]),
      object: tokens.range(this._origins[position + 2]),
      graph: tokens.range(this._origins[position + 3]),
    };
  }

  _materializeAll(occurrences) {
    if (occurrences === undefined)
      return [];
    if (typeof occurrences === 'number')
      return [this._materialize(occurrences)];
    return occurrences.map(occurrence => this._materialize(occurrence));
  }

  // ### `get` returns the utterances of a value-equal quad.
  get(quad) {
    return this._materializeAll(this._map.get(quadKey(quad)));
  }

  get size() {
    return this._map.size;
  }

  get utteranceCount() {
    return this._length;
  }

  *[Symbol.iterator]() {
    for (const occurrences of this._map.values())
      yield this._materializeAll(occurrences);
  }
}

export default class N3ProvenanceParser {
  constructor(options = {}) {
    this._options = options;
  }

  // ### `parse` synchronously returns quads and independently retained origins.
  parse(input) {
    const tokens = new TokenLog(input);
    const provenance = new ProvenanceIndex(tokens, Math.ceil(input.length / 48));
    const userOnToken = this._options.onToken;
    const userOnQuadOrigin = this._options.onQuadOrigin;
    const parser = new N3Parser({
      ...this._options,
      onToken: (token, start, end, sourceId) => {
        tokens._add(token, start, end, sourceId);
        if (userOnToken)
          userOnToken(token, start, end, sourceId);
      },
      onQuadOrigin: (quad, subject, predicate, object, graph) => {
        provenance._add(quad, subject, predicate, object, graph);
        if (userOnQuadOrigin)
          userOnQuadOrigin(quad, subject, predicate, object, graph);
      },
    });
    const quads = parser.parse(input);
    tokens._finish();
    provenance._finish();
    return { quads, provenance, prefixes: parser._prefixes, tokens };
  }
}
