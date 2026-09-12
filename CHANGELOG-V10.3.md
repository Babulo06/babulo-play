# BaBuLo Play V10.3

- Multi-faixas: número ilimitado de faixas no wizard.
- Cada faixa tem metadata, créditos, direitos e áudio próprios.
- Aba 5: pagamento obrigatório por lançamento.
- O artista pode iniciar o pagamento antes ou depois de concluir os dados.
- Pagamentos ficam associados ao lançamento e têm estado PENDING/PAID.
- Sem pagamento confirmado, o servidor bloqueia a submissão e mantém o lançamento em DRAFT.
- Adicionada migração 008_release_payment.sql.
