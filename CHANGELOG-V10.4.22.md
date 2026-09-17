# BaBuLo Play V10.4.22 — Cloudflare R2

- Added Cloudflare R2 permanent object storage for media uploads.
- Uses `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` and `R2_BUCKET`.
- Uploads for audio, covers, admin profile photos and attendance/payroll documents are stored in R2 when configured.
- Private R2 bucket is preserved: media is streamed through the BaBuLo API at `/media/:key`.
- Audio streaming supports HTTP Range requests for browser/player compatibility.
- Deletes remove objects from R2 as well as any local fallback copy.
- Rights scanning can read audio from R2 for SHA-256 matching without exposing the bucket publicly.
- DDEX XML packages are also copied to R2 under `ddex/<releaseId>/` while retaining the existing API generation flow.
- Local `UPLOAD_DIR` remains as a fallback/temporary processing area; with the four R2 variables configured, new uploads use R2 as the persistent store.
