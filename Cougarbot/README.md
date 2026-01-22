# Cougarbot App Overview

This repo contains a React Native (Expo) mobile app and a FastAPI backend. The app is in `Cougarbot/` and the backend is in `backend/`.

## Project Structure

```
cougar-bot/
  backend/                 # FastAPI backend
  Cougarbot/               # Expo/React Native app
```

### Backend (`backend/`)
- `backend/main.py`  
  FastAPI app entrypoint. This wires the routers and runs the API.
- `backend/app/db.py`  
  SQLAlchemy metadata, table definitions, and DB connection utilities.
  - SQLite by default (`sqlite:///./app.db`)
  - Use `DATABASE_URL` to point to hosted Postgres (Render/Supabase).
- `backend/app/routers/`  
  Each file maps to a feature area:
  - `auth.py` — login/refresh/register
  - `orgs.py` — org registration + org profile updates
  - `users.py` — user profile, roles, deletion
  - `locations.py` — locations CRUD + activity ratings
  - `location_requests.py` — student location requests
  - `reviews.py` — location reviews
  - `favorites.py` — user favorites
  - `announcements.py` — announcements CRUD + publish/unpublish
  - `announcement_requests.py` — student announcement requests
  - `events.py` — events CRUD
  - `event_requests.py` — student event requests

### Mobile App (`Cougarbot/`)
- `app/`  
  Expo Router screens:
  - `(auth)/` — login/register flows
  - `(tabs)/` — main tabs: home, places, request/admin, profile, maps
- `services/api.ts`  
  Axios wrapper and all API calls.
- `contexts/AuthContext.tsx`  
  Auth state, tokens, login/logout.

## Database

Schema is defined in `backend/app/db.py`. Key tables:
- `organizations`, `org_domains`
- `users`, `refresh_tokens`
- `locations`, `location_requests`
- `reviews`, `favorites`, `location_activity_ratings`
- `announcements`, `announcement_requests`, `announcement_comments`
- `events`, `event_requests`

### Database Location
- Local dev: SQLite at `backend/app.db`
- Hosted: set `DATABASE_URL` in `.env` or Render env vars.

## API Endpoints (High Level)

### Auth
- `POST /auth/login`
- `POST /auth/register`
- `POST /auth/refresh`

### Orgs
- `POST /orgs/register`
- `GET /orgs`
- `GET /orgs/me`
- `PATCH /orgs/me`

### Locations
- `GET /locations`
- `POST /locations`
- `PUT /locations/{id}`
- `DELETE /locations/{id}`
- `GET /locations/{id}/activity-ratings`
- `POST /locations/{id}/activity-ratings`

### Location Requests (students)
- `GET /location-requests`
- `POST /location-requests`
- `PUT /location-requests/{id}`
- `PUT /location-requests/{id}/approve`
- `PUT /location-requests/{id}/deny`
- `DELETE /location-requests/{id}`

### Reviews
- `GET /reviews/locations/{id}`
- `POST /reviews/locations/{id}`
- `PUT /reviews/{id}`
- `DELETE /reviews/{id}`

### Favorites
- `GET /favorites`
- `POST /favorites/{locationId}`
- `DELETE /favorites/{locationId}`

### Announcements
- `GET /announcements`
- `POST /announcements`
- `PATCH /announcements/{id}`
- `POST /announcements/{id}/publish`
- `POST /announcements/{id}/unpublish`
- `DELETE /announcements/{id}`
- `GET /announcements/{id}/comments`
- `POST /announcements/{id}/comments`
- `DELETE /announcements/{id}/comments/{commentId}`

### Announcement Requests (students)
- `GET /announcement-requests`
- `POST /announcement-requests`
- `POST /announcement-requests/{id}/approve`
- `POST /announcement-requests/{id}/deny`
- `DELETE /announcement-requests/{id}`

### Events
- `GET /events`
- `POST /events`
- `PATCH /events/{id}`
- `DELETE /events/{id}`

### Event Requests (students)
- `GET /event-requests`
- `POST /event-requests`
- `PUT /event-requests/{id}`
- `POST /event-requests/{id}/approve`
- `POST /event-requests/{id}/deny`
- `DELETE /event-requests/{id}`

## App Flow (High Level)

- Users register or login via `(auth)` screens.
- Auth tokens are stored in `AsyncStorage`.
- The API base URL comes from:
  - `EXPO_PUBLIC_API_BASE_URL` if set
  - otherwise, it falls back to local LAN IP in `services/api.ts`
- Tabs:
  - **Home** (`(tabs)/index.tsx`) — announcements, events, place highlights
  - **Places** (`(tabs)/places.tsx`) — browse locations, reviews, favorites
  - **Request/Admin** (`(tabs)/request.tsx`) — admin tooling + student request forms
  - **Profile** (`(tabs)/profile.tsx`) — user profile and settings

## Environment Variables

Backend:
- `DATABASE_URL`
- `JWT_SECRET`
- `REFRESH_TOKEN_PEPPER`

Frontend:
- `EXPO_PUBLIC_API_BASE_URL`

## Running Locally

Backend:
```
cd backend
pip install -r requirements.txt
python -m uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

Frontend:
```
cd Cougarbot
npm install
npx expo start
```

## Notes on Images
- Images are sent as URLs or base64 data URLs.
- Some student flows use base64 for reliability on iOS.
- Very large images are rejected client-side to avoid crashes.
