import ExampleBankParser from './example-bank-parser.js';
import logger from '../utils/logger.js';

// Optional deterministic fast path. The scheduler uses the LLM analyzer
// (src/llm/email-analyzer.js) by default, which needs no per-bank parser.
// Register your own bank parsers here — see example-bank-parser.js.
const parsers = [ExampleBankParser];

export function parseEmail(sender, subject, body) {
  for (const Parser of parsers) {
    if (Parser.matches(sender, subject)) {
      logger.debug(`Matched parser: ${Parser.bankName}`);
      const result = Parser.parse(body);
      if (result) {
        logger.info(`Parsed transaction`, {
          bank: result.bank,
          amount: result.amount,
          merchant: result.merchant,
        });
      } else {
        logger.warn(`Parser ${Parser.bankName} matched but failed to extract data`);
      }
      return result;
    }
  }

  logger.debug('No parser matched for this email');
  return null;
}
