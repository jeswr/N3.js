// **N3ProvenanceParser** stores the lexer token directly on each parsed RDF/JS
// term under a symbol, avoiding a parser-owned term lookup table.
import N3Parser from './N3Parser';
import { termToId } from './N3DataFactory';

export const TERM_TOKEN = Symbol('n3.sourceToken');
const TRACKING_ENABLED = Object.freeze({});

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

function tokenRange(input, token) {
  if (!token)
    return [];
  const start = token.offsetStart ?? token.start;
  let end = token.offsetEnd ?? token.end;
  while (end > start && /\s/.test(input[end - 1]))
    end--;
  return [{ start, end, line: token.line }];
}

export function termRanges(input, term) {
  return tokenRange(input, term[TERM_TOKEN]);
}

class TermLocationParser extends N3Parser {
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
    const quad = this._factory.quad(subject, predicate, object, graph || this.DEFAULTGRAPH);
    this._onLocation(quad);
    this._callback(null, quad);
  }
}

export class ProvenanceIndex {
  constructor(input = '') {
    this._input = input;
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
    return {
      quad,
      subject: termRanges(this._input, quad.subject),
      predicate: termRanges(this._input, quad.predicate),
      object: termRanges(this._input, quad.object),
      graph: termRanges(this._input, quad.graph),
    };
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
    const provenance = new ProvenanceIndex(input);
    const parser = new TermLocationParser({
      ...this._options,
      onLocation: quad => provenance._add(quad),
    });
    const quads = parser.parse(input);
    return { quads, provenance, prefixes: parser._prefixes };
  }
}
