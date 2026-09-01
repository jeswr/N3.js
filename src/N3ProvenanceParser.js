// **N3ProvenanceParser** consumes a positional location event into one packed
// origin table. This prototype uses temporary term symbols to transport tokens.
import N3Parser from './N3Parser';
import { termToId } from './N3DataFactory';

const TERM_TOKEN = Symbol('n3.sourceToken');
const TRACKING_ENABLED = Object.freeze({});
const NO_RANGE = 0xFFFF_FFFF;
const EMPTY = Object.freeze([]);

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

export function quadKey(quad) { return termToId(quad); }

function tokenBounds(input, token) {
  if (!token)
    return null;
  const start = token.offsetStart ?? token.start;
  let end = token.offsetEnd ?? token.end;
  while (end > start && /\s/.test(input[end - 1]))
    end--;
  return [start, end, token.line];
}

function clearToken(term) {
  term[TERM_TOKEN] = undefined;
  if (term.termType === 'Quad') {
    clearToken(term.subject);
    clearToken(term.predicate);
    clearToken(term.object);
    clearToken(term.graph);
  }
}

class LocationEventParser extends N3Parser {
  constructor(options) {
    const onLocation = options.onLocation;
    const parserOptions = { ...options, _trackOffsets: true };
    delete parserOptions.onLocation;
    super(parserOptions);
    this._onQuadSpans = null;
    this._termSpans = TRACKING_ENABLED;
    this._onLocation = onLocation;
  }

  _noteSpan(term, token) {
    term[TERM_TOKEN] = token;
    return term;
  }

  _noteLiteralSpan(literal) {
    literal[TERM_TOKEN] = this._literalSpan;
    return literal;
  }

  _emit(subject, predicate, object, graph) {
    const actualGraph = graph || this.DEFAULTGRAPH;
    const quad = this._factory.quad(subject, predicate, object, actualGraph);
    this._onLocation(
      quad,
      subject[TERM_TOKEN],
      predicate[TERM_TOKEN],
      object[TERM_TOKEN],
      graph && graph[TERM_TOKEN],
    );
    this._callback(null, quad);
  }
}

export class ProvenanceIndex {
  constructor(input = '', initialCapacity = 1024) {
    this._input = input;
    this._rows = new Uint32Array(Math.max(1, initialCapacity) * 12);
    this._length = 0;
    this._map = new Map();
    this._quads = [];
  }

  _grow() {
    const rows = new Uint32Array(this._rows.length * 2);
    rows.set(this._rows);
    this._rows = rows;
  }

  _write(offset, token) {
    const bounds = tokenBounds(this._input, token);
    if (bounds)
      this._rows.set(bounds, offset);
    else
      this._rows.fill(NO_RANGE, offset, offset + 3);
  }

  _add(quad, subject, predicate, object, graph) {
    const id = this._length++, base = id * 12;
    if (base + 12 > this._rows.length)
      this._grow();
    this._write(base, subject);
    this._write(base + 3, predicate);
    this._write(base + 6, object);
    this._write(base + 9, graph);
    this._quads.push(quad);

    const key = quadKey(quad), previous = this._map.get(key);
    if (previous === undefined)
      this._map.set(key, id);
    else if (typeof previous === 'number')
      this._map.set(key, [previous, id]);
    else
      previous.push(id);
  }

  _finish() {
    this._rows = this._rows.slice(0, this._length * 12);
    this._input = null;
  }

  _utterance(id) {
    const base = id * 12, rows = this._rows;
    function range(offset) {
      return rows[offset] === NO_RANGE ? EMPTY :
        [{ start: rows[offset], end: rows[offset + 1], line: rows[offset + 2] }];
    }
    return {
      quad: this._quads[id],
      subject: range(base),
      predicate: range(base + 3),
      object: range(base + 6),
      graph: range(base + 9),
    };
  }

  get(quad) {
    const ids = this._map.get(quadKey(quad));
    if (ids === undefined)
      return [];
    return typeof ids === 'number' ? [this._utterance(ids)] : ids.map(id => this._utterance(id));
  }

  get size() { return this._map.size; }
  get utteranceCount() { return this._length; }

  *[Symbol.iterator]() {
    for (const ids of this._map.values())
      yield typeof ids === 'number' ? [this._utterance(ids)] : ids.map(id => this._utterance(id));
  }
}

export default class N3ProvenanceParser {
  constructor(options = {}) { this._options = options; }

  parse(input) {
    const provenance = new ProvenanceIndex(input, Math.ceil(input.length / 32));
    const parser = new LocationEventParser({
      ...this._options,
      onLocation: (quad, subject, predicate, object, graph) =>
        provenance._add(quad, subject, predicate, object, graph),
    });
    const quads = parser.parse(input);
    for (const quad of quads) {
      clearToken(quad.subject);
      clearToken(quad.predicate);
      clearToken(quad.object);
      clearToken(quad.graph);
    }
    provenance._finish();
    return { quads, provenance, prefixes: parser._prefixes };
  }
}
