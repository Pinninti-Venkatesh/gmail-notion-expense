# Gmail → Notion Expense Tracker

Turn your bank's transaction alert emails into a structured Notion expense database — automatically, on a schedule, with no manual entry.

A local LLM reads each alert, extracts the amount, merchant, card and payment type, assigns a category, and writes a row to Notion. Nothing about your spending leaves your machine except the final row you choose to store in your own Notion database.

```
Gmail Inbox                          Notion Database
┌──────────────┐                     ┌──────────────────────────────┐
│ Bank alert   │                     │ Name   │ Amount │ Category   │
│ Card alert   │ ──► App polls ──►   │ Swiggy │ 450    │ Food       │
│ UPI alert    │     every 2 min     │ Amazon │ 1200   │ Shopping   │
└──────────────┘                     └──────────────────────────────┘
```

## Why this exists

Most expense trackers ask you to hand over read access to your bank account, or to forward statements to a third-party server. This one reads only the alert emails your bank already sends you, parses them with a model running on your own hardware, and writes to a database you own.

## Features

- **Bank-agnostic.** No per-bank regex required. A local LLM reads alerts in whatever format your bank sends, so it works with banks the project has never seen.
- **Self-learning senders.** Starts with an empty sender list and a broad keyword search, then remembers which addresses actually send transaction alerts and narrows future queries to them.
- **Category learning.** Pulls back categories you've corrected by hand in Notion and reuses them, so the same merchant is classified your way next time.
- **Purchase detail enrichment.** When a transaction matches a merchant you've mapped, it finds the corresponding order confirmation email and summarizes what you actually bought.
- **Idempotent.** Every processed Gmail message ID is recorded, so restarts and manual syncs never create duplicate rows.
- **Private by default.** Email bodies go to a local Ollama model. No third-party AI API, no API key, no per-token cost.
- **Optional regex fast path.** Add a deterministic parser for a specific bank if you'd rather not rely on the model for it.

## Requirements

| | |
| --- | --- |
| Node.js | 18 or newer (uses built-in `fetch`) |
| [Ollama](https://ollama.com) | Running locally, with a model pulled |
| Google Cloud project | For Gmail OAuth credentials |
| Notion | An integration token and a database |

## Quick start

```bash
git clone https://github.com/Pinninti-Venkatesh/gmail-notion-expense.git
cd gmail-notion-expense
npm install

ollama pull phi3:mini      # or any model you prefer

cp .env.example .env        # then fill it in — see Configuration
npm start
```

Then open <http://localhost:3000/api/auth> to grant Gmail access. Polling begins on the next cron cycle.

## Setup

### 1. Gmail OAuth credentials

1. Create a project in the [Google Cloud Console](https://console.cloud.google.com/).
2. Enable the **Gmail API**.
3. Configure the OAuth consent screen. Keep it in **Testing** and add your own account as a test user — you do not need Google verification for personal use.
4. Create an **OAuth client ID** of type *Web application*.
5. Add `http://localhost:3000/api/auth/callback` as an authorized redirect URI.
6. Copy the client ID and client secret into `.env`.

The app requests `gmail.readonly` only. It cannot send, modify or delete mail.

### 2. Notion integration

1. Create an internal integration at [notion.so/my-integrations](https://www.notion.so/my-integrations) and copy the token.
2. Create a database with the properties in the table below.
3. Open the database, and via **⋯ → Connections**, connect your integration. Without this the API returns 404.
4. Copy the database ID from the URL — it is the 32-character string before the `?`:
   `https://notion.so/your-workspace/<DATABASE_ID>?v=...`

**Required database schema:**

| Property | Type | Notes |
| --- | --- | --- |
| `Expense` | Title | Merchant name |
| `Amount` | Number | |
| `Category` | Multi-select | |
| `Date` | Date | |
| `Payment Type` | Select | Credit Card, Debit Card, UPI, Net Banking |
| `Platform` | Select | Bank name |
| `Comment` | Rich text | Stores `Gmail ID: …` for dedup and auditing |
| `Card` | Rich text | Optional — last 4 digits, as `XX1234` |
| `Description` | Rich text | Optional — what was purchased |

Property names must match exactly, including the space in `Payment Type`.

### 3. Configuration

Copy `.env.example` to `.env` and fill in:

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `GMAIL_CLIENT_ID` | yes | — | From your Google Cloud OAuth client |
| `GMAIL_CLIENT_SECRET` | yes | — | From your Google Cloud OAuth client |
| `GMAIL_REDIRECT_URI` | no | `http://localhost:3000/api/auth/callback` | Must match the Cloud Console entry |
| `NOTION_API_KEY` | yes | — | Internal integration token |
| `NOTION_DATABASE_ID` | yes | — | 32-character ID from the database URL |
| `PORT` | no | `3000` | |
| `POLL_INTERVAL_MINUTES` | no | `2` | Minutes between Gmail polls |
| `OLLAMA_URL` | no | `http://localhost:11434` | |
| `OLLAMA_MODEL` | no | `phi3:mini` | Any Ollama model that returns JSON reliably |

`.env` is gitignored. Never commit it.

## How it works

Every `POLL_INTERVAL_MINUTES`, the scheduler:

1. **Queries Gmail.** Known transaction senders are OR'd together with a broad keyword search (`subject:(transaction alert OR credit card OR debited …)`) so new banks are discovered rather than missed.
2. **Skips anything already processed,** based on the Gmail message IDs in `data/processed-emails.json`.
3. **Analyzes each email with the LLM,** which decides whether it is a genuine spend and extracts amount, merchant, bank, card last 4 and payment type. Refunds, OTPs, statements, reward-point notices and promotions are rejected.
4. **Records the sender** if a transaction was found, narrowing future queries.
5. **Categorizes** using your learned category map first, falling back to the LLM.
6. **Enriches, when possible,** by locating the merchant's order confirmation email near the transaction time and summarizing the items purchased.
7. **Writes to Notion,** storing the Gmail message ID for dedup.

For a deeper walkthrough of each module, see [HOW-IT-WORKS.md](HOW-IT-WORKS.md).

## API

The server exposes a small HTTP API for manual control.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Status, Gmail auth state, Ollama availability |
| `GET` | `/api/auth` | Begin the Gmail OAuth flow |
| `GET` | `/api/auth/callback` | OAuth redirect target |
| `POST` | `/api/sync` | Poll Gmail immediately |
| `POST` | `/api/sync-categories` | Learn categories from existing Notion rows |
| `GET` | `/api/categories` | View the merchant → category map |
| `GET` | `/api/known-senders` | View learned transaction senders |
| `POST` | `/api/known-senders` | Add a sender — `{"email": "alerts@yourbank.example"}` |
| `GET` | `/api/merchant-domains` | View merchant → domain mappings |
| `POST` | `/api/merchant-domains` | Add one — `{"merchant": "swiggy", "domain": "swiggy.in"}` |
| `POST` | `/api/reconcile-dates` | Correct Notion dates that drifted from the email timestamp |

```bash
curl http://localhost:3000/api/health
curl -X POST http://localhost:3000/api/sync
```

## Local data

These files live in `data/` and are **gitignored** — they hold your personal activity and are never committed:

| File | Contents |
| --- | --- |
| `gmail-token.json` | OAuth access and refresh tokens |
| `processed-emails.json` | Gmail message IDs already handled |
| `known-senders.json` | Addresses learned to send you transaction alerts |
| `merchant-domains.json` | Merchant → domain mappings |
| `category-map.json` | Merchant → category mappings |

On first run each is seeded from the tracked defaults in `data/defaults/`, then evolves locally. To reset one, delete it and restart.

## Adding a regex parser

The LLM handles arbitrary formats, so parsers are optional. Add one only if you want a deterministic fast path for a particular bank.

1. Copy `src/parsers/example-bank-parser.js`.
2. Set `bankIdentifiers` to your bank's alert sender and subject pattern.
3. Adjust the regex in `parse()` to match the alert body.
4. Register the class in the `parsers` array in `src/parsers/parser-registry.js`.

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| `Gmail not authenticated` | Visit `/api/auth`. |
| `Gmail token expired` / `invalid_grant` | The refresh token was revoked. Delete `data/gmail-token.json` and re-authenticate. |
| `ollamaAvailable: false` on `/api/health` | Ollama is not running. Start it and confirm `OLLAMA_URL`. |
| Notion 404 | The integration is not connected to the database. Use **⋯ → Connections** on the database page. |
| Notion validation error | A property name or type does not match the schema table above. |
| Transactions not appearing | Check that alerts are in the inbox, not filtered or archived. `POST /api/sync` and read the logs. |
| Wrong or vague categories | Fix the rows in Notion, then `POST /api/sync-categories` to learn from them. |

## Security

- OAuth scope is read-only Gmail.
- Email content is analyzed by a model on your own machine. No third-party AI service receives it.
- Credentials live only in `.env`, which is gitignored along with tokens and learned data.
- Before publishing a fork, confirm `git log -p` contains no real credentials or personal sender addresses.

## Contributing

Contributions are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE).
