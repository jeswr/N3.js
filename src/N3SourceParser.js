// **N3SourceParser** carries source locations alongside terms while parsing,
// without adding metadata to the RDF/JS terms themselves.
import N3Parser from './N3Parser';

class LocatedTerm {
  constructor(term, token) {
    this.term = term;
    this.token = token;
  }

  get id() { return this.term.id; }
  get termType() { return this.term.termType; }
  get value() { return this.term.value; }
}

function term(value) {
  return value instanceof LocatedTerm ? value.term : value;
}

function range(value) {
  return value instanceof LocatedTerm ? tokenRange(value.token) : null;
}

function tokenRange(token) {
  return token ? {
    start: { line: token.line, column: token.start },
    end: { line: token.endLine || token.line, column: token.end },
  } : null;
}

const directFactoryMethods = ['namedNode', 'blankNode', 'variable'];

export default class N3SourceParser extends N3Parser {
  constructor(options) {
    const { onQuad, ...parserOptions } = options;
    super(parserOptions);

    this._onQuad = onQuad;
    this._sourceToken = null;
    this._literalToken = null;
    this._untrackedFactory = this._factory;
    this._factory = {};
    for (const name of directFactoryMethods) {
      this._factory[name] = (...args) => new LocatedTerm(
        this._untrackedFactory[name](...args), this._sourceToken,
      );
    }
    for (const name of ['literal', 'quad']) {
      this._factory[name] = (...args) => new LocatedTerm(
        this._untrackedFactory[name](...args.map(term)), this._sourceToken,
      );
    }
  }

  // A quantified entity reuses an earlier RDF term, but its location is the
  // current lexical occurrence rather than the quantifier declaration.
  _readEntity(token, quantifier) {
    const value = super._readEntity(token, quantifier);
    return value === undefined || value.token === token ? value : new LocatedTerm(term(value), token);
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

  // Implicit reifiers and their triple terms have no lexical source term.
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
    const quad = this._untrackedFactory.quad(
      term(subject), term(predicate), term(object), term(graph || this.DEFAULTGRAPH),
    );
    this._onQuad(quad, {
      subject: range(subject),
      predicate: range(predicate),
      object: range(object),
      graph: range(graph),
    });
    this._callback(null, quad);
  }
}
