# BaBuLo Play V10.4.29

- Perfis externos passam a guardar imagem e nome externo para confirmação visual.
- Spotify: quando existe external_artist_id, a API tenta obter a imagem oficial e o nome do artista.
- O botão “Identificar os meus perfis automaticamente” passa a enviar para o conector de descoberta os perfis já encontrados/confirmados como seeds: plataforma, ID, URL, imagem, nome e estado.
- A nova varredura usa esses dados como referência para procurar o mesmo artista nas restantes plataformas.
- Perfis VERIFIED não são rebaixados quando a mesma identidade é reencontrada.
- A interface mostra a foto do perfil externo ao lado do estado e dos botões de confirmação.
- O fluxo continua a bloquear distribuição enquanto o mapping não estiver confirmado.
- Ao guardar manualmente um link Spotify, a API tenta extrair o Artist ID e obter nome e foto oficiais para exibição visual.
