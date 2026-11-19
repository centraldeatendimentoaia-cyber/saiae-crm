# Formato real dos pacotes da agência

Levantamento somente leitura de `D:\agencia-marketing` (leitura de `CLAUDE.md`, `operacao.md`, `scripts/`, `clientes/lavi/`, amostra de `clientes/saiae/`). Data do levantamento: 2026-11-13. Nenhum conteúdo de cliente é reproduzido além de campos de exemplo.

## 1. Visão geral

A agência é um repositório de arquivos, sem banco e sem API. Cada cliente tem uma pasta autocontida e cada semana de conteúdo tem uma pasta própria. O "pacote aprovado" não é um único arquivo: é a combinação de `plano.json`, dos JSON de peça, dos PNGs renderizados, da pasta `pacote/` e do `agendamento.csv`, mais o status registrado nesse CSV.

Clientes cadastrados (`CLAUDE.md`): `saiae`, `lavi`, `bruna-meireles`, `tiktokshop-panelas`. Só `saiae` e `lavi` têm motor de lint e arte completos. O cliente ativo dos scripts vem da variável `CLIENTE=<slug>` (padrão `saiae`); o slug aceita só `[a-z0-9-]`.

## 2. Estrutura de pastas

```
D:\agencia-marketing\
  CLAUDE.md, operacao.md
  scripts\            cliente.py, plano.py, gate.py, pacote.py, textos.py, rotina.py, lint.py, novo_cliente.py
  arte\render.py      despachante da arte do cliente ativo
  aprovacoes\         saída das rotinas: index.html, diaria.md, domingo.md, agendar-meta.md, logs\
  clientes\<slug>\
    marca.md, regras.json, lint_regras.json, estrategia-conteudo.md, objetivo.md, persona.md,
    aprendizados.md, promocoes.json, precos.json (LAVI), metricas\, arte\, scripts\
    conteudo\<AAAA-SNN>\            uma pasta por semana (também há pastas avulsas, ex.: 2026-anuncio-liso, 2026-stories-fixos)
      plano.json                    contrato semanal (plano.md é gerado a partir dele)
      roteiros.md, textos.md, revisao.md, briefing.md (conforme a semana)
      carrosseis\<slug>.json        + pasta <slug>\ com slide-NN.png e index.html
      capas\<slug>.json             capa de Reel (PNG 1080x1920)
      stories\<slug>.json           + pasta <slug>\ com slide-01.png
      videos\<slug>\                só Sai aê hoje: cartao.md, <slug>-v001[-variante].mp4, .srt, -voz.wav
      pacote\
        agendamento.csv
        <AAAA-MM-DD>_<HHhMM>_<formato>_<slug>\   legenda.txt + slide-NN.png (ou capa.png para Reel)
```

Exemplo real de nome de pasta de post: `2026-11-17_12h00_carrossel_carrossel-esmaltacao-gel-incluso`. O formato é `slug` da peça no fim; `formato` vira `carrossel`, `reel` ou `stories`.

## 3. Identificação do cliente, slug e versão

- **Cliente**: não existe campo `cliente` nos JSON de peça nem no CSV. A identidade está só no caminho (`clientes/<slug>/`). O arquivo `aprovacoes/agendar-meta.md` mistura clientes e usa uma coluna `Cliente` própria (`saiae`, `lavi`). Consequência para a integração: o importador precisa receber o cliente de fora (parâmetro ou manifesto), não do conteúdo.
- **Semana**: `AAAA-SNN` (ex.: `2026-S47`), nome da pasta e campo `semana` do `plano.json`.
- **Slug da peça**: campo `slug` do JSON, igual ao nome do arquivo e da pasta. É único dentro da semana e do cliente (o lint exige correspondência entre plano e peça). Não é garantido único entre semanas; a chave natural é `cliente + semana + slug`.
- **Versão**: não há versão de conteúdo na peça. Existe versão apenas nos vídeos: `<slug>-v001`, `v002` e variante (`-A-sem-voz`, `-C-voz-joao`). Reexecutar `pacote.py` apaga e recria `pacote/` inteiro e volta tudo para `pendente_aprovacao`. Não há hash de conteúdo registrado.

## 4. Plano semanal (`plano.json`)

Campos (validados por `scripts/plano.py`): `semana`, `objetivo`, `mudou`, `itens[]`, `filmar[]`, `pendencias[]`.

Cada item: obrigatórios `slug`, `data` (AAAA-MM-DD), `hora` (HH:MM), `formato` (`reel`, `carrossel`, `stories`, `anuncio`), `pilar`, `serie`, `camada` (`atrair`, `nutrir`, `converter`), `cta`. Opcionais: `gancho`, `texto_cta`, `status`, `producao`, `publico` (`cliente` ou `profissional`).

`status` do item do plano: `planejado` (padrão, exige peça), `depende_fundador` (aviso) e `adiado` (ignorado). Isto não é o status editorial de aprovação.

```json
{ "slug": "carrossel-esmaltacao-gel-incluso", "data": "2026-11-17", "hora": "12:00",
  "formato": "carrossel", "pilar": "Transparência", "serie": "Sem susto", "camada": "nutrir",
  "cta": "Salve para consultar na hora de agendar", "gancho": "...", "texto_cta": "Salve este post" }
```

## 5. JSON de peça

Pastas: `carrosseis/`, `capas/` (Reel) e `stories/`. Campos comuns no topo:

| Campo | Tipo | Observação |
|---|---|---|
| `slug` | string | Obrigatório; igual ao nome do arquivo |
| `titulo` | string | Pode conter marcação `**destaque**` (removida no CSV) |
| `data`, `hora` | string | `AAAA-MM-DD` e `HH:MM`; horário de Brasília (inferido pelas regras da LAVI; não declarado em campo) |
| `cta` | string | Um único CTA por peça (regra do lint) |
| `legenda` | string | Texto final; máx. 2 emojis (regra da LAVI) |
| `hashtags` | string | Uma string única separada por espaço, não array |
| `preco_confirmado` | boolean | LAVI; `true` exige promoção confirmada em `promocoes.json` |
| `publico` | string | `cliente` ou `profissional` (profissional reprovado com fase inativa) |
| `slides[]` | array | Ver abaixo |

Slide: `layout` (`capa`, `lista`, `frase`, `cta`, `story-foto`, `capa-reel`, `antes-depois`, `depoimento`), `tema` (`dark`, `paper`, `cinza`), mais campos por layout (`titulo`, `sub`, `selo`, `itens[]`, `texto`, `acao`, `handle`, `etiqueta`, `adesivo`). Slides com pessoas levam `foto` (ou `antes`/`depois`), `posicao` e `autorizacao` (texto livre com a data do aceite; sem ele o lint dá ERRO).

Exemplo resumido (carrossel de 4 slides):

```json
{ "slug": "carrossel-esmaltacao-gel-incluso", "titulo": "...", "data": "2026-11-17", "hora": "12:00",
  "cta": "...", "legenda": "...", "hashtags": "#taguatinga #salaodebeleza", "preco_confirmado": false,
  "slides": [ {"layout":"capa","tema":"dark","titulo":"...","sub":"...","selo":"..."},
              {"layout":"lista","tema":"paper","titulo":"...","itens":["..."]},
              {"layout":"frase","tema":"cinza","texto":"...","selo":"..."},
              {"layout":"cta","tema":"dark","titulo":"...","acao":"...","handle":"@..."} ] }
```

Story: um slide `story-foto`, `legenda` repete o texto (o CRM descarta legenda de Story). Capa de Reel: um slide `capa-reel` com `foto` ou `antes`/`depois`; o JSON descreve só a capa, não o vídeo.

## 6. Mídia

- **Imagens**: `arte/render.py` gera `slide-NN.png`. Carrossel 1080x1350; capa de Reel e Story 1080x1920. Tamanhos observados: 54 KB a 1,9 MB por PNG, abaixo do teto de 5 MB do upload do CRM.
- **Pacote**: `pacote.py` copia os PNGs para a pasta do post. Em Reel o arquivo vira `capa.png`. A `legenda.txt` contém legenda, linha em branco e hashtags.
- **Vídeo (mp4)**: só existe na pasta `videos/<slug>/` do Sai aê (ex.: `reel-conta-20s-preco-venda-v002-C-voz-joao.mp4`, com `.srt` e `.wav`). O `pacote.py` não copia vídeo e o CSV não referencia mp4. No LAVI não há nenhum mp4 até hoje. O Reel entra no pacote apenas como PNG de capa; o vínculo capa-vídeo é feito só pelo slug, por convenção.
- **Fotos de origem**: `arte/assets/` do cliente (ex.: `s45-mechas2-depois.jpg`), referenciadas por nome de arquivo no slide.

## 7. `agendamento.csv`

Codificação UTF-8 com BOM (`utf-8-sig`). Colunas exatas: `data,hora,formato,titulo,legenda,hashtags,arquivos,cta,status`. `formato` assume `Carrossel`, `Reel` ou `Stories`. `arquivos` é uma lista separada por `;` de caminhos relativos a `pacote/` (`<pasta-do-post>/slide-01.png;...`). Não há colunas de cliente, semana, slug (o slug está dentro do caminho em `arquivos`), versão nem hash.

```
2026-11-17,12:00,Carrossel,"O que está incluso...","<legenda>",#taguatinga #...,2026-11-17_12h00_carrossel_carrossel-esmaltacao-gel-incluso/slide-01.png;...slide-04.png,"Salve para consultar na hora de agendar",aprovado
```

## 8. Status editorial

Não existe status `rascunho` nem `reprovado` em arquivo estruturado. O que existe de fato:

| Onde | Valores | Quem grava |
|---|---|---|
| `pacote/agendamento.csv` coluna `status` | `pendente_aprovacao`, `aprovado`, `bloqueado_lint` | `pacote.py` (inicia em `pendente_aprovacao`, ou `bloqueado_lint` se o lint deu ERRO); `rotina.py aprovar` muda `pendente_aprovacao` para `aprovado` |
| `plano.json` `itens[].status` | `planejado`, `depende_fundador`, `adiado` | estrategista |
| `revisao.md` (texto em tabela Markdown) | `APROVADA`, `APROVADA COM AJUSTE`, `REPROVADA` | agente revisor |

Regras observadas: `bloqueado_lint` nunca é aprovado pela rotina; rodar `pacote.py` de novo reverte tudo para `pendente_aprovacao`; peça sem menção no `revisao.md` gera AVISO. A reprovação do revisor é texto livre e não é propagada para o CSV: o `revisao.md` da S47 (08/11) marca `story-indique-e-ganhe` como `REPROVADA`, a peça foi refeita depois (o JSON traz registro de 2026-11-10) e o `revisao.md` não foi atualizado para refletir isso. Ou seja, o `revisao.md` é histórico e pode estar desatualizado em relação ao CSV. Quem decide o que vale é o par `revisao.md` + `agendamento.csv`, que podem divergir.

`aprovacoes/agendar-meta.md` é um relatório gerado em Markdown (tabela Data, Hora, Cliente, Formato, Peça, Semana) com a lista "aprovado, falta agendar no Meta" e uma segunda lista "LAVI ainda sem aprovação". É leitura humana, não fonte para máquina.

## 9. Rotinas e `aprovacoes/`

`py scripts/rotina.py <rotina>`: `semanal` (usa Claude Code por cliente), `diaria` (o que sai hoje e amanhã), `domingo`, `painel` (gera `aprovacoes/index.html`), `aprovar <cliente> <semana> [slug ...]`. Logs em `aprovacoes/logs/`. A rotina nunca publica: gera arquivos locais. O agendamento no Meta é manual (o fundador agenda no Meta Business Suite a partir do pacote).

## 10. Lacunas relevantes para integração

1. Sem campo `cliente`, `versao`, `hash` nem id estável no JSON ou no CSV.
2. Status de reprovação só em Markdown; `pacote.py` não lê o `revisao.md`.
3. Hashtags e legenda em campos separados, mas no CRM só existe `caption`.
4. Reel: pacote contém só a capa PNG; o mp4 fica fora do pacote e só existe no Sai aê.
5. Fuso horário não declarado nos arquivos.
6. `legenda` de Story não é publicada pelo CRM.
7. O campo `arquivos` do CSV usa caminhos relativos locais, sem checksum.

Arquivos de referência lidos: `D:\agencia-marketing\scripts\pacote.py`, `plano.py`, `rotina.py`, `cliente.py`, `clientes\lavi\scripts\lint.py`, `clientes\lavi\regras.json`, `clientes\lavi\conteudo\2026-S47\{plano.json,carrosseis,stories,pacote,revisao.md}`, `clientes\lavi\conteudo\2026-S46\capas`, `clientes\saiae\conteudo\2026-S47\videos`.
