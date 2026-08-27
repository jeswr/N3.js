import {
  BlankNode,
  Literal,
  NamedNode,
  Quad,
  Variable,
} from './N3DataFactory';

const NUMERIC_ID = Symbol('numericId');
const SCOPE = Symbol('scope');
const ID = Symbol('id');
const SUBJECT = Symbol('subject');
const PREDICATE = Symbol('predicate');
const OBJECT = Symbol('object');
const GRAPH = Symbol('graph');
const COMPONENTS = [SUBJECT, PREDICATE, OBJECT, GRAPH];
const FROZEN_COMPONENTS = new WeakMap();

function assertMutable(instance) {
  if (Object.isFrozen(instance))
    throw new TypeError('Cannot modify a frozen virtual term');
}

const TERM_ACCESSORS = {
  get id() {
    const numericId = this[NUMERIC_ID];
    return numericId === undefined ? this[ID] :
      this[SCOPE]._registry._entities[numericId];
  },
  set id(id) {
    assertMutable(this);
    this[NUMERIC_ID] = undefined;
    this[ID] = id;
  },
};

function expandComposite(instance) {
  if (instance[SUBJECT] !== null)
    return undefined;
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
  let components = FROZEN_COMPONENTS.get(instance) || expandComposite(instance);
  const property = COMPONENTS[index], component = components ? components[index] : instance[property];
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

function setComponent(instance, index, component) {
  assertMutable(instance);
  expandComposite(instance);
  instance[COMPONENTS[index]] = component;
  instance[NUMERIC_ID] = undefined;
}

const QUAD_ACCESSORS = {
  get id() { return this[ID]; },
  set id(id) { assertMutable(this); this[ID] = id; },
  get _subject() { return getComponent(this, 0); },
  set _subject(subject) { setComponent(this, 0, subject); },
  get _predicate() { return getComponent(this, 1); },
  set _predicate(predicate) { setComponent(this, 1, predicate); },
  get _object() { return getComponent(this, 2); },
  set _object(object) { setComponent(this, 2, object); },
  get _graph() { return getComponent(this, 3); },
  set _graph(graph) { setComponent(this, 3, graph); },
};

function hiddenValue() {
  return { configurable: true, value: undefined, writable: true };
}

const TERM_DESCRIPTORS = {
  ...Object.getOwnPropertyDescriptors(TERM_ACCESSORS),
  [NUMERIC_ID]: hiddenValue(),
  [SCOPE]: hiddenValue(),
  [ID]: hiddenValue(),
};
const QUAD_DESCRIPTORS = {
  ...Object.getOwnPropertyDescriptors(QUAD_ACCESSORS),
  [NUMERIC_ID]: hiddenValue(),
  [SCOPE]: hiddenValue(),
  [ID]: hiddenValue(),
  [SUBJECT]: hiddenValue(),
  [PREDICATE]: hiddenValue(),
  [OBJECT]: hiddenValue(),
  [GRAPH]: hiddenValue(),
};

// Reuse descriptor objects so an emitted term is the only per-result allocation.
// Construction is synchronous; clear scope values afterwards to avoid retaining a store.
function setDescriptorValue(descriptors, property, value) {
  descriptors[property].value = value;
}

function createVirtualTerm(prototype, numericId, scope) {
  setDescriptorValue(TERM_DESCRIPTORS, NUMERIC_ID, numericId);
  setDescriptorValue(TERM_DESCRIPTORS, SCOPE, scope);
  setDescriptorValue(TERM_DESCRIPTORS, ID, undefined);
  const term = Object.create(prototype, TERM_DESCRIPTORS);
  setDescriptorValue(TERM_DESCRIPTORS, SCOPE, undefined);
  return term;
}

function createVirtualQuad(subject, predicate, object, graph, scope, numericId) {
  setDescriptorValue(QUAD_DESCRIPTORS, NUMERIC_ID, numericId);
  setDescriptorValue(QUAD_DESCRIPTORS, SCOPE, scope);
  setDescriptorValue(QUAD_DESCRIPTORS, ID, '');
  setDescriptorValue(QUAD_DESCRIPTORS, SUBJECT, subject);
  setDescriptorValue(QUAD_DESCRIPTORS, PREDICATE, predicate);
  setDescriptorValue(QUAD_DESCRIPTORS, OBJECT, object);
  setDescriptorValue(QUAD_DESCRIPTORS, GRAPH, graph);
  const quad = Object.create(Quad.prototype, QUAD_DESCRIPTORS);
  setDescriptorValue(QUAD_DESCRIPTORS, SCOPE, undefined);
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
  case '.': return createVirtualQuad(null, null, null, null, scope, numericId);
  default:  return createVirtualTerm(NamedNode.prototype, numericId, scope);
  }
}

export function virtualQuadFromNumericIds(subject, predicate, object, graph, scope) {
  return createVirtualQuad(
    Number(subject), Number(predicate), Number(object), Number(graph), scope,
  );
}

export function getNumericId(term, registry) {
  return term && term[SCOPE]?._registry === registry ? term[NUMERIC_ID] : undefined;
}
