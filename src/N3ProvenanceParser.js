// **N3ProvenanceParser** attaches a fixed-width S/P/O/G location row to each
// emitted quad. Temporary term metadata is cleared after synchronous parsing.
import N3Parser from './N3Parser';
import { termToId } from './N3DataFactory';

const TERM_TOKEN = Symbol('n3.sourceToken');
export const QUAD_RANGES = Symbol('n3.sourceRanges');
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

function writeToken(input, row, offset, token) {
  if (!token) {
    row[offset] = row[offset + 1] = row[offset + 2] = NO_RANGE;
    return;
  }
  const start = token.offsetStart ?? token.start;
  let end = token.offsetEnd ?? token.end;
  while (end > start && /\s/.test(input[end - 1]))
    end--;
  row[offset] = start;
  row[offset + 1] = end;
  row[offset + 2] = token.line;
}

function range(row, offset) {
  return row[offset] === NO_RANGE ? EMPTY :
    [{ start: row[offset], end: row[offset + 1], line: row[offset + 2] }];
}

export function quadRanges(quad) {
  const row = quad[QUAD_RANGES];
  return {
    subject: range(row, 0),
    predicate: range(row, 3),
    object: range(row, 6),
    graph: range(row, 9),
  };
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

class QuadLocationParser extends N3Parser {
  constructor(input, options) {
    const onLocation = options.onLocation;
    const parserOptions = { ...options, _trackOffsets: true };
    delete parserOptions.onLocation;
    super(parserOptions);
    this._onQuadSpans = null;
    this._termSpans = TRACKING_ENABLED;
    this._inputDocument = input;
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
    const row = new Array(12);
    writeToken(this._inputDocument, row, 0, subject && subject[TERM_TOKEN]);
    writeToken(this._inputDocument, row, 3, predicate && predicate[TERM_TOKEN]);
    writeToken(this._inputDocument, row, 6, object && object[TERM_TOKEN]);
    writeToken(this._inputDocument, row, 9, graph && graph[TERM_TOKEN]);
    quad[QUAD_RANGES] = row;
    this._onLocation(quad);
    this._callback(null, quad);
  }
}

export class ProvenanceIndex {
  constructor() {
    this._map = new Map();
    this._quads = [];
  }

  _add(quad) {
    const id = this._quads.length;
    this._quads.push(quad);
    const key = quadKey(quad), previous = this._map.get(key);
    if (previous === undefined)
      this._map.set(key, id);
    else if (typeof previous === 'number')
      this._map.set(key, [previous, id]);
    else
      previous.push(id);
  }

  _utterance(id) {
    const quad = this._quads[id];
    return { quad, ...quadRanges(quad) };
  }

  get(quad) {
    const ids = this._map.get(quadKey(quad));
    if (ids === undefined)
      return [];
    return typeof ids === 'number' ? [this._utterance(ids)] : ids.map(id => this._utterance(id));
  }

  get size() { return this._map.size; }
  get utteranceCount() { return this._quads.length; }

  *[Symbol.iterator]() {
    for (const ids of this._map.values())
      yield typeof ids === 'number' ? [this._utterance(ids)] : ids.map(id => this._utterance(id));
  }
}

export default class N3ProvenanceParser {
  constructor(options = {}) { this._options = options; }

  parse(input) {
    const provenance = new ProvenanceIndex();
    const parser = new QuadLocationParser(input, {
      ...this._options,
      onLocation: quad => provenance._add(quad),
    });
    const quads = parser.parse(input);
    for (const quad of quads) {
      clearToken(quad.subject);
      clearToken(quad.predicate);
      clearToken(quad.object);
      clearToken(quad.graph);
    }
    return { quads, provenance, prefixes: parser._prefixes };
  }
}
