const { Quad, NamedNode, Variable } = require('..');

const SUBCLASS_RULE = [{
  premise: [new Quad(
    new Variable('?s'),
    new NamedNode('http://www.w3.org/1999/02/22-rdf-syntax-ns#type'),
    new Variable('?o'),
  ), new Quad(
    new Variable('?o'),
    new NamedNode('http://www.w3.org/2000/01/rdf-schema#subClassOf'),
    new Variable('?o2'),
  )],
  conclusion: [
    new Quad(
      new Variable('?s'),
      new NamedNode('http://www.w3.org/1999/02/22-rdf-syntax-ns#type'),
      new Variable('?o2'),
    ),
  ],
}];

const RDFS_RULE = [{
  premise: [new Quad(
  new Variable('?s'),
  new NamedNode('http://www.w3.org/1999/02/22-rdf-syntax-ns#type'),
  new Variable('?o')
), new Quad(
  new Variable('?o'),
  new NamedNode('http://www.w3.org/2000/01/rdf-schema#subClassOf'),
  new Variable('?o2')
)],
  conclusion: [
    new Quad(
    new Variable('?s'),
    new NamedNode('http://www.w3.org/1999/02/22-rdf-syntax-ns#type'),
    new Variable('?o2')
  ),
  ],
},
{
  premise: [new Quad(
  new Variable('?s'),
  new Variable('?p'),
  new Variable('?o')
)],
  conclusion: [
    new Quad(
    new Variable('?p'),
    new NamedNode('http://www.w3.org/1999/02/22-rdf-syntax-ns#type'),
    new NamedNode('http://www.w3.org/1999/02/22-rdf-syntax-ns#Property')
  ),
  ],
},
{
  premise: [new Quad(
  new Variable('?a'),
  new NamedNode('http://www.w3.org/2000/01/rdf-schema#domain'),
  new Variable('?x')
), new Quad(
  new Variable('?u'),
  new Variable('?a'),
  new Variable('?y')
)],
  conclusion: [
    new Quad(
    new Variable('?u'),
    new NamedNode('http://www.w3.org/1999/02/22-rdf-syntax-ns#type'),
    new Variable('?x')
  ),
  ],
},
{
  premise: [new Quad(
  new Variable('?a'),
  new NamedNode('http://www.w3.org/2000/01/rdf-schema#range'),
  new Variable('?x')
), new Quad(
  new Variable('?u'), // With rules like this we *do not* need to iterate over the subject index so we should avoid doing so
  new Variable('?a'),
  new Variable('?v')
)],
  conclusion: [
    new Quad(
    new Variable('?v'),
    new NamedNode('http://www.w3.org/1999/02/22-rdf-syntax-ns#type'),
    new Variable('?x')
  ),
  ],
},
{
  premise: [new Quad(
  new Variable('?u'),
  new Variable('?a'),
  new Variable('?x')
)],
  conclusion: [
    new Quad(
    new Variable('?u'),
    new NamedNode('http://www.w3.org/1999/02/22-rdf-syntax-ns#type'),
    new NamedNode('http://www.w3.org/2000/01/rdf-schema#Resource')
  ),
    new Quad(
    new Variable('?x'),
    new NamedNode('http://www.w3.org/1999/02/22-rdf-syntax-ns#type'),
    new NamedNode('http://www.w3.org/2000/01/rdf-schema#Resource')
  ),
  ],
},
{
  premise: [new Quad(
  new Variable('?u'),
  new NamedNode('http://www.w3.org/2000/01/rdf-schema#subPropertyOf'),
  new Variable('?v')
), new Quad(
  new Variable('?v'),
  new NamedNode('http://www.w3.org/2000/01/rdf-schema#subPropertyOf'),
  new Variable('?x')
)],
  conclusion: [
    new Quad(
    new Variable('?u'),
    new NamedNode('http://www.w3.org/2000/01/rdf-schema#subPropertyOf'),
    new Variable('?x')
  ),
  ],
},
{
  premise: [new Quad(
  new Variable('?u'),
  new NamedNode('http://www.w3.org/1999/02/22-rdf-syntax-ns#type'),
  new NamedNode('http://www.w3.org/2000/01/rdf-schema#Class')
)],
  conclusion: [
    new Quad(
    new Variable('?u'),
    new NamedNode('http://www.w3.org/2000/01/rdf-schema#subClassOf'),
    new NamedNode('http://www.w3.org/2000/01/rdf-schema#Resource')
  ),
  ],
},
{
  premise: [new Quad(
  new Variable('?u'),
  new NamedNode('http://www.w3.org/2000/01/rdf-schema#subClassOf'),
  new Variable('?x')
), new Quad(
  new Variable('?v'),
  new NamedNode('http://www.w3.org/1999/02/22-rdf-syntax-ns#type'),
  new Variable('?u')
)],
  conclusion: [
    new Quad(
    new Variable('?v'),
    new NamedNode('http://www.w3.org/1999/02/22-rdf-syntax-ns#type'),
    new Variable('?x')
  ),
  ],
}, {
  premise: [new Quad(
  new Variable('?u'),
  new NamedNode('http://www.w3.org/1999/02/22-rdf-syntax-ns#type'),
  new NamedNode('http://www.w3.org/2000/01/rdf-schema#Class')
)],
  conclusion: [
    new Quad(
    new Variable('?u'),
    new NamedNode('http://www.w3.org/2000/01/rdf-schema#subClassOf'),
    new Variable('?u')
  ),
  ],
},
{
  premise: [new Quad(
  new Variable('?u'),
  new NamedNode('http://www.w3.org/2000/01/rdf-schema#subClassOf'),
  new Variable('?v')
), new Quad(
  new Variable('?v'),
  new NamedNode('http://www.w3.org/2000/01/rdf-schema#subClassOf'),
  new Variable('?x')
)],
  conclusion: [
    new Quad(
    new Variable('?u'),
    new NamedNode('http://www.w3.org/2000/01/rdf-schema#subClassOf'),
    new Variable('?x')
  ),
  ],
}, {
  premise: [new Quad(
  new Variable('?u'),
  new NamedNode('http://www.w3.org/1999/02/22-rdf-syntax-ns#type'),
  new NamedNode('http://www.w3.org/2000/01/rdf-schema#ContainerMembershipProperty')
)],
  conclusion: [
    new Quad(
    new Variable('?u'),
    new NamedNode('http://www.w3.org/2000/01/rdf-schema#subPropertyOf'),
    new NamedNode('http://www.w3.org/2000/01/rdf-schema#member')
  ),
  ],
},
{
  premise: [new Quad(
  new Variable('?u'),
  new NamedNode('http://www.w3.org/1999/02/22-rdf-syntax-ns#type'),
  new NamedNode('http://www.w3.org/2000/01/rdf-schema#Datatype')
)],
  conclusion: [
    new Quad(
    new Variable('?u'),
    new NamedNode('http://www.w3.org/2000/01/rdf-schema#subClassOf'),
    new NamedNode('http://www.w3.org/2000/01/rdf-schema#Literal')
  ),
  ],
},
];

module.exports = {
  RDFS_RULE,
  SUBCLASS_RULE,
};
