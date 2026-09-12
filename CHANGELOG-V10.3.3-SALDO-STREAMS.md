# BaBuLo Play — V10.3.3 + Pagamento com Saldo dos Streams

## Alterações

- O artista pode pagar o lançamento usando o saldo acumulado dos royalties/streams.
- O sistema utiliza primeiro o saldo disponível da carteira do artista.
- Se o saldo não cobrir o preço total, o sistema desconta o saldo disponível e cria o pagamento externo somente para a diferença.
- Métodos externos para a diferença: Multicaixa Express, Multicaixa por Referência, Visa ou Mastercard.
- Quando o saldo cobre 100% do lançamento, o pagamento é confirmado imediatamente como `PAID`.
- O débito do saldo é registado no `financial_ledger` como `RELEASE_PAYMENT`.
- O saldo é protegido com transação e bloqueio do registo do artista para evitar gasto concorrente do mesmo saldo.
- O pagamento continua associado ao lançamento específico.
- O botão **Lançar lançamento** fica bloqueado até o pagamento estar confirmado.
- A API continua a validar o pagamento no servidor antes de aceitar `/api/releases/:id/submit-approval`.
- A distribuição completa continua a acrescentar 50% ao preço base.

## Fluxo

`Rascunho → Preflight → Pagamento → Pagamento confirmado → Lançar para aprovação → Análise Admin → Distribuição`

## Exemplo

Saldo do artista: `25.000 AOA`  
Preço do álbum: `14.000 AOA`

O sistema desconta `14.000 AOA` da carteira e o novo saldo fica `11.000 AOA`. O álbum fica imediatamente elegível para ser enviado para aprovação.

Se o saldo for `8.000 AOA` e o álbum custar `14.000 AOA`, o sistema reserva/desconta `8.000 AOA` e cria pagamento externo de `6.000 AOA`. Depois da confirmação dos `6.000 AOA`, o lançamento fica pago.
