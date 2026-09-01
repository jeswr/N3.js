// **N3ProvenanceParser** keeps source tokens in a parser-owned side table and
// materializes public ranges only when an utterance is requested.
import N3Parser from './N3Parser';
import { termToId } from './N3DataFactory';

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

export class ProvenanceIndex {
  constructor(input = '', termTokens = null) {
    this._input = input;
    this._termTokens = termTokens;
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

  _range(token) {
    if (!token)
      return [];
    let end = token.offsetEnd;
    while (end > token.offsetStart && /\s/.test(this._input[end - 1]))
      end--;
    return [{ start: token.offsetStart, end, line: token.line }];
  }

  _utterance(id) {
    const quad = this._quads[id], tokens = this._termTokens;
    return {
      quad,
      subject: this._range(tokens.get(quad.subject)),
      predicate: this._range(tokens.get(quad.predicate)),
      object: this._range(tokens.get(quad.object)),
      graph: quad.graph.termType === 'DefaultGraph' ? [] : this._range(tokens.get(quad.graph)),
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
  constructor(options = {}) {
    this._options = options;
  }

  parse(input) {
    const provenance = new ProvenanceIndex(input);
    const parser = new N3Parser({
      ...this._options,
      onQuadSpans: quad => provenance._add(quad),
    });
    provenance._termTokens = parser._termSpans;
    const quads = parser.parse(input);
    return { quads, provenance, prefixes: parser._prefixes };
  }
}
