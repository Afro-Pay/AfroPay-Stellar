import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Raised when an anchor's SEP-6 response fails schema validation or cannot be
 * reconciled against the request we sent (wrong account, amount out of the
 * anchor's advertised range). Defaults to 502 Bad Gateway because the anchor is
 * an upstream dependency returning untrustworthy data; callers that reject a
 * client-driven condition (e.g. amount out of range) pass 400 explicitly.
 */
export class AnchorReconciliationException extends HttpException {
  constructor(message: string, status: HttpStatus = HttpStatus.BAD_GATEWAY) {
    super(message, status);
  }
}
