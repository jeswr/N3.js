// **N3ProvenanceIndex** stores and resolves the locations of quad utterances.
import { N3EntityIndex } from './N3Store';

export class ProvenanceIndex {
  constructor(entityIndex = new N3EntityIndex()) {
    this._entityIndex = entityIndex;
    this._quadOccurrences = Object.create(null);
  }

  _add(quad, occurrence) {
    const quadId = this._entityIndex._termToNewNumericId(quad);
    const occurrences = this._quadOccurrences[quadId];
    if (occurrences === undefined)
      this._quadOccurrences[quadId] = [occurrence];
    else
      occurrences.push(occurrence);
  }

  _quad(quadId) {
    return this._entityIndex._termFromId(this._entityIndex._entities[quadId]);
  }

  get(quad) {
    const quadId = this._entityIndex._termToNumericId(quad);
    const occurrences = this._quadOccurrences[quadId];
    return occurrences === undefined ? [] : occurrences;
  }

  *[Symbol.iterator]() {
    for (const quadId in this._quadOccurrences)
      yield [this._quad(quadId), this._quadOccurrences[quadId]];
  }
}
