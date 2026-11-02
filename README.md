# SolarisBugs

A self-hosted bug reporting and tracking workspace built with Node.js, Express and MySQL. Designed for Wisp/Pterodactyl and Cloudflare Tunnel, with a responsive purple interface.

## Included

- Protected, one-time owner account creation using a separate setup key.
- Registration, login, persistent MySQL sessions, password changes, account disabling.
- Owner, administrator, developer and reporter roles.
- Project creation, editing and archiving.
- Bug reports with reproduction steps, expected/actual results, version and environment.
- Open → triaged → in progress → testing → resolved → closed workflow, priorities and severity.
- Staff assignments, required resolution text on closure, transactional change history.
- Discussion, private staff notes and authenticated attachment downloads.
- Search, project/status/priority filters, assigned-to-me filter and pagination.
- Overview statistics, team administration, mobile layouts and database health endpoint.

Reporters can access only their own reports and associated attachments. Staff can access every report and project. Administrators manage projects and reporter/developer accounts. Only the owner appoints administrators. Owner access cannot be removed through the UI. Projects are shared across the workspace; private project membership is not implemented.

## Wisp setup (panel only)

1. Use a Node.js 24 egg. Import the repository through the panel's Git integration, or upload its files with the panel file manager.
2. Set the main file to `server.js`. The normal Node egg installs packages from package.json. If your egg offers an install command, use `npm install --omit=dev`.
3. Create a MySQL database and a dedicated user with permission to create/alter tables and read/write data in that database.
4. In the panel file manager, copy `config.local.example.js` to `config.local.js` and edit its values. No .env file is needed.
5. Set `port` to your Wisp allocation. Keep the listening host at `0.0.0.0`; do not use the public server IP as the bind address.
6. Generate **two different** 32-byte random secrets using your password manager and set `sessionSecret` and `setupKey`. These are required; startup rejects placeholders and short values.
7. Set `publicUrl` to your HTTPS domain. Route Cloudflare Tunnel to the Wisp host IP and allocation. The default `secureCookies: true` requires HTTPS. `trustProxy: 1` assumes one trusted proxy hop; adjust for your actual proxy topology.
8. Start the server. Tables and the session table are created automatically. Visit the domain and enter the setup key to create your owner account.
9. Create a project, then start reporting bugs. Promote staff under Administration.

For local HTTP development only, set `secureCookies: false`, `trustProxy: false`, and use your local port.

`GET /health` returns 200 with `{"ok":true}` when MySQL is reachable and 503 otherwise. The default port is 3014; choose the allocation available to your server.

## Docker

Build with `docker build -t solarisbugs .`. Mount your private config at `/app/config.local.js` (read-only), persist `/app/uploads`, and publish the configured port. Ensure the uploads volume is writable by the image's node user (UID 1000). MySQL is external.

## Configuration and data

Secrets stay in the ignored `config.local.js`. Never commit production credentials. Back up both the MySQL database and `uploads/`. Do not expose uploads as a static directory. Files download as attachments, are limited to 10 MB by default, and permit images, text/log files, PDF and ZIP. Files are not malware-scanned.

Registration is controlled by `allowRegistration` (default true). Set false in your local config for an invitation-by-administration deployment; existing accounts can still sign in, but account invitation/creation by staff is not yet implemented. Keep registration enabled until your intended users have registered.

The first-run setup is protected by a unique database installation row, so concurrent requests cannot create additional owners. Protect your setup key as an administrative secret.

## Updates

This version uses manual panel updates: preserve `config.local.js` and `uploads/`, update application files, install changed dependencies and restart in Wisp. Automatic updates and remote Wisp restart are not configured. No destructive schema migrations run automatically. Before adopting a future schema change, review that version's migration instructions and back up the database.

## Verification

`npm run check` checks server and browser JavaScript syntax. `npm test` tests access-role predicates, identifier validation and workflow/input rules. GitHub Actions installs dependencies and runs both checks.

Before public launch, test with your real MySQL and HTTPS proxy: create owner → project → reporter → report → attachment → developer assignment → private note → resolve. Verify the reporter cannot view another reporter's bug, download its attachment or see a private note. Automated tests currently cover domain rules, not database-backed end-to-end flows.

## Current scope

This is the initial functional release. Email notifications, email password recovery, MFA, per-project membership, bulk actions, exports, webhooks, GitHub issue synchronization and automatic deployment are not included.
