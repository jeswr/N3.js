import * as RDF from '@rdfjs/types';
import { termToId, termFromId } from './N3DataFactory';

// Note the indexes are just spo rotated
// Same as just having 123 rotated

const SUBJECT = 1;
const PREDICATE = 2;
const OBJECT = 3;

const SPO = 1;
const POS = 2;
const OSP = 3;

type Keys = 's' | 'p' | 'o';
type Index = 'spo' | 'osp' | 'pos';

const map = { s: 'po', p: 'os',  }

Object.values

export class Graphs {
  private [SUBJECT] = {};
  private [PREDICATE] = {};
  private [OBJECT] = {};

}

// TODO: Use these
const IDS = Symbol('ids');
const ID = Symbol('id');
const ENTITIES = Symbol('entities');
const BLANK_NODE_INDEX = Symbol('blankNodeIndex');
const FACTORY = Symbol('factory')

export class N3EntityIndex {
  // This should *not* be written to outside of this class
  private ids: Record<string, number> = {};
  // This should *not* be written to outside of this class
  private entities: Record<number, string> = {};
  // TODO: Use bigint
  private id = 1;
  private blankNodeIndex = 0;
  private factory: RDF.DataFactory;

  public termToId(term: RDF.Term): number {
    // TODO: Do perf tests to see if we need a version like this
    // return this.ids[termToId(term)];
    return (this.ids[termToId(term)] ||= this.id++);
  }

  public termFromId(id: number): RDF.Term {
    // TODO: See if this causes performance problems
    if (!(id in this.entities)) {
      throw new Error(`ID ${id} not in EntityIndex`)
    }
    return termFromId(this.entities[id], this.factory);
  }

  public createBlankNode(suggestedName?: string) {
    let name: string, index: number;
    // Generate a name based on the suggested name
    if (suggestedName) {
      name = suggestedName = `_:${suggestedName}`, index = 1;
      while (this.ids[name])
        name = suggestedName + index++;
    }
    // Generate a generic blank node name
    else {
      do { name = `_:b${this.blankNodeIndex++}`; }
      while (this.ids[name]);
    }
    // Add the blank node to the entities, avoiding the generation of duplicates
    this.entities[this.ids[name] = ++this.id] = name;
    return this.factory.blankNode(name.slice(2));
  }
}
