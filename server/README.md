# campsoon Server

Next.js server for campsoon identity, trip persistence, booking result intake,
email notifications, and admin visibility.

## Features

- Passwordless email OTP authentication powered by better-auth and Resend.
- Bearer-token authentication for Chrome extension API requests.
- Admin role support through better-auth, with `/admin` gated to admin users.
- Postgres persistence through Drizzle ORM for users, sessions, trips, and booking results.
- Authenticated current-user endpoint at `GET /api/user`.
- Authenticated trip storage API:
  - `GET /api/trips` lists the signed-in user's trips.
  - `POST /api/trips` creates a trip owned by the signed-in user.
  - `PUT /api/trips/:id` updates trip configuration, status, last match, and attempted keys.
  - `DELETE /api/trips/:id` deletes a trip owned by the signed-in user.
- Authenticated extension notification endpoint at `POST /api/trips/:id/result`.
  The Chrome extension calls this after booking-related events such as a site being
  found, a cart reservation being placed, a booking being paid/confirmed, or a booking
  failure.
- Booking result payloads support `found`, `reserved`, `booked`, and `failed`
  outcomes, plus matched campsite details, reservation/booking links, and error
  details from the extension.
- Trip status updates from booking outcomes: reserved trips pause, booked trips complete, and failed trips return to idle.
- Booking result history stored in `booking_results`, including matched site details, error messages, and email-send status.
- Email notifications are sent to the signed-in user's email address with the trip
  name, park, site, dates, booking URL, and relevant failure details when present.
- Admin dashboard scaffold that lists users with trip counts and booking result counts.

## Development

```bash
npm install
npm run dev
```

The development server runs on `http://localhost:3001`.

Local development reads `server/.env`. Production deployment reads
`server/.env.production` by default and uploads that file to the VPS before
restarting the container:

```bash
cp .env.example .env.production
npm run deploy
```

To deploy with a different env file:

```bash
ENV_FILE=/path/to/production.env npm run deploy
```

## Database

The server uses Postgres with Drizzle migrations. All commands below should be
run from this `server/` directory.

### Initial setup

Create a local Postgres database, then add the connection string to
`.env`:

```bash
createdb campsoon
printf 'DATABASE_URL=postgres://localhost:5432/campsoon\n' >> .env
```

If your local Postgres user requires a username or password, use that in the
connection string instead:

```bash
DATABASE_URL=postgres://user:password@localhost:5432/campsoon
```

For the Docker deployment, do not use `localhost` in `DATABASE_URL`. Inside the
Next.js container, `localhost` points back to that container, not to Postgres.
For multi-VPS deployments, expose infra services on the infra VPS private
network interface and use the infra VPS private IP:

```bash
DATABASE_URL=postgres://user:password@10.0.0.10:15432/campsoon
```

Loki should use the same private-IP pattern:

```bash
LOKI_URL=http://10.0.0.10:13100
```

The infra Docker Compose files can bind those published ports to all interfaces
when Oracle security rules keep them private:

```yaml
ports:
  - "${POSTGRES_PORT:-5432}:5432"
  - "${LOKI_PORT:-3100}:3100"
```

Restrict access with Oracle security lists or NSGs so only app VPS private IPs
can reach the Postgres and Loki ports.

Apply the checked-in migrations to initialize the schema:

```bash
npm run db:migrate
```

After that, start the app as usual:

```bash
npm run dev
```

### Creating a migration

When `db/schema.ts` changes, generate and apply a new migration:

```bash
npm run db:generate
npm run db:migrate
```

Commit the generated files under `drizzle/` together with the schema change.
