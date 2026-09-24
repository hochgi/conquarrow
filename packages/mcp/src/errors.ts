/**
 * Named refusals for the MCP tool surface (P67).
 */

import { ContractViolation } from '@conquarrow/contracts';

export class NoLiveMatch extends Error {
  constructor(message = 'no live match') {
    super(message);
    this.name = 'NoLiveMatch';
  }
}

export class InvalidRoster extends Error {
  constructor(message = 'invalid roster') {
    super(message);
    this.name = 'InvalidRoster';
  }
}

export class UnknownSeat extends Error {
  constructor(message = 'unknown seat') {
    super(message);
    this.name = 'UnknownSeat';
  }
}

export class SeatKindMismatch extends Error {
  constructor(message = 'seat kind mismatch') {
    super(message);
    this.name = 'SeatKindMismatch';
  }
}

export class StaleOfferIndex extends Error {
  constructor(message = 'stale offer index') {
    super(message);
    this.name = 'StaleOfferIndex';
  }
}

/** Wrap engine `ContractViolation`; do not swallow. */
export const wrapContract = (error: unknown): never => {
  if (error instanceof ContractViolation) {
    throw new Error(error.message, { cause: error });
  }
  throw error;
};
