// **N3ProvenanceParser** stores the lexer token directly on each parsed RDF/JS
// term under a symbol, avoiding a parser-owned term lookup table.
import N3Parser from './N3Parser';
import { termToId } from './N3DataFactory';

export const TERM_TOKEN = Symbol('n3.sourceToken');

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
  const start = token.offsetStart;
  let end = token.offsetEnd;
  while (end > start && /\s/.test(input[end - 1]))
    end--;
  return [{ start, end, line: token.line }];
}

export function termRanges(input, term) {
  return tokenRange(input, term[TERM_TOKEN]);
}

// Decorate only the parser's factory view. The consumer's factory remains
// untouched, and methods retain the original factory as their `this` value.
function locationFactory(parser, factory) {
  const wrapper = Object.create(factory);
  Object.defineProperties(wrapper, {
    namedNode: {
      configurable: true,
      enumerable: true,
      value(value) {
        return parser._setTermToken(factory.namedNode(value), parser._sourceToken);
      },
    },
    blankNode: {
      configurable: true,
      enumerable: true,
      value(value) {
        const term = arguments.length === 0 ? factory.blankNode() : factory.blankNode(value);
        return parser._setTermToken(term, parser._sourceToken);
      },
    },
    variable: {
      configurable: true,
      enumerable: true,
      value(value) {
        return parser._setTermToken(factory.variable(value), parser._sourceToken);
      },
    },
    literal: {
      configurable: true,
      enumerable: true,
      value(value, languageOrDatatype) {
        const token = parser._literalToken || parser._sourceToken;
        const term = arguments.length === 1 ? factory.literal(value) : factory.literal(value, languageOrDatatype);
        return parser._setTermToken(term, token);
      },
    },
    quad: {
      configurable: true,
      enumerable: true,
      value(subject, predicate, object, graph) {
        const term = arguments.length === 3 ? factory.quad(subject, predicate, object) :
          factory.quad(subject, predicate, object, graph);
        return parser._setTermToken(term, parser._sourceToken);
      },
    },
  });
  return wrapper;
}

class TermLocationParser extends N3Parser {
  constructor(options) {
    const onLocation = options.onLocation;
    const parserOptions = { ...options, _trackTermLocations: true };
    delete parserOptions.onLocation;
    super(parserOptions);
    this._onLocation = onLocation;
    this._sourceToken = null;
    this._literalToken = null;
    this._factory = locationFactory(this, this._factory);
  }

  _setTermToken(term, token) {
    if (token)
      term[TERM_TOKEN] = token;
    return term;
  }

  _readToken(token) {
    // A regular string literal is constructed while reading its following
    // datatype, language tag, direction, or punctuation token. Retain its
    // opening token until that construction has finished.
    if (token.type === 'literal')
      this._literalToken = token.prefix.length === 0 ? token : null;

    const previous = this._sourceToken;
    this._sourceToken = token;
    try {
      const next = super._readToken(token);
      if (token.type !== 'literal' && next !== this._readDirCode)
        this._literalToken = null;
      return next;
    }
    finally {
      this._sourceToken = previous;
    }
  }

  // Reification creates an implicit identifier and triple term. Neither has
  // a lexical token of its own, even though their construction is triggered
  // while another token is active.
  _readTripleTerm() {
    const previous = this._sourceToken;
    this._sourceToken = null;
    try {
      return super._readTripleTerm();
    }
    finally {
      this._sourceToken = previous;
    }
  }

  _emit(subject, predicate, object, graph) {
    // The quad is an event container, not a source term. Embedded triple-term
    // quads are still annotated because they are created outside `_emit`.
    const previous = this._sourceToken;
    this._sourceToken = null;
    let quad;
    try {
      quad = this._factory.quad(subject, predicate, object, graph || this.DEFAULTGRAPH);
    }
    finally {
      this._sourceToken = previous;
    }
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
