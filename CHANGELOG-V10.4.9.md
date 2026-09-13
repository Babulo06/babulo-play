# BaBuLo Play V10.4.9 — Rights & Royalty Matching

- Added "Verificar direitos autorais" button after audio upload.
- Added audio SHA-256 scan records and match records.
- Added external rights matching provider adapter via `RIGHTS_MATCH_PROVIDER_URL` and optional `RIGHTS_MATCH_PROVIDER_TOKEN`.
- Added display of ISRC, ISWC, IPI and catalogue identifiers returned by a matching provider.
- Added confirmation endpoint that creates a traceable royalty reservation and BaBuLo Royalty payout code.
- Added monthly royalty reservation period (`YYYY-MM`) and statuses.
- Automatic scan is advisory: it does not legally determine ownership or percentages.
- Existing V10.4.8 rights/splits system remains compatible.

## Correção de build V10.4.9.1
- Corrigida declaração duplicada do componente `Security2FA` no frontend.
- Restaurado o componente `AdSlot` usado na página pública.
- Mantidas as funcionalidades de verificação de direitos autorais e Rights & Royalty Matching.
