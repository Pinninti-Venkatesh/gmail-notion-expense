import BaseParser from './base-parser.js';

/**
 * Reference implementation showing how to add a regex parser for a bank.
 *
 * The LLM analyzer (src/llm/email-analyzer.js) handles arbitrary bank formats
 * and is what the scheduler uses by default. Add a parser here only if you want
 * a deterministic fast path for a bank you receive alerts from.
 *
 * To add one: copy this file, adjust `bankIdentifiers` and the `parse` regex to
 * match your bank's alert format, then register it in parser-registry.js.
 */
export default class ExampleBankParser extends BaseParser {
  static bankName = 'ExampleBank';

  static bankIdentifiers = {
    senders: ['alerts@examplebank.test'],
    subjectPatterns: [/ExampleBank Credit Card/i],
  };

  // Matches alerts shaped like:
  // "ExampleBank Card XX1234 for Rs. 1,250.00 at MERCHANT on 15-01-2025"
  static parse(body) {
    const regex =
      /ExampleBank Card XX(\d{4}) for Rs\.?\s*([\d,]+\.?\d*)\s*at\s+(.+?)\s+on\s+(\d{2}-\d{2}-\d{4})/i;

    const match = body.match(regex);
    if (!match) return null;

    return {
      cardLast4: match[1],
      amount: this.parseAmount(match[2]),
      merchant: this.normalizeMerchant(match[3]),
      date: this.normalizeDate(match[4], 'DD-MM-YYYY'),
      bank: this.bankName,
    };
  }
}
