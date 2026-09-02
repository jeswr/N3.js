// **N3TermLocationParser** annotates parsed terms with their lexer token.
import N3Parser from './N3Parser';

export const TERM_TOKEN = Symbol('n3.sourceToken');

export function lineOffsets(input) {
  const offsets = [input.charCodeAt(0) === 0xFEFF ? 1 : 0];
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i);
    if (char === 13) {
      if (input.charCodeAt(i + 1) === 10)
        i++;
      offsets.push(i + 1);
    }
    else if (char === 10)
      offsets.push(i + 1);
  }
  return offsets;
}

function tokenRange(input, token, offsets) {
  const lineOffset = offsets[token.line - 1];
  const start = lineOffset + token.start;
  let end = lineOffset + token.end;
  while (end > start && /\s/.test(input[end - 1]))
    end--;
  return [{ start, end, line: token.line }];
}

export function termRanges(input, term, offsets) {
  const token = term[TERM_TOKEN];
  return token ? tokenRange(input, token, offsets || lineOffsets(input)) : [];
}

function factoryMethod(value) {
  return { configurable: true, enumerable: true, value };
}

// Decorate only the parser's factory view. The consumer's factory remains
// untouched, and methods retain the original factory as their `this` value.
function locationFactory(parser, factory) {
  return Object.create(factory, {
    namedNode: factoryMethod(value =>
      parser._annotate(factory.namedNode(value), parser._sourceToken)),

    blankNode: factoryMethod(function blankNode(value) {
      const term = arguments.length === 0 ? factory.blankNode() : factory.blankNode(value);
      return parser._annotate(term, parser._sourceToken);
    }),

    variable: factoryMethod(value =>
      parser._annotate(factory.variable(value), parser._sourceToken)),

    literal: factoryMethod(function literal(value, languageOrDatatype) {
      const token = parser._literalToken || parser._sourceToken;
      const term = arguments.length === 1 ? factory.literal(value) : factory.literal(value, languageOrDatatype);
      return parser._annotate(term, token);
    }),

    quad: factoryMethod(function quad(subject, predicate, object, graph) {
      const term = arguments.length === 3 ? factory.quad(subject, predicate, object) :
        factory.quad(subject, predicate, object, graph);
      return parser._annotate(term, parser._sourceToken);
    }),
  });
}

export default class N3TermLocationParser extends N3Parser {
  constructor(options) {
    const { onQuad, ...parserOptions } = options;
    super(parserOptions);

    this._onQuad = onQuad;
    this._sourceToken = null;
    this._literalToken = null;
    this._untrackedFactory = this._factory;
    this._factory = locationFactory(this, this._factory);
  }

  _annotate(term, token) {
    if (token)
      term[TERM_TOKEN] = token;
    return term;
  }

  _readToken(token) {
    // Regular strings are constructed while processing the following token.
    if (token.type === 'literal')
      this._literalToken = token.prefix.length === 0 ? token : null;

    const previous = this._sourceToken;
    this._sourceToken = token;
    try {
      const next = super._readToken(token);
      // A language literal may still be replaced by a directional literal.
      if (token.type !== 'literal' && next !== this._readDirCode)
        this._literalToken = null;
      return next;
    }
    finally {
      this._sourceToken = previous;
    }
  }

  // Implicit reifiers and their triple terms have no lexical token.
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
    // Emitted quads are event containers. Embedded triple-term quads still go
    // through the decorated factory and retain their closing token.
    const quad = this._untrackedFactory.quad(subject, predicate, object, graph || this.DEFAULTGRAPH);
    this._onQuad(quad);
    this._callback(null, quad);
  }
}
