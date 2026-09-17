# BaBuLo Play V10.4.18

## Distribution Engine
- Fila de jobs por entrega e idempotência.
- Tentativas, estados RUNNING/SUCCEEDED/FAILED e logs de conectores.
- Envio automático quando existir conector configurado por plataforma.
- Endpoint operacional para Admin reenviar entregas em falha.
- Callback de conector para receber external release ID/URL e estado PUBLISHED.
- Payload de integração com versão de schema, request ID e idempotency key.
- Sem simular publicação: plataformas só avançam quando o conector oficial estiver configurado.

## Variáveis de conector
Para cada plataforma suportada, o servidor pode usar:
- `DIST_CONNECTOR_<PLATFORM_CODE>_URL`
- `DIST_CONNECTOR_<PLATFORM_CODE>_TOKEN`

Exemplo: `DIST_CONNECTOR_SPOTIFY_URL` e `DIST_CONNECTOR_SPOTIFY_TOKEN`.

Os tokens são apenas variáveis privadas do ambiente do servidor e não devem ser colocados no frontend ou no GitHub.
