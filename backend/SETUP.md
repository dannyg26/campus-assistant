# Backend deployment notes

## Database

The backend reads `DATABASE_URL` and defaults to SQLite (`sqlite:///./app.db`).
For a hosted database, set `DATABASE_URL` to a managed Postgres instance, e.g.:

```
DATABASE_URL=postgresql+psycopg2://USER:PASSWORD@HOST:5432/DBNAME
```

## Required environment variables

These must be set in `.env` (local) or the hosting provider's environment:

```
JWT_SECRET=replace-with-a-long-random-string
REFRESH_TOKEN_PEPPER=replace-with-a-long-random-string
JWT_ISSUER=campus-nav
ACCESS_TOKEN_MINUTES=15
REFRESH_TOKEN_DAYS=30
```

## Public access

To access the app outside your home network, deploy the backend (Render, Railway,
Fly.io, etc.) and set the mobile app `EXPO_PUBLIC_API_BASE_URL` to that public URL.
