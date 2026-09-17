# BaBuLo Play V10.4.21 — Partner Distribution Connectors

- Added Owner-managed distribution partner connectors per platform.
- Secrets remain in Render environment variables; only the variable name is stored in DB.
- Connector protocol supports DDEX or JSON.
- Distribution jobs resolve the configured partner connector before falling back to legacy platform environment variables.
- Added Owner endpoints to list/configure/activate/deactivate/test connectors.
- DDEX callback URL can be configured per partner.
- This does not claim certification or access to Spotify/Apple/Deezer; a real authorized distribution partner endpoint and credentials are required.
