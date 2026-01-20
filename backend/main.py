from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.db import init_db
from app.routers import announcement_requests, announcements, auth, event_requests, events, favorites, location_requests, locations, orgs, reviews, users

app = FastAPI(title="Campus Nav API", version="0.1.0")

# Configure CORS to allow requests from Expo web and mobile
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, replace with specific origins
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def on_startup() -> None:
    init_db()


app.include_router(orgs.router)
app.include_router(auth.router)
app.include_router(users.router)
app.include_router(locations.router)
app.include_router(reviews.router)
app.include_router(location_requests.router)
app.include_router(announcements.router)
app.include_router(announcement_requests.router)
app.include_router(event_requests.router)
app.include_router(events.router)
app.include_router(favorites.router)


@app.get("/health")
def health() -> dict:
    return {"ok": True}
