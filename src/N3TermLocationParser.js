// **N3TermLocationParser** annotates parsed terms with their lexer token.
import N3Parser from './N3Parser';

const TERM_TOKEN = Symbol('n3.sourceToken');

// Locations use 1-based lines, 0-based UTF-16 columns, and half-open ranges.
export function termRanges(term) {
  const token = term[TERM_TOKEN];
  return token ? [{
    start: { line: token.line, column: token.start },
    end: { line: token.endLine || token.line, column: token.end },
  }] : [];
}

const factoryMethods = ['namedNode', 'blankNode', 'variable', 'literal', 'quad'];

export default class N3TermLocationParser extends N3Parser {
  constructor(options) {
    const { onQuad, ...parserOptions } = options;
    super(parserOptions);

    this._onQuad = onQuad;
    this._sourceToken = null;
    this._literalToken = null;
    this._untrackedFactory = this._factory;
    this._factory = {};
    for (const name of factoryMethods) {
      this._factory[name] = (...args) => {
        const term = this._untrackedFactory[name](...args);
        if (this._sourceToken)
          term[TERM_TOKEN] = this._sourceToken;
        return term;
      };
    }
  }

  _readToken(token) {
    // Regular strings are constructed while processing the following token.
    if (token.type === 'literal')
      this._literalToken = token.prefix.length === 0 ? token : null;

    const previous = this._sourceToken;
    this._sourceToken = this._literalToken || token;
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
