// **N3ProvenanceIndex** stores and resolves the locations of quad utterances.
import { termToId } from './N3DataFactory';
import { termRanges } from './N3TermLocationParser';

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
