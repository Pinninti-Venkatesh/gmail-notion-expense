# Gmail-to-Notion Expense Tracker — How It Works

This app automatically reads your credit card transaction alert emails from Gmail, pulls out the merchant name, amount, and date, guesses a category (Food, Shopping, Travel, etc.), and adds a row to your Notion table. No manual entry needed.

---

## The Big Picture

```
Gmail Inbox                          Notion Database
┌──────────────┐                     ┌──────────────────────────────┐
│ Bank alert   │                     │ Name   │ Amount │ Category   │
│ Card alert   │ ──► App polls ──►   │ Swiggy │ 450    │ Food       │
│ UPI alert    │     every 2 min     │ Amazon │ 1200   │ Shopping   │
└──────────────┘                     └──────────────────────────────┘
```

Every 2 minutes, the app:

1. Checks Gmail for new transaction alert emails from your bank
2. Reads each email and extracts the transaction details using a local LLM
3. Looks up the merchant name to assign a category
4. Creates a row in your Notion database
5. Remembers which emails it already processed so it never duplicates

---

## Folder Structure

```
gmail-notion-expense/
├── src/
│   ├── index.js                  # Starts the server and the cron job
│   ├── config/index.js           # Reads your .env file
│   ├── auth/gmail-auth.js        # Handles Gmail login (OAuth2)
│   ├── gmail/gmail-client.js     # Talks to the Gmail API
│   ├── parsers/
│   │   ├── base-parser.js        # Shared helpers (parse amounts, dates, etc.)
│   │   ├── example-bank-parser.js # Reference parser to copy for your bank
│   │   └── parser-registry.js    # Figures out which parser to use
│   ├── categorizer/categorizer.js # Maps merchants to categories
│   ├── notion/notion-client.js   # Talks to the Notion API
│   ├── scheduler/cron-job.js     # Runs the pipeline every 2 minutes
│   ├── routes/api.js             # HTTP endpoints you can hit
│   └── utils/
│       ├── logger.js             # Prints timestamped log messages
│       └── state-manager.js      # Reads/writes JSON files
├── data/
│   ├── processed-emails.json     # List of Gmail IDs already handled
│   └── category-map.json         # Merchant keyword → category mapping
├── .env                          # Your secrets (you create this)
├── .env.example                  # Template for .env
└── package.json
```

---

## How Each Piece Works

### 1. Starting the app (`src/index.js`)

When you run `npm run dev`, this file:

- Starts an Express web server on port 3000
- Registers all the API routes under `/api`
- Kicks off the cron scheduler that polls Gmail every 2 minutes

### 2. Gmail Authentication (`src/auth/gmail-auth.js`)

Gmail doesn't let apps just read your email — you have to log in and grant permission first. This uses Google's **OAuth2** flow:

1. You visit `http://localhost:3000/api/auth` in your browser
2. It redirects you to Google's login page
3. You sign in and click "Allow"
4. Google redirects back to `http://localhost:3000/api/auth/callback` with a code
5. The app exchanges that code for an access token
6. Token gets saved to `data/gmail-token.json`

After this one-time setup, the app reuses the saved token. If it expires, Google's library auto-refreshes it.

### 3. Fetching emails (`src/gmail/gmail-client.js`)

This module talks to the Gmail API. When polled, it:

- Searches your inbox with a query like:

  ```
  (from:alerts@yourbank.example OR subject:(transaction alert OR credit card OR debited)) after:1708000000
  ```

  The `after:` timestamp limits the search to emails from the last 1 hour.

- For each matching email, it fetches the full message and decodes the body.
  Gmail stores email bodies as **base64-encoded** text. The app decodes it back to readable text.
  If the email is HTML-only (no plain text), it strips the HTML tags first.

### 4. Parsing emails (`src/parsers/`)

Optional deterministic fast path. The LLM analyzer handles arbitrary bank formats and is what the scheduler uses by default; add a parser here only if you want regex matching for a specific bank.

**How the registry works:**

- Each parser declares which senders/subjects it handles (e.g., `alerts@examplebank.test`)
- When an email comes in, the registry checks each parser: "Do you recognize this sender?"
- The matching parser runs its regex on the email body

**What the parsers extract:**

| Bank        | Example email text                                                                 | Extracts                                                       |
| ----------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| ExampleBank | `ExampleBank Card XX1234 for Rs. 1,250.00 at SWIGGY on 15-01-2025 14:30:22`       | card: 1234, amount: 1250, merchant: SWIGGY, date: 2025-01-15   |

**Adding your own bank** is just: copy `example-bank-parser.js`, adjust the sender and regex to match your bank's alert format, then import it in `parser-registry.js`.

### 5. Categorizing (`src/categorizer/categorizer.js`)

Once we have the merchant name (e.g., "SWIGGY"), the categorizer looks it up in `data/category-map.json`:

```json
{
  "swiggy": "Food",
  "amazon": "Shopping",
  "uber": "Travel",
  "netflix": "Entertainment"
}
```

The matching logic:

1. **Exact match** — merchant name exactly matches a key
2. **Substring match** — merchant name _contains_ a key (so "AMAZON PAY INDIA PVT" matches the "amazon" key)
3. **Fallback** — if nothing matches, it assigns "General"

The file ships with 50+ pre-seeded Indian merchants (Swiggy, Zomato, Flipkart, Uber, Airtel, etc.).

**Learning from your corrections:**
If you manually change a category in Notion (e.g., you change "General" to "Groceries" for a merchant), you can hit `POST /api/sync-categories`. The app will read all rows from Notion and update the local category map, so future transactions from that merchant get the right category automatically.

### 6. Inserting into Notion (`src/notion/notion-client.js`)

Each parsed + categorized transaction becomes a row in your Notion table:

| Column       | Example Value |
| ------------ | ------------- |
| Name         | SWIGGY        |
| Amount       | 450           |
| Category     | Food          |
| Date         | 2025-01-15    |
| Payment Type | Credit Card   |
| Bank         | ExampleBank   |
| Email ID     | 18d3a5f2c...  |

The "Email ID" column stores the Gmail message ID — this is for auditing and dedup.

### 7. The cron loop (`src/scheduler/cron-job.js`)

Every 2 minutes, this runs the full pipeline:

```
Fetch new emails from Gmail (last 1 hour)
       │
       ▼
Filter out already-processed IDs (from data/processed-emails.json)
       │
       ▼
For each new email:
  ├── Detect which bank it's from
  ├── Parse amount, merchant, date
  ├── Categorize the merchant
  ├── Insert row into Notion
  └── Add email ID to processed list
       │
       ▼
Save updated processed-emails.json
```

Safety features:

- **No duplicates**: processed email IDs are tracked in a local JSON file
- **No overlapping runs**: if a poll is still running when the next one triggers, it's skipped
- **Retry on failure**: if an email fails to process, it is NOT marked as processed — the next poll will try it again

### 8. API endpoints (`src/routes/api.js`)

| Method | URL                    | What it does                                    |
| ------ | ---------------------- | ----------------------------------------------- |
| GET    | `/api/health`          | Returns status + whether Gmail is authenticated |
| GET    | `/api/auth`            | Redirects you to Google login                   |
| GET    | `/api/auth/callback`   | Google redirects here after you log in          |
| POST   | `/api/sync`            | Manually triggers the email poll right now      |
| POST   | `/api/sync-categories` | Reads Notion and updates local category map     |
| GET    | `/api/categories`      | Shows the current merchant-to-category mapping  |

---

## Setup

Setup instructions — Google Cloud OAuth, the Notion integration, the required
database schema and every environment variable — live in the [README](README.md#setup).
They are kept in one place so the two documents cannot drift apart.

This document covers how the pieces work once it is running.

## How Dedup Works (Why You Won't Get Duplicates)

Three layers:

1. **Gmail query**: Only looks at emails from the last 1 hour, so it's not scanning your entire inbox every time
2. **Local tracking**: `data/processed-emails.json` stores every Gmail message ID that was successfully processed. On each poll, the app skips IDs it has already seen.
3. **Audit trail**: The Gmail message ID is also stored in the Notion row's "Email ID" column, so you can always trace a row back to the original email.

---

## How to Add a New Bank

1. Create `src/parsers/newbank-parser.js`:

```js
import BaseParser from "./base-parser.js";

export default class NewBankParser extends BaseParser {
  static bankName = "New Bank";
  static bankIdentifiers = {
    senders: ["alerts@newbank.example"],
    subjectPatterns: [/New Bank.*Transaction/i],
  };

  static parse(body) {
    const regex = /your regex here/i;
    const match = body.match(regex);
    if (!match) return null;
    return {
      cardLast4: match[1],
      amount: this.parseAmount(match[2]),
      merchant: this.normalizeMerchant(match[3]),
      date: this.normalizeDate(match[4], "DD-MM-YYYY"),
      bank: this.bankName,
    };
  }
}
```

2. Add one import line in `src/parsers/parser-registry.js`:

```js
import NewBankParser from "./newbank-parser.js";
const parsers = [ExampleBankParser, NewBankParser];
```

That's it. The registry handles the rest.
