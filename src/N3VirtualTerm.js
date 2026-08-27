import {
  BlankNode,
  Literal,
  NamedNode,
  Quad,
  Variable,
} from './N3DataFactory';

const STATE = Symbol('virtualTermState');

function getState(instance) {
  return instance[STATE];
}

function assertMutable(instance) {
  if (Object.isFrozen(instance))
    throw new TypeError('Cannot modify a frozen virtual term');
}

const TERM_ACCESSORS = {
  get id() {
    const state = getState(this);
    return state.numericId === undefined ? state.id :
      state.scope._registry._entities[state.numericId];
  },
  set id(id) {
    assertMutable(this);
    const state = getState(this);
    state.numericId = undefined;
    state.id = id;
  },
};
const TERM_DESCRIPTORS = Object.getOwnPropertyDescriptors(TERM_ACCESSORS);

function expandComposite(state) {
  if (state.components !== null)
    return;
  const parts = state.scope._registry._entities[state.numericId].split('.');
  state.components = [
    Number(parts[1]),
    Number(parts[2]),
    Number(parts[3]),
    Number(parts[4]) || 1,
  ];
}

function getComponent(instance, index) {
  const state = getState(instance);
  expandComposite(state);
  const component = state.components[index];
  return typeof component === 'number' ?
    (state.components[index] = virtualTermFromNumericId(component, state.scope)) : component;
}

function setComponent(instance, index, component) {
  assertMutable(instance);
  const state = getState(instance);
  expandComposite(state);
  state.components[index] = component;
  state.numericId = undefined;
}

const QUAD_ACCESSORS = {
  get id() { return getState(this).id; },
  set id(id) { assertMutable(this); getState(this).id = id; },
  get _subject() { return getComponent(this, 0); },
  set _subject(subject) { setComponent(this, 0, subject); },
  get _predicate() { return getComponent(this, 1); },
  set _predicate(predicate) { setComponent(this, 1, predicate); },
  get _object() { return getComponent(this, 2); },
  set _object(object) { setComponent(this, 2, object); },
  get _graph() { return getComponent(this, 3); },
  set _graph(graph) { setComponent(this, 3, graph); },
};
const QUAD_DESCRIPTORS = Object.getOwnPropertyDescriptors(QUAD_ACCESSORS);

function createVirtualTerm(prototype, numericId, scope) {
  const term = Object.create(prototype, TERM_DESCRIPTORS);
  Object.defineProperty(term, STATE, { value: { numericId, scope }, writable: true });
  return term;
}

function createVirtualQuad(components, scope, numericId) {
  const quad = Object.create(Quad.prototype, QUAD_DESCRIPTORS);
  Object.defineProperty(quad, STATE, {
    value: { components, id: '', numericId, scope },
    writable: true,
  });
  return quad;
}

export function virtualTermFromNumericId(numericId, scope) {
  numericId = Number(numericId);
  if (numericId === 1)
    return scope._factory.defaultGraph();

  const id = scope._registry._entities[numericId];
  switch (id[0]) {
  case '?': return createVirtualTerm(Variable.prototype, numericId, scope);
  case '_': return createVirtualTerm(BlankNode.prototype, numericId, scope);
  case '"': return createVirtualTerm(Literal.prototype, numericId, scope);
  case '.': return createVirtualQuad(null, scope, numericId);
  default:  return createVirtualTerm(NamedNode.prototype, numericId, scope);
  }
}

export function virtualQuadFromNumericIds(subject, predicate, object, graph, scope) {
  return createVirtualQuad(
    [Number(subject), Number(predicate), Number(object), Number(graph)], scope,
  );
}

export function getNumericId(term, registry) {
  const state = term && term[STATE];
  return state?.scope._registry === registry ? state.numericId : undefined;
}
