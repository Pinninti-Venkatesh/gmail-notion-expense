# Security Policy

## Reporting a vulnerability

Please do not open a public issue. Report privately via GitHub's [security advisory](https://github.com/Pinninti-Venkatesh/gmail-notion-expense/security/advisories/new) form. Expect an initial response within a week.

## Scope

This app runs on your own machine and handles credentials that grant read access to your email. Particularly relevant classes of issue:

- exposure of `.env`, `data/gmail-token.json`, or OAuth tokens in logs or error output
- anything widening the Gmail scope beyond `gmail.readonly`
- an unauthenticated API endpoint leaking transaction data
- a dependency advisory affecting `googleapis` or `@notionhq/client`

## If you leaked a credential

If you accidentally commit a credential, rotating it is the only real fix — rewriting history does not unpublish what was already fetched or indexed.

1. Revoke the Notion integration at [notion.so/my-integrations](https://www.notion.so/my-integrations).
2. Delete the OAuth client in the [Google Cloud Console](https://console.cloud.google.com/apis/credentials).
3. Issue new credentials and update `.env`.
4. Then purge the history and force-push.

Enabling **secret scanning** and **push protection** in your repository settings will block most such commits before they land.
