import { Client } from '@notionhq/client';
import config from '../config/index.js';
import logger from '../utils/logger.js';

const notion = new Client({ auth: config.notion.apiKey });
const databaseId = config.notion.databaseId;

export async function insertExpense(expense) {
  const { merchant, amount, category, date, bank, emailId, paymentType, cardLast4, description } = expense;

  const properties = {
    Expense: {
      title: [{ text: { content: merchant } }],
    },
    Amount: {
      number: amount,
    },
    Category: {
      multi_select: [{ name: category }],
    },
    Date: {
      date: { start: date },
    },
    'Payment Type': {
      select: { name: paymentType || 'Credit Card' },
    },
    Platform: {
      select: { name: bank },
    },
    Comment: {
      rich_text: [{ text: { content: `Gmail ID: ${emailId}` } }],
    },
  };

  // Add card last 4 digits if available
  if (cardLast4) {
    properties['Card'] = {
      rich_text: [{ text: { content: `XX${cardLast4}` } }],
    };
  }

  // Add description if available (from correlated merchant email)
  if (description) {
    properties['Description'] = {
      rich_text: [{ text: { content: description } }],
    };
  }

  const response = await notion.pages.create({
    parent: { database_id: databaseId },
    properties,
  });

  logger.info(`Inserted expense into Notion: ${merchant} - ${amount}`);
  return response;
}

export async function findExpenseByEmailId(emailId) {
  const response = await notion.databases.query({
    database_id: databaseId,
    filter: {
      property: 'Comment',
      rich_text: {
        contains: `Gmail ID: ${emailId}`,
      },
    },
    page_size: 1,
  });
  return response.results.length > 0;
}

export async function fetchCategorizedEntries() {
  const entries = [];
  let cursor = undefined;

  do {
    const response = await notion.databases.query({
      database_id: databaseId,
      start_cursor: cursor,
      page_size: 100,
    });

    for (const page of response.results) {
      const props = page.properties;

      const name =
        props.Expense?.title?.[0]?.text?.content || '';
      const category =
        props.Category?.multi_select?.[0]?.name || '';

      if (name && category) {
        entries.push({ merchant: name, category });
      }
    }

    cursor = response.has_more ? response.next_cursor : undefined;
  } while (cursor);

  logger.info(`Fetched ${entries.length} categorized entries from Notion`);
  return entries;
}

export async function fetchAllExpensesWithEmailIds() {
  const entries = [];
  let cursor = undefined;

  do {
    const response = await notion.databases.query({
      database_id: databaseId,
      start_cursor: cursor,
      page_size: 100,
    });

    for (const page of response.results) {
      const props = page.properties;
      const comment = props.Comment?.rich_text?.[0]?.text?.content || '';
      const emailIdMatch = comment.match(/Gmail ID: (.+)/);
      if (!emailIdMatch) continue;

      entries.push({
        pageId: page.id,
        emailId: emailIdMatch[1],
        date: props.Date?.date?.start || null,
        merchant: props.Expense?.title?.[0]?.text?.content || '',
      });
    }

    cursor = response.has_more ? response.next_cursor : undefined;
  } while (cursor);

  return entries;
}

export async function updateExpenseDate(pageId, newDate) {
  await notion.pages.update({
    page_id: pageId,
    properties: {
      Date: { date: { start: newDate } },
    },
  });
}
