# Driver Log Comparator

A local browser tool for comparing FlowConnect Login / Logout handoffs between two drivers.

## Rules implemented

- Parses `.events-short-table-event` rows from copied FlowConnect HTML.
- Keeps only `Login` / `Logout` events.
- For `Logout`, location is taken from the nearest non-empty status above it.
- For `Login`, location is taken from the nearest non-empty status below it.
- Sorts by odometer; equal odometers keep original FlowConnect order.
- Every comparison row also shows the chronological event order, e.g. `1. Logout → 2. Login`.
- A normal handoff requires:
  - complementary `Logout` ↔ `Login` events;
  - same odometer;
  - same normalized location;
  - Login time strictly later than Logout time.
- Same-driver `Logout → Login` with the same odometer and no event on the other driver is neutral, not an error.
- Unmatched events before the first shared odometer are treated as the beginning of the 8-day FlowConnect window and are neutral.

## Stack

- Vite
- TypeScript (strict)
- Vanilla DOM API
- Yarn 4

## Development

```bash
yarn install
yarn dev
```

## Type checking

```bash
yarn typecheck
```

## Production build

```bash
yarn build
```

The output is generated in `dist/` and can be deployed directly to Vercel.
