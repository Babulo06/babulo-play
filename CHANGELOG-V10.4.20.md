# BaBuLo Play V10.4.20 — DDEX Delivery

- Added DDEX ERN 4.3 base message generation per distribution delivery.
- Added persistent ddex_packages registry with SHA-256 and message ID.
- Added admin DDEX preview/package endpoints.
- Distribution connectors can now declare `DIST_CONNECTOR_<PLATFORM>_PROTOCOL=DDEX`; DDEX jobs send XML (`application/xml`) with idempotency/request headers.
- Kept JSON connector mode as default for existing connectors.
- DDEX recipient-specific profiles still need to be agreed/configured with the actual distributor/retailer; this implementation is a base ERN message, not a claim of certification by Spotify/Apple/etc.
