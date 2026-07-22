import cron from "node-cron";
import config from "../config/index.js";
import { isAuthenticated } from "../auth/gmail-auth.js";
import {
  fetchTransactionEmails,
  getEmailDetails,
  extractSenderEmail,
  extractSubject,
  extractEmailBody,
  extractEmailDate,
  addKnownSender,
  findMerchantEmail,
} from "../gmail/gmail-client.js";
import {
  analyzeTransactionEmail,
  categorizeTransaction,
  summarizeOrderEmail,
} from "../llm/email-analyzer.js";
import { isOllamaAvailable } from "../llm/ollama-client.js";
import {
  insertExpense,
  findExpenseByEmailId,
  fetchAllExpensesWithEmailIds,
  updateExpenseDate,
} from "../notion/notion-client.js";
import { readJSON, writeJSON } from "../utils/state-manager.js";
import logger from "../utils/logger.js";

let isProcessing = false;

export async function processEmails() {
  if (isProcessing) {
    logger.warn("Previous poll still running, skipping");
    return { skipped: true };
  }

  if (!isAuthenticated()) {
    logger.warn("Gmail not authenticated, skipping poll");
    return { skipped: true, reason: "not_authenticated" };
  }

  // Check Ollama availability
  const ollamaReady = await isOllamaAvailable();
  if (!ollamaReady) {
    logger.warn(
      "Ollama not available, skipping poll. Ensure Ollama is running with phi3 model.",
    );
    return { skipped: true, reason: "ollama_unavailable" };
  }

  isProcessing = true;
  const results = {
    processed: 0,
    skipped: 0,
    failed: 0,
    newSenders: 0,
    enriched: 0,
    errors: [],
  };

  try {
    // const afterTimestamp = Date.now() - 1 * 24 * 60 * 60 * 1000;
    const afterTimestamp = new Date("2026-06-30T00:01:00+05:30").getTime();
    const messages = await fetchTransactionEmails(afterTimestamp);

    if (messages.length === 0) {
      logger.debug("No new emails found");
      return results;
    }

    logger.info(`Found ${messages.length} email(s) to analyze`);

    // Log all fetched email subjects for debugging
    for (const m of messages) {
      const detail = await getEmailDetails(m.id);
      const subj = extractSubject(detail);
      const from = extractSenderEmail(detail);
      logger.info(`  Fetched: [${m.id}] [${from}] ${subj}`);
    }

    const processedIds = new Set(readJSON(config.paths.processedEmails));

    for (const msg of messages) {
      const messageId = msg.id;

      if (processedIds.has(messageId)) {
        results.skipped++;
        continue;
      }

      try {
        const email = await getEmailDetails(messageId);
        const sender = extractSenderEmail(email);
        const subject = extractSubject(email);
        const body = extractEmailBody(email);
        const emailDate = extractEmailDate(email);

        // LLM analyzes if this is a transaction and extracts details
        const parsed = await analyzeTransactionEmail(sender, subject, body);

        if (!parsed) {
          logger.debug(
            `Email ${messageId} is not a transaction (sender: ${sender})`,
          );
          processedIds.add(messageId);
          results.skipped++;
          continue;
        }

        // Auto-learn this sender for future fast-path queries
        addKnownSender(sender);
        results.newSenders++;

        // Dedup check against Notion
        const alreadyInserted = await findExpenseByEmailId(messageId);
        if (alreadyInserted) {
          logger.info(`Email ${messageId} already exists in Notion, skipping`);
          processedIds.add(messageId);
          results.skipped++;
          continue;
        }

        // Try to find a correlated merchant email for richer description
        let description = null;
        try {
          const merchantEmail = await findMerchantEmail(
            parsed.merchant,
            emailDate,
          );
          if (merchantEmail) {
            const merchantBody = extractEmailBody(merchantEmail);
            description = await summarizeOrderEmail(merchantBody);
            if (description) {
              logger.info(
                `Enriched transaction with order details: ${description.substring(0, 60)}...`,
              );
              results.enriched++;
            }
          }
        } catch (err) {
          logger.debug(
            `Merchant email enrichment failed for ${parsed.merchant}`,
            err.message,
          );
        }

        // LLM-powered smart categorization (uses description for context)
        const category = await categorizeTransaction(
          parsed.merchant,
          description,
        );

        await insertExpense({
          merchant: parsed.merchant,
          amount: parsed.amount,
          category,
          date: emailDate,
          bank: parsed.bank,
          emailId: messageId,
          paymentType: parsed.paymentType,
          cardLast4: parsed.cardLast4,
          description,
        });

        processedIds.add(messageId);
        results.processed++;
      } catch (err) {
        logger.error(`Failed to process email ${messageId}`, err.message);
        results.failed++;
        results.errors.push({ messageId, error: err.message });
      }
    }

    writeJSON(config.paths.processedEmails, [...processedIds]);
    logger.info("Poll complete", results);
  } catch (err) {
    logger.error("Poll failed", err.message);
    if (err.message === "invalid_grant") {
      results.errors.push({
        error: "invalid_grant",
        hint: "Gmail token expired. Re-authenticate at /api/auth.",
      });
    } else {
      results.errors.push({ error: err.message });
    }
  } finally {
    isProcessing = false;
  }

  return results;
}

export async function reconcileDates() {
  if (!isAuthenticated()) {
    return { error: "Gmail not authenticated" };
  }

  const entries = await fetchAllExpensesWithEmailIds();
  logger.info(`Reconciling dates for ${entries.length} Notion entries`);

  const results = { checked: 0, fixed: 0, failed: 0, fixes: [] };

  for (const entry of entries) {
    results.checked++;
    try {
      const email = await getEmailDetails(entry.emailId);
      const correctDate = extractEmailDate(email);

      if (entry.date !== correctDate) {
        await updateExpenseDate(entry.pageId, correctDate);
        logger.info(
          `Fixed date for "${entry.merchant}": ${entry.date} → ${correctDate}`,
        );
        results.fixed++;
        results.fixes.push({
          merchant: entry.merchant,
          oldDate: entry.date,
          newDate: correctDate,
        });
      }
    } catch (err) {
      logger.warn(`Failed to reconcile ${entry.emailId}`, err.message);
      results.failed++;
    }
  }

  logger.info(`Date reconciliation complete`, results);
  return results;
}

export function startCron() {
  const minutes = config.cron.pollIntervalMinutes;
  const schedule = `*/${minutes} * * * *`;

  logger.info(`Starting cron: every ${minutes} minute(s)`);

  cron.schedule(schedule, () => {
    processEmails().catch((err) =>
      logger.error("Cron poll error", err.message),
    );
  });
}
