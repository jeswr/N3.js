import { Literal } from './N3DataFactory';

const NUMERIC_ID = Symbol('numericId');
const ENCODED_ID = Symbol('encodedId');
const SCOPE = Symbol('scope');
const VIRTUAL_STATE = Symbol('virtualState');
const COMPONENTS = ['_subject', '_predicate', '_object', '_graph'];
const TERM_CACHE_SIZE = 256;
const FROZEN_COMPONENTS = new WeakMap();
const NON_EXTENSIBLE_IDS = new WeakMap();

const LITERAL_VALUE = Object.getOwnPropertyDescriptor(Literal.prototype, 'value').get;
const LITERAL_LANGUAGE = Object.getOwnPropertyDescriptor(Literal.prototype, 'language').get;
const LITERAL_DIRECTION = Object.getOwnPropertyDescriptor(Literal.prototype, 'direction').get;
const LITERAL_DATATYPE = Object.getOwnPropertyDescriptor(Literal.prototype, 'datatype').get;
const LITERAL_DATATYPE_STRING = Object.getOwnPropertyDescriptor(Literal.prototype, 'datatypeString').get;

function getEncodedId(instance) {
  let id = instance[ENCODED_ID];
  if (id === undefined)
    id = NON_EXTENSIBLE_IDS.get(instance);
  if (id !== undefined)
    return id;
  id = instance[SCOPE]._registry._entities[instance[NUMERIC_ID]];
  if (Object.isExtensible(instance))
    instance[ENCODED_ID] = id;
  else
    NON_EXTENSIBLE_IDS.set(instance, id);
  return id;
}

function expandComposite(instance) {
  const parts = getEncodedId(instance).split('.');
  const components = [
    +parts[1],
    +parts[2],
    +parts[3],
    +parts[4] || 1,
  ];
  try {
    for (let index = 0; index < COMPONENTS.length; index++)
      instance[COMPONENTS[index]] = components[index];
    return undefined;
  }
  catch (error) {
    if (!Object.isFrozen(instance))
      throw error;
    FROZEN_COMPONENTS.set(instance, components);
    return components;
  }
}

function getComponent(instance, index) {
  const property = COMPONENTS[index];
  let component = instance[property];
  if (component !== null && typeof component === 'object')
    return component;

  let components = FROZEN_COMPONENTS.get(instance);
  if (!components && (component === null || component === undefined))
    components = expandComposite(instance);
  component = components ? components[index] : instance[property];
  if (typeof component !== 'number')
    return component;
  const scope = instance[SCOPE];
  const term = createVirtualTerm(+component, scope[VIRTUAL_STATE]);
  if (components)
    components[index] = term;
  else {
    try {
      instance[property] = term;
    }
    catch (error) {
      if (!Object.isFrozen(instance))
        throw error;
      components = COMPONENTS.map(componentProperty => instance[componentProperty]);
      components[index] = term;
      FROZEN_COMPONENTS.set(instance, components);
    }
  }
  return term;
}

export class VirtualTerm {
  constructor(numericId) {
    this[NUMERIC_ID] = numericId;
  }

  get id() {
    const id = getEncodedId(this);
    return id[0] === '.' ? '' : id;
  }

  get termType() {
    if (this[NUMERIC_ID] === 1)
      return 'DefaultGraph';
    switch (getEncodedId(this)[0]) {
    case '?': return 'Variable';
    case '_': return 'BlankNode';
    case '"': return 'Literal';
    case '.': return 'Quad';
    default:  return 'NamedNode';
    }
  }

  get value() {
    if (this[NUMERIC_ID] === 1)
      return '';
    const id = getEncodedId(this);
    switch (id[0]) {
    case '?': return id.substr(1);
    case '_': return id.substr(2);
    case '"': return LITERAL_VALUE.call(this);
    case '.': return '';
    default:  return id;
    }
  }

  get language() { return LITERAL_LANGUAGE.call(this); }
  get direction() { return LITERAL_DIRECTION.call(this); }
  get datatype() { return LITERAL_DATATYPE.call(this); }
  get datatypeString() { return LITERAL_DATATYPE_STRING.call(this); }
  get subject() { return getComponent(this, 0); }
  get predicate() { return getComponent(this, 1); }
  get object() { return getComponent(this, 2); }
  get graph() { return getComponent(this, 3); }

  equals(other) {
    if (!other)
      return false;
    if (other[SCOPE]?._registry === this[SCOPE]._registry)
      return other[NUMERIC_ID] === this[NUMERIC_ID];
    if (this[NUMERIC_ID] === 1)
      return other.termType === 'DefaultGraph';
    const id = getEncodedId(this);
    if (id[0] === '"')
      return Literal.prototype.equals.call(this, other);
    if (id[0] === '.')
      return this.subject.equals(other.subject)     &&
             this.predicate.equals(other.predicate) &&
             this.object.equals(other.object)       &&
             this.graph.equals(other.graph);
    return this.termType === other.termType && this.value === other.value;
  }

  hashCode() {
    return 0;
  }

  toJSON() {
    const termType = this.termType;
    if (termType === 'Literal')
      return Literal.prototype.toJSON.call(this);
    if (termType === 'Quad') {
      return {
        termType,
        subject:   this.subject.toJSON(),
        predicate: this.predicate.toJSON(),
        object:    this.object.toJSON(),
        graph:     this.graph.toJSON(),
      };
    }
    return { termType, value: this.value };
  }
}

export class VirtualQuad {
  constructor(subject, predicate, object, graph) {
    this._subject = subject;
    this._predicate = predicate;
    this._object = object;
    this._graph = graph;
  }

  get id() { return ''; }
  get termType() { return 'Quad'; }
  get value() { return ''; }
  get subject() { return getComponent(this, 0); }
  get predicate() { return getComponent(this, 1); }
  get object() { return getComponent(this, 2); }
  get graph() { return getComponent(this, 3); }

  toJSON() {
    return {
      termType:  this.termType,
      subject:   this.subject.toJSON(),
      predicate: this.predicate.toJSON(),
      object:    this.object.toJSON(),
      graph:     this.graph.toJSON(),
    };
  }

  equals(other) {
    return !!other && this.subject.equals(other.subject)     &&
                      this.predicate.equals(other.predicate) &&
                      this.object.equals(other.object)       &&
                      this.graph.equals(other.graph);
  }

  hashCode() {
    return 0;
  }
}

function getVirtualState(scope) {
  let state = scope[VIRTUAL_STATE];
  if (state)
    return state;

  class ScopedVirtualQuad extends VirtualQuad {}
  class ScopedVirtualTerm extends VirtualTerm {}
  Object.defineProperties(ScopedVirtualQuad.prototype, {
    constructor: { value: VirtualQuad },
    [SCOPE]: { value: scope },
  });
  Object.defineProperties(ScopedVirtualTerm.prototype, {
    constructor: { value: VirtualTerm },
    [SCOPE]: { value: scope },
  });
  state = {
    Quad: ScopedVirtualQuad,
    Term: ScopedVirtualTerm,
    cache: undefined,
  };
  Object.defineProperty(scope, VIRTUAL_STATE, { value: state });
  return state;
}

function createVirtualQuad(subject, predicate, object, graph, scope) {
  const ScopedVirtualQuad = getVirtualState(scope).Quad;
  return new ScopedVirtualQuad(subject, predicate, object, graph);
}

export function virtualTermFromNumericId(numericId, scope) {
  const state = getVirtualState(scope);
  return createVirtualTerm(+numericId, state);
}

function createVirtualTerm(numericId, state) {
  // A direct-mapped cache bounds retained terms without LRU bookkeeping.
  const cacheIndex = numericId % TERM_CACHE_SIZE;
  const cached = state.cache?.[cacheIndex];
  if (cached?.[NUMERIC_ID] === numericId)
    return cached;

  const term = new state.Term(numericId);
  (state.cache ??= [])[cacheIndex] = term;
  return term;
}

export function virtualQuadFromNumericIds(subject, predicate, object, graph, scope) {
  return createVirtualQuad(+subject, +predicate, +object, +graph, scope);
}

export function getNumericId(term, registry) {
  return term && term[SCOPE]?._registry === registry ? term[NUMERIC_ID] : undefined;
}
