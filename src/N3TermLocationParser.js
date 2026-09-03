// **N3TermLocationParser** tracks lexical term occurrences while parsing and
// emits their compact source ranges alongside each quad.
import N3Parser from './N3Parser';
import { N3EntityIndex } from './N3Store';

const compoundContexts = new Set(['blank', 'list', 'formula', '<<(', '<<']),
    compoundTokens = new Set(['[', '(', '{', '<<(', '<<']);

class TermOccurrence {
  constructor(term, range) {
    this.term = term;
    this.range = range;
    this.entityId = 0;
  }

  get id() { return this.term && this.term.id; }
  get termType() { return this.term && this.term.termType; }
  get value() { return this.term && this.term.value; }
}

function unwrap(value) {
  return value instanceof TermOccurrence ? value.term : value;
}

function locate(value, range) {
  return new TermOccurrence(unwrap(value), range);
}

function tokenRange(token, closed) {
  return [token.line, token.start, token.endLine || token.line, token.end, closed];
}

function closeRange(range, token) {
  range[2] = token.endLine || token.line;
  range[3] = token.end;
  range[4] = true;
}

function occurrenceRange(value) {
  return value instanceof TermOccurrence ? value.range : null;
}

export default class N3TermLocationParser extends N3Parser {
  constructor(options = {}) {
    const { onQuad, entityIndex, ...parserOptions } = options;
    super(parserOptions);

    this._onQuad = onQuad || (() => {});
    this._entityIndex = entityIndex || new N3EntityIndex({ factory: this._factory });
    this._sourceRange = null;
    this._literalRange = null;
    this._constructingLiteralRange = null;
    this._currentToken = null;
    this._blankNodeRanges = null;
    this._validateTokenRange = parserOptions.lexer !== undefined;
    this._untrackedFactory = this._factory;
    this._factory = {};

    for (const name of ['namedNode', 'variable'])
      this._factory[name] = (...args) => this._untrackedFactory[name](...args);
    this._factory.blankNode = (...args) => {
      const term = this._untrackedFactory.blankNode(...args),
          range = this._blankNodeRanges && this._blankNodeRanges.length ?
            this._blankNodeRanges.shift() :
            this._currentToken && (this._currentToken.type === '[' || this._currentToken.type === '{') ?
              this._sourceRange : null;
      return range === null ? term : new TermOccurrence(term, range);
    };
    this._factory.literal = (...args) => {
      for (let i = 0; i < args.length; i++)
        args[i] = unwrap(args[i]);
      return new TermOccurrence(
        this._untrackedFactory.literal(...args), this._constructingLiteralRange || this._sourceRange,
      );
    };
    this._factory.quad = (...args) => {
      for (let i = 0; i < args.length; i++)
        args[i] = unwrap(args[i]);
      const term = this._untrackedFactory.quad(...args),
          context = this._contextStack[this._contextStack.length - 1];
      if (!context || !((context.type === '<<(' && this._currentToken.type === ')>>') ||
                        (context.type === '<<' && this._currentToken.type === '>>')))
        return term;
      closeRange(context.sourceRange, this._currentToken);
      return new TermOccurrence(term, context.sourceRange);
    };
  }

  // A quantified entity can reuse an earlier RDF term, but each lexical use is
  // a distinct occurrence.
  _readEntity(token, quantifier) {
    const blankNodeRanges = this._blankNodeRanges;
    this._blankNodeRanges = null;
    const term = super._readEntity(token, quantifier);
    this._blankNodeRanges = blankNodeRanges;
    return term === undefined || this._readCallback === this._readPrefixIRI ?
      term : locate(term, this._sourceRange);
  }

  // Predicate abbreviations resolve to parser constants, so give the constant
  // a fresh occurrence for this spelling.
  _readPredicate(token) {
    const next = super._readPredicate(token);
    if ((token.type === 'abbreviation' || token.type === 'inverse') && this._predicate !== null)
      this._predicate = locate(this._predicate, this._sourceRange);
    return next;
  }

  _saveContext(type, graph, subject, predicate, object) {
    if (type === 'list') {
      const nil = locate(this.RDF_NIL, this._sourceRange);
      if (predicate === null)
        subject = nil;
      else if (object === null)
        predicate = nil;
      else
        object = nil;
    }

    super._saveContext(type, graph, subject, predicate, object);
    if (compoundContexts.has(type))
      this._contextStack[this._contextStack.length - 1].sourceRange = this._sourceRange;
  }

  _restoreContext(type, token) {
    const context = this._contextStack[this._contextStack.length - 1];
    if (context && context.type === type && context.sourceRange)
      closeRange(context.sourceRange, token);
    return super._restoreContext(type, token);
  }

  _isRdfNil(term) {
    return unwrap(term) === this.RDF_NIL;
  }

  _readToken(token) {
    if (this._validateTokenRange) {
      if (!Number.isFinite(token.line) || !Number.isFinite(token.start) ||
          token.endLine !== undefined && !Number.isFinite(token.endLine) ||
          !Number.isFinite(token.end))
        throw new TypeError('Lexical provenance requires lexer tokens with numeric line, start, end, and multiline endLine');
    }
    this._currentToken = token;
    this._sourceRange = compoundTokens.has(token.type) ? tokenRange(token, false) : token;

    // Plain strings are constructed while processing a later token. Keep one
    // mutable range so a language, direction, or datatype suffix is included.
    if (this._literalRange !== null &&
        (token.type === 'langcode' || token.type === 'dircode' ||
         token.type === 'type' || token.type === 'typeIRI'))
      closeRange(this._literalRange, token);

    // A dircode replaces the language-only term that was constructed for the
    // same lexical literal, so its factory call still belongs to that range.
    if (token.type === 'dircode')
      this._constructingLiteralRange = this._literalRange;
    let next;
    try {
      next = this._readCallback(token);
    }
    finally {
      this._constructingLiteralRange = null;
    }

    // Install a plain literal's pending range only after the callback. The
    // callback can first complete the preceding literal and then consume this
    // same token recursively (notably for adjacent N3 literals).
    if (token.type === 'literal')
      this._literalRange = token.prefix.length === 0 ? tokenRange(token, true) : null;
    // A language literal may still be replaced by a directional literal.
    else if (next !== this._readDirCode)
      this._literalRange = null;
    return this._readCallback = next;
  }

  _completeLiteral(token, component) {
    this._constructingLiteralRange = this._literalRange;
    try {
      return super._completeLiteral(token, component);
    }
    finally {
      this._constructingLiteralRange = null;
    }
  }

  _readListItem(token) {
    const context = this._contextStack[this._contextStack.length - 1];
    if (token.type !== ')') {
      const headRange = this._subject === null ? context.sourceRange : null;
      this._blankNodeRanges = token.type === '[' || token.type === '{' ?
        [headRange, this._sourceRange] : [headRange];
    }

    try {
      return super._readListItem(token);
    }
    finally {
      this._blankNodeRanges = null;
    }
  }

  _readFormulaTail(token) {
    if (token.type !== '}')
      return super._readFormulaTail(token);

    const context = this._contextStack[this._contextStack.length - 1],
        formula = this._graph,
        range = context.sourceRange,
        empty = this._emptyFormula,
        component = context.subject === formula ? 'subject' :
                    context.predicate === formula ? 'predicate' : 'object';
    const next = super._readFormulaTail(token);
    if (empty && this._emptyFormulaAsTrue)
      this[`_${component}`] = locate(this.N3_TRUE, range);
    return next;
  }

  _readNamedGraphLabel(token) {
    if (token.type === '[')
      this._namedGraphRange = this._sourceRange;
    return super._readNamedGraphLabel(token);
  }

  _readNamedGraphBlankLabel(token) {
    if (token.type === ']') {
      closeRange(this._namedGraphRange, token);
      this._blankNodeRanges = [this._namedGraphRange];
    }
    try {
      return super._readNamedGraphBlankLabel(token);
    }
    finally {
      this._blankNodeRanges = null;
      this._namedGraphRange = null;
    }
  }

  _termId(value) {
    if (value instanceof TermOccurrence)
      return value.entityId || (value.entityId = this._entityIndex.intern(value.term));
    return this._entityIndex.intern(value);
  }

  _emit(subject, predicate, object, graph) {
    graph = graph || this.DEFAULTGRAPH;
    const quad = this._untrackedFactory.quad(
      unwrap(subject), unwrap(predicate), unwrap(object), unwrap(graph),
    );
    if (!quad || quad.termType !== 'Quad')
      throw new TypeError('ProvenanceParser requires an RDF/JS-compatible data factory');

    const quadId = this._entityIndex.internQuad(
      this._termId(subject), this._termId(predicate), this._termId(object),
      graph === this.DEFAULTGRAPH ? 1 : this._termId(graph),
    );
    this._onQuad(quad, quadId,
      occurrenceRange(subject), occurrenceRange(predicate),
      occurrenceRange(object), occurrenceRange(graph));
    this._callback(null, quad);
  }
}
