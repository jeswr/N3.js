// **N3ProvenanceIndex** stores and resolves the locations of quad utterances.
import { N3EntityIndex } from './N3Store';
import { termRanges } from './N3TermLocationParser';

export class ProvenanceIndex {
  constructor(entityIndex = new N3EntityIndex()) {
    this._entityIndex = entityIndex;
    this._quadOccurrences = Object.create(null);
  }

  _add(quad) {
    const quadId = this._entityIndex._termToNewNumericId(quad);
    const occurrence = {
      subject: termRanges(quad.subject),
      predicate: termRanges(quad.predicate),
      object: termRanges(quad.object),
      graph: termRanges(quad.graph),
    };
    const occurrences = this._quadOccurrences[quadId];
    if (occurrences === undefined)
      this._quadOccurrences[quadId] = [occurrence];
    else
      occurrences.push(occurrence);
  }

  _quad(quadId) {
    return this._entityIndex._termFromId(this._entityIndex._entities[quadId]);
  }

  _withQuad(quad, occurrences) {
    return occurrences.map(occurrence => ({ quad, ...occurrence }));
  }

  get(quad) {
    const quadId = this._entityIndex._termToNumericId(quad);
    const occurrences = this._quadOccurrences[quadId];
    return occurrences === undefined ? [] : this._withQuad(quad, occurrences);
  }

  *[Symbol.iterator]() {
    for (const quadId in this._quadOccurrences)
      yield this._withQuad(this._quad(quadId), this._quadOccurrences[quadId]);
  }
}
