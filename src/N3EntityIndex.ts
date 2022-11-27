import * as RDF from '@rdfjs/types';
import { termToId, termFromId, default as DataFactory } from './N3DataFactory';

// Note the indexes are just spo rotated
// Same as just having 123 rotated

// const SUBJECT = 1;
// const PREDICATE = 2;
// const OBJECT = 3;

// const SPO = 1;
// const POS = 2;
// const OSP = 3;

// type Keys = 's' | 'p' | 'o';
// type Index = 'spo' | 'osp' | 'pos';

// const map = { s: 'po', p: 'os',  }

// Object.values

// export class Graphs {
//   private [SUBJECT] = {};
//   private [PREDICATE] = {};
//   private [OBJECT] = {};

// }

// TODO: Use these
const IDS = Symbol('ids');
const ID = Symbol('id');
const ENTITIES = Symbol('entities');
const BLANK_NODE_INDEX = Symbol('blankNodeIndex');
const FACTORY = Symbol('factory')

// TODO: Add all these kinds of comments
    // `_ids` maps entities such as `http://xmlns.com/foaf/0.1/name` to numbers,
    // saving memory by using only numbers as keys in `_graphs`
    // this._id = 0;
    // this._ids = Object.create(null);
    // this._ids['><'] = 0; // dummy entry, so the first actual key is non-zero
    // this._entities = Object.create(null); // inverse of `_ids`
    // // `_blankNodeIndex` is the index of the last automatically named blank node
    // this._blankNodeIndex = 0;

export class N3EntityIndex {
  // This should *not* be written to outside of this class
  private ids: Record<string, number> = Object.create(null);
  // This should *not* be written to outside of this class
  // TODO: See if a proper map should be used here
  private entities: Record<number, string> = Object.create(null);
  // TODO: Use bigint
  private id = 0;
  private blankNodeIndex = 0;
  private factory: RDF.DataFactory;

  constructor(options?: { factory?: RDF.DataFactory }) {
    this.factory = options?.factory || DataFactory;
  }

  public termToId(term: RDF.Term): number {
    const ind = termToId(term);
    return this.ids[ind] || (this.ids[this.entities[++this.id] = ind] = this.id);
  }

  public termToMaybeId(term: RDF.Term): number | undefined {
    return this.ids[termToId(term)];
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
