/**
 * Re-export. The implementation lives in `src/moves.ts` so the resume parser
 * and the bench share one strict reader (P90).
 */
export { parseMove, serializeMove, type SerializedMove } from '../../src/moves';
