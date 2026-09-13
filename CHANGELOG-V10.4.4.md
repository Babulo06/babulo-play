# BaBuLo Play V10.4.4 — Segurança de autenticação

- Recuperação de palavra-passe por email com token de uso único e expiração de 30 minutos.
- Verificação de email para novos ouvintes, artistas e admins.
- 2FA TOTP para ADMIN/OWNER, com segredo cifrado na base de dados e desafio de login de 10 minutos.
- Sessões persistentes no servidor para todos os papéis, revogação, expiração por inatividade e expiração JWT de 24 horas.
- Alteração de palavra-passe encerra todas as sessões anteriores.
- Botão de olho para mostrar/ocultar palavra-passe no login, registo, recuperação e criação de ADMIN.
- Email transacional preparado para Resend via RESEND_API_KEY e AUTH_FROM_EMAIL; sem essas variáveis, o ambiente de desenvolvimento regista o link no log da API.
