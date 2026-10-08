# Fontes locais

Outfit, Figtree e JetBrains Mono, subconjunto latino (cobre o português), em woff2, copiadas dos pacotes `@fontsource/*` (licença SIL Open Font License 1.1; os textos estão nos arquivos `LICENSE-*-OFL.txt`).

Ficam dentro do repositório de propósito: o build (Railway e CI) não pode depender de baixar fonte do Google. Pesos usados: Outfit 500/600/700/800, Figtree 400/500/600/700, JetBrains Mono 400/600 (os mesmos de antes). Para trocar um peso, copie o arquivo `*-latin-<peso>-normal.woff2` do pacote correspondente e atualize `src/app/layout.tsx`.
