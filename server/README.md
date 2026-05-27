# CampOsprey Server

Next.js server for CampOsprey identity, trip persistence, booking result intake,
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
  found, a cart hold being placed, a booking being paid/confirmed, or a booking
  failure.
- Booking result payloads support `found`, `hold_placed`, `booked`, and `failed`
  outcomes, plus matched campsite details, reservation/booking links, and error
  details from the extension.
- Trip status updates from booking outcomes: held trips pause, booked trips complete, and failed trips return to idle.
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
