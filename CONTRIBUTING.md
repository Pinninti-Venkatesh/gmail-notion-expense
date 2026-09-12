# Contributing

Thanks for your interest in improving this project.

## Ground rules

**Never commit personal data.** This project reads your email, so it is unusually easy to leak something. Before opening a PR, check that your diff contains no:

- real bank alert addresses (use `alerts@examplebank.test` or similar)
- real merchant names tied to you, city names, or neighbourhoods
- API keys, OAuth secrets, or tokens
- Gmail message IDs, card digits, or transaction amounts from your own account

Prompt examples and test fixtures must be invented, not copied from your inbox. This is the most common way a contribution leaks something.

The files in `data/` other than `data/defaults/` are gitignored for this reason. Do not force-add them.

## Getting set up

```bash
git clone https://github.com/<your-fork>/gmail-notion-expense.git
cd gmail-notion-expense
npm install
cp .env.example .env    # fill in your own credentials
ollama pull phi3:mini
npm run dev             # restarts on file changes
```

See the README for full Gmail and Notion setup.

## Making a change

1. Branch from `main`.
2. Keep the change focused — one concern per PR.
3. Match the surrounding style: ES modules, 2-space indent, single quotes, named exports.
4. Verify before pushing:
   ```bash
   node --check src/**/*.js          # syntax
   npm start                          # boots cleanly
   curl -X POST localhost:3000/api/sync
   ```
5. Write a clear PR description explaining what changed and why.

## Adding support for a bank

You usually do not need to. The LLM analyzer is bank-agnostic by design, and adding a hardcoded parser for a bank is rarely the right fix.

If the model misreads a particular alert format, prefer improving the prompt in `src/llm/email-analyzer.js` over adding a parser — that helps every user, not only those at one bank.

If a deterministic parser is genuinely warranted, copy `src/parsers/example-bank-parser.js` and register it in `parser-registry.js`. Use a fabricated sample in any example, never a real alert from your account.

## Reporting bugs

Open an issue with what you expected, what happened, and the relevant log output. **Redact amounts, merchants, card digits and email addresses** before pasting logs.

## Security issues

Do not open a public issue for a vulnerability. Report it privately through GitHub's [security advisory](https://github.com/Pinninti-Venkatesh/gmail-notion-expense/security/advisories/new) form.
