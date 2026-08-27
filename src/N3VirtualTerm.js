import {
  BlankNode,
  Literal,
  NamedNode,
  Quad,
  Variable,
} from './N3DataFactory';

const NUMERIC_ID = Symbol('numericId');
const SCOPE = Symbol('scope');
const VIRTUAL_STATE = Symbol('virtualState');
const COMPONENTS = ['_subject', '_predicate', '_object', '_graph'];
const TERM_CACHE_SIZE = 256;
const FROZEN_COMPONENTS = new WeakMap();

const TERM_ACCESSORS = {
  get id() {
    return this[SCOPE]._registry._entities[this[NUMERIC_ID]];
  },
};

function expandComposite(instance) {
  const parts = instance[SCOPE]._registry._entities[instance[NUMERIC_ID]].split('.');
  const components = [
    Number(parts[1]),
    Number(parts[2]),
    Number(parts[3]),
    Number(parts[4]) || 1,
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
  if (!components && component === null)
    components = expandComposite(instance);
  component = components ? components[index] : instance[property];
  if (typeof component !== 'number')
    return component;
  const term = virtualTermFromNumericId(component, instance[SCOPE]);
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

const TERM_ACCESSOR_DESCRIPTORS = Object.getOwnPropertyDescriptors(TERM_ACCESSORS);
const NUMERIC_ID_DESCRIPTOR = { configurable: true, value: undefined };

export class VirtualQuad extends Quad {
  constructor(subject, predicate, object, graph, numericId) {
    super(subject, predicate, object, graph);
    if (numericId !== undefined) {
      NUMERIC_ID_DESCRIPTOR.value = numericId;
      Object.defineProperty(this, NUMERIC_ID, NUMERIC_ID_DESCRIPTOR);
      NUMERIC_ID_DESCRIPTOR.value = undefined;
    }
  }

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
}

function getVirtualState(scope) {
  let state = scope[VIRTUAL_STATE];
  if (state)
    return state;

  class ScopedVirtualQuad extends VirtualQuad {}
  Object.defineProperties(ScopedVirtualQuad.prototype, {
    constructor: { value: VirtualQuad },
    [SCOPE]: { value: scope },
  });
  state = { Quad: ScopedVirtualQuad, terms: new Map(), cache: undefined };
  Object.defineProperty(scope, VIRTUAL_STATE, { value: state });
  return state;
}

function createVirtualTerm(prototype, numericId, scope) {
  const state = getVirtualState(scope);
  let scopedPrototype = state.terms.get(prototype);
  if (!scopedPrototype) {
    scopedPrototype = Object.create(prototype, {
      [SCOPE]: { value: scope },
    });
    state.terms.set(prototype, scopedPrototype);
  }
  NUMERIC_ID_DESCRIPTOR.value = numericId;
  const term = Object.create(scopedPrototype, {
    ...TERM_ACCESSOR_DESCRIPTORS,
    [NUMERIC_ID]: NUMERIC_ID_DESCRIPTOR,
  });
  NUMERIC_ID_DESCRIPTOR.value = undefined;
  return term;
}

function createVirtualQuad(subject, predicate, object, graph, scope, numericId) {
  const ScopedVirtualQuad = getVirtualState(scope).Quad;
  return new ScopedVirtualQuad(subject, predicate, object, graph, numericId);
}

export function virtualTermFromNumericId(numericId, scope) {
  numericId = Number(numericId);
  if (numericId === 1)
    return scope._factory.defaultGraph();

  const state = getVirtualState(scope);
  // A direct-mapped cache bounds retained terms without LRU bookkeeping.
  const cacheIndex = numericId % TERM_CACHE_SIZE;
  const cached = state.cache?.[cacheIndex];
  if (cached?.[NUMERIC_ID] === numericId)
    return cached;

  const id = scope._registry._entities[numericId];
  let term;
  switch (id[0]) {
  case '?': term = createVirtualTerm(Variable.prototype, numericId, scope); break;
  case '_': term = createVirtualTerm(BlankNode.prototype, numericId, scope); break;
  case '"': term = createVirtualTerm(Literal.prototype, numericId, scope); break;
  case '.': term = createVirtualQuad(null, null, null, null, scope, numericId); break;
  default:  term = createVirtualTerm(NamedNode.prototype, numericId, scope);
  }
  (state.cache ??= [])[cacheIndex] = term;
  return term;
}

export function virtualQuadFromNumericIds(subject, predicate, object, graph, scope) {
  return createVirtualQuad(
    Number(subject), Number(predicate), Number(object), Number(graph), scope,
  );
}

export function getNumericId(term, registry) {
  return term && term[SCOPE]?._registry === registry ? term[NUMERIC_ID] : undefined;
}
