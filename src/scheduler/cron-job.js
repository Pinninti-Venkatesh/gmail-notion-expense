import cron from "node-cron";
import config from "../config/index.js";
import { isAuthenticated } from "../auth/gmail-auth.js";
import {
  fetchNewAlertEmails,
  getEmailDetails,
  extractSenderEmail,
  extractSubject,
  extractEmailBody,
} from "../gmail/gmail-client.js";
import { parseEmail } from "../parsers/parser-registry.js";
import { categorize } from "../categorizer/categorizer.js";
import {
  insertExpense,
  findExpenseByEmailId,
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

  isProcessing = true;
  const results = { processed: 0, skipped: 0, failed: 0, errors: [] };

  try {
    // Look back 1 hour
    const afterTimestamp = Date.now() - 1 * 24 * 60 * 60 * 1000;
    // const afterTimestamp = new Date("2026-04-06T00:01:00+05:30").getTime();
    const messages = await fetchNewAlertEmails(afterTimestamp);

    if (messages.length === 0) {
      logger.debug("No new alert emails found");
      return results;
    }

    logger.info(`Found ${messages.length} alert email(s)`);

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

        const parsed = parseEmail(sender, subject, body);
        if (!parsed) {
          logger.warn(`Could not parse email ${messageId}`, {
            sender,
            subject: subject.substring(0, 80),
          });
          // Mark as processed so we don't retry non-transaction emails forever
          processedIds.add(messageId);
          results.failed++;
          continue;
        }

        // Secondary deduplication: check Notion directly in case local state was lost
        const alreadyInserted = await findExpenseByEmailId(messageId);
        if (alreadyInserted) {
          logger.info(`Email ${messageId} already exists in Notion, skipping`);
          processedIds.add(messageId);
          results.skipped++;
          continue;
        }

        const category = categorize(parsed.merchant);

        await insertExpense({
          merchant: parsed.merchant,
          amount: parsed.amount,
          category,
          date: parsed.date,
          bank: parsed.bank,
          emailId: messageId,
        });

        processedIds.add(messageId);
        results.processed++;
      } catch (err) {
        logger.error(`Failed to process email ${messageId}`, err.message);
        results.failed++;
        results.errors.push({ messageId, error: err.message });
      }
    }

    // Persist processed IDs
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
