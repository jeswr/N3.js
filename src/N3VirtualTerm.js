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
const COMPONENTS = ['_subject', '_predicate', '_object', '_graph'];
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
  if (instance._subject !== null)
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
  if (instance[NUMERIC_ID] !== undefined)
    instance[NUMERIC_ID] = undefined;
}

function hiddenValue() {
  return { configurable: true, value: undefined, writable: true };
}

const TERM_DESCRIPTORS = {
  ...Object.getOwnPropertyDescriptors(TERM_ACCESSORS),
  [NUMERIC_ID]: hiddenValue(),
  [SCOPE]: hiddenValue(),
  [ID]: hiddenValue(),
};
const QUAD_SCOPE_DESCRIPTOR = hiddenValue();
const QUAD_NUMERIC_ID_DESCRIPTOR = hiddenValue();

export class VirtualQuad extends Quad {
  constructor(subject, predicate, object, graph, scope, numericId) {
    super(subject, predicate, object, graph);
    QUAD_SCOPE_DESCRIPTOR.value = scope;
    Object.defineProperty(this, SCOPE, QUAD_SCOPE_DESCRIPTOR);
    QUAD_SCOPE_DESCRIPTOR.value = undefined;
    if (numericId !== undefined) {
      QUAD_NUMERIC_ID_DESCRIPTOR.value = numericId;
      Object.defineProperty(this, NUMERIC_ID, QUAD_NUMERIC_ID_DESCRIPTOR);
      QUAD_NUMERIC_ID_DESCRIPTOR.value = undefined;
    }
  }

  get subject() { return getComponent(this, 0); }
  set subject(subject) { setComponent(this, 0, subject); }
  get predicate() { return getComponent(this, 1); }
  set predicate(predicate) { setComponent(this, 1, predicate); }
  get object() { return getComponent(this, 2); }
  set object(object) { setComponent(this, 2, object); }
  get graph() { return getComponent(this, 3); }
  set graph(graph) { setComponent(this, 3, graph); }

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
  return new VirtualQuad(subject, predicate, object, graph, scope, numericId);
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
