import {
  BlankNode,
  Literal,
  NamedNode,
  Quad,
  Variable,
} from './N3DataFactory';

const NUMERIC_ID = Symbol('numericId');
const SCOPE = Symbol('scope');

function getVirtualDescriptor(target, property) {
  const descriptor = Reflect.getOwnPropertyDescriptor(target, property);
  return property === SCOPE ? { ...descriptor, enumerable: false } : descriptor;
}

function preventTargetExtensions(target) {
  Object.defineProperty(target, SCOPE, { enumerable: false });
  return Reflect.preventExtensions(target);
}

const virtualTermHandler = {
  get(target, property, receiver) {
    if (property === NUMERIC_ID)
      return typeof target.id === 'number' ? target.id : undefined;
    return property === 'id' && typeof target.id === 'number' ?
      target[SCOPE]._registry._entities[target.id] :
      Reflect.get(target, property, receiver);
  },
  getOwnPropertyDescriptor: getVirtualDescriptor,
  preventExtensions(target) {
    target.id = target[SCOPE]._registry._entities[target.id];
    return preventTargetExtensions(target);
  },
};

function expandComposite(target) {
  if (target._subject !== null)
    return;
  const parts = target[SCOPE]._registry._entities[target.id].split('.');
  target._subject = Number(parts[1]);
  target._predicate = Number(parts[2]);
  target._object = Number(parts[3]);
  target._graph = Number(parts[4]) || 1;
}

function getComponent(target, property) {
  expandComposite(target);
  const component = target[property];
  return typeof component === 'number' ?
    (target[property] = virtualTermFromNumericId(component, target[SCOPE])) : component;
}

const virtualQuadHandler = {
  get(target, property, receiver) {
    switch (property) {
    case 'id':         return '';
    case NUMERIC_ID:   return target.id || undefined;
    case '_subject':   return getComponent(target, property);
    case '_predicate': return getComponent(target, property);
    case '_object':    return getComponent(target, property);
    case '_graph':     return getComponent(target, property);
    default:           return Reflect.get(target, property, receiver);
    }
  },
  preventExtensions(target) {
    for (const property of ['_subject', '_predicate', '_object', '_graph'])
      getComponent(target, property);
    target.id = '';
    return preventTargetExtensions(target);
  },
  getOwnPropertyDescriptor: getVirtualDescriptor,
};

function createVirtualTerm(prototype, numericId, scope) {
  const target = Object.create(prototype);
  target.id = numericId;
  target[SCOPE] = scope;
  return new Proxy(target, virtualTermHandler);
}

function createVirtualQuad(subject, predicate, object, graph, scope, compositeId) {
  const target = Object.create(Quad.prototype);
  target.id = compositeId || 0;
  target._subject = subject;
  target._predicate = predicate;
  target._object = object;
  target._graph = graph;
  target[SCOPE] = scope;
  return new Proxy(target, virtualQuadHandler);
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
