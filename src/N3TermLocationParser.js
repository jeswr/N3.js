// **N3TermLocationParser** attaches source tokens to terms while parsing and emits
// the corresponding source ranges alongside each quad.
import N3Parser from './N3Parser';

const TERM_TOKEN = Symbol('n3.sourceToken');

function range(term) {
  return tokenRange(term && term[TERM_TOKEN]);
}

function tokenRange(token) {
  return token ? {
    start: { line: token.line, column: token.start },
    end: { line: token.endLine || token.line, column: token.end },
  } : null;
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
        term[TERM_TOKEN] = this._sourceToken;
        return term;
      };
    }
  }

  // A quantified entity reuses an earlier RDF term, so move its token to the
  // current lexical occurrence.
  _readEntity(token, quantifier) {
    const term = super._readEntity(token, quantifier);
    if (this._n3Mode && !quantifier && term !== undefined && term[TERM_TOKEN] !== token)
      term[TERM_TOKEN] = token;
    return term;
  }

  _readToken(token) {
    // Regular strings are constructed while processing the following token.
    if (token.type === 'literal')
      this._literalToken = token.prefix.length === 0 ? token : null;

    this._sourceToken = this._literalToken || token;
    const next = super._readToken(token);
    // A language literal may still be replaced by a directional literal.
    if (token.type !== 'literal' && next !== this._readDirCode)
      this._literalToken = null;
    return next;
  }

  // Implicit reifiers and their triple terms have no lexical token.
  _readTripleTerm() {
    this._sourceToken = null;
    return super._readTripleTerm();
  }

  _emit(subject, predicate, object, graph) {
    const quad = this._untrackedFactory.quad(subject, predicate, object, graph || this.DEFAULTGRAPH);
    this._onQuad(quad, {
      subject: range(subject),
      predicate: range(predicate),
      object: range(object),
      graph: range(graph),
    });
    this._callback(null, quad);
  }
}
