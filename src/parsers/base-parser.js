export default class BaseParser {
  static bankName = 'Unknown';
  static bankIdentifiers = { senders: [], subjectPatterns: [] };

  static matches(sender, subject) {
    const senderMatch = this.bankIdentifiers.senders.some((s) =>
      sender.includes(s)
    );
    const subjectMatch = this.bankIdentifiers.subjectPatterns.some((p) =>
      p.test(subject)
    );
    return senderMatch || subjectMatch;
  }

  static parseAmount(raw) {
    if (!raw) return 0;
    return parseFloat(raw.replace(/,/g, ''));
  }

  static normalizeMerchant(raw) {
    if (!raw) return 'Unknown';
    return raw
      .replace(/\s+/g, ' ')
      .replace(/[.]+$/, '')
      .trim();
  }

  static normalizeDate(dateStr, format) {
    if (!dateStr) return new Date().toISOString().split('T')[0];

    if (format === 'DD-MM-YYYY') {
      const [dd, mm, yyyy] = dateStr.split('-');
      return `${yyyy}-${mm}-${dd}`;
    }

    if (format === 'Mon DD, YYYY') {
      const parsed = new Date(dateStr + ' 12:00:00');
      if (!isNaN(parsed.getTime())) {
        const y = parsed.getFullYear();
        const m = String(parsed.getMonth() + 1).padStart(2, '0');
        const d = String(parsed.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
      }
    }

    // Fallback: try native parse
    const parsed = new Date(dateStr);
    if (!isNaN(parsed.getTime())) {
      return parsed.toISOString().split('T')[0];
    }

    return new Date().toISOString().split('T')[0];
  }

  // Subclasses must implement: static parse(body)
}
