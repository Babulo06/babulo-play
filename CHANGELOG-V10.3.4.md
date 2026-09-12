# BaBuLo Play V10.3.4

## Marcadores promocionais
- Os dois marcadores do trecho promocional podem ser movidos de forma independente.
- Ao mover o início, o fim acompanha para manter exatamente 59 segundos.
- Ao mover o fim, o início acompanha para manter exatamente 59 segundos.
- Os controles foram separados para que um marcador não bloqueie o outro.

## Sessão do artista
- A área de trabalho do artista encerra a sessão após 30 minutos sem atividade.
- Cada login de artista recebe uma sessão própria através de `auth_sessions`.
- Atividade recente mantém a sessão viva; ausência de atividade provoca logout automático.
- O servidor também rejeita sessões de artista expiradas.
- O logout revoga a sessão no servidor.
