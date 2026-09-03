// **N3TermLocationParser** attaches source ranges to terms while parsing and emits
// the corresponding source ranges alongside each quad.
import N3Parser from './N3Parser';

const TERM_RANGE = Symbol('n3.termRange');

function range(term) {
  return term && term[TERM_RANGE] || null;
}

function tokenRange(token) {
  return {
    start: { line: token.line, column: token.start },
    end: { line: token.endLine || token.line, column: token.end },
  };
}

const factoryMethods = ['namedNode', 'blankNode', 'variable', 'literal', 'quad'];

export default class N3TermLocationParser extends N3Parser {
  constructor(options) {
    const { onQuad, ...parserOptions } = options;
    super(parserOptions);

    this._onQuad = onQuad;
    this._sourceToken = null;
    this._sourceRange = null;
    this._literalToken = null;
    this._untrackedFactory = this._factory;
    this._factory = {};
    for (const name of factoryMethods) {
      this._factory[name] = (...args) => {
        const term = this._untrackedFactory[name](...args);
        if (this._sourceRange === undefined)
          this._sourceRange = tokenRange(this._sourceToken);
        term[TERM_RANGE] = this._sourceRange;
        return term;
      };
    }
  }

  // A quantified entity reuses an earlier RDF term, so move its range to the
  // current lexical occurrence.
  _readEntity(token, quantifier) {
    const term = super._readEntity(token, quantifier);
    if (this._n3Mode && !quantifier && term !== undefined && term[TERM_RANGE] !== this._sourceRange)
      term[TERM_RANGE] = this._sourceRange;
    return term;
  }

  _readToken(token) {
    // Regular strings are constructed while processing the following token.
    if (token.type === 'literal')
      this._literalToken = token.prefix.length === 0 ? token : null;

    this._sourceToken = this._literalToken || token;
    this._sourceRange = undefined;
    const next = super._readToken(token);
    // A language literal may still be replaced by a directional literal.
    if (token.type !== 'literal' && next !== this._readDirCode)
      this._literalToken = null;
    return next;
  }

  // Implicit reifiers and their triple terms have no lexical range.
  _readTripleTerm() {
    this._sourceToken = null;
    this._sourceRange = null;
    return super._readTripleTerm();
  }

  _emit(subject, predicate, object, graph) {
    const quad = this._factory.quad(subject, predicate, object, graph || this.DEFAULTGRAPH);
    this._onQuad(quad, {
      subject: range(subject),
      predicate: range(predicate),
      object: range(object),
      graph: range(graph),
    });
    this._callback(null, quad);
  }
}
