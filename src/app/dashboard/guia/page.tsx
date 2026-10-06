import Link from "next/link";

interface Section {
    id: string;
    title: string;
    href?: string;
    intro: string;
    steps: string[];
    tip?: string;
}

const sections: Section[] = [
    {
        id: "comecar",
        title: "Antes de tudo",
        intro: "Duas regras valem para quase todas as telas.",
        steps: [
            "Escolha a sessão de WhatsApp no seletor no topo da tela (ex.: \"WhatsApp da loja\"). As telas trabalham sobre a sessão selecionada.",
            "A sessão precisa estar CONNECTED (verde). Se não estiver, vá em Sessões / QR.",
        ],
    },
    {
        id: "sessoes",
        title: "1. Sessões / QR — conectar o WhatsApp",
        href: "/dashboard/sessions",
        intro: "Aqui você liga o número do salão ao painel.",
        steps: [
            "Clique em Criar sessão e dê um nome (ex.: \"WhatsApp do salão\").",
            "Em Gerenciar, clique em Iniciar sessão.",
            "No celular: WhatsApp → Aparelhos conectados → Conectar aparelho → escaneie o QR. Também dá para vincular pelo número de telefone, com um código.",
            "Quando o status virar CONNECTED, está pronto. Reiniciar, parar, desconectar e excluir ficam na mesma tela.",
            "Compartilhar dá acesso da sessão a outro usuário, pelo e-mail dele.",
        ],
    },
    {
        id: "conversas",
        title: "2. Conversas",
        href: "/dashboard/chat",
        intro: "Atenda os clientes pelo painel, como no WhatsApp Web.",
        steps: [
            "A lista de conversas fica à esquerda e as mensagens à direita.",
            "Responda, anexe arquivos e atribua etiquetas pelo menu da conversa.",
            "Para abrir uma conversa nova, digite o número em \"Número de telefone\" e clique em Ir.",
        ],
    },
    {
        id: "disparo",
        title: "3. Disparo — envio em massa",
        href: "/dashboard/broadcast",
        intro: "Envia a mesma mensagem para vários números, com intervalo entre cada envio.",
        steps: [
            "Em Destinatários, cole os números com código do país e DDD, um por linha. Ex.: 5561999999999.",
            "Escreva a Mensagem. Para ganhar tempo, use o bloco \"Gerar texto com IA\": descreva o objetivo, clique em Gerar e escolha uma das versões.",
            "Para chamar cada cliente pelo nome, escreva {primeironome} no texto (ex.: \"Oi, {primeironome}!\"). O sistema troca pelo nome salvo de cada pessoa. Use {primeironome|cliente} para definir um texto reserva quando o nome não for conhecido.",
            "Ajuste o Intervalo entre mensagens. Use 5 segundos ou mais.",
            "Clique em Iniciar disparo e acompanhe enviadas, falhas e pendentes. A aba Histórico guarda tudo.",
        ],
        tip: "Comece com poucos números e aumente aos poucos. Envie só para quem já conhece o salão. Ative a proteção anti-banimento em Configurações do Bot.",
    },
    {
        id: "agendador",
        title: "4. Agendador",
        href: "/dashboard/scheduler",
        intro: "Programa mensagens para o futuro.",
        steps: [
            "Clique em Agendar nova mensagem e escolha o tipo: Único (data e hora) ou Recorrente (a cada X minutos/horas, dias da semana ou cron).",
            "Informe o destinatário (pessoa: 5561999999999@s.whatsapp.net; grupo: o ID do grupo) e a mensagem.",
            "Acompanhe em Fila pendente e em Histórico.",
        ],
    },
    {
        id: "resposta",
        title: "5. Resposta automática",
        href: "/dashboard/autoreply",
        intro: "O app responde sozinho quando o cliente escreve certas palavras.",
        steps: [
            "Clique em Nova regra e defina a palavra-chave (ex.: preço).",
            "Escolha o tipo de correspondência: exata, contém, começa com ou expressão regular.",
            "Escolha o público: todos, só conversas privadas ou só grupos.",
            "Escreva a resposta (texto e/ou mídia) e salve.",
        ],
        tip: "Boas regras para um salão: preço, endereço, horário, agendamento e promoções.",
    },
    {
        id: "contatos",
        title: "6. Contatos e Grupos",
        href: "/dashboard/contacts",
        intro: "Consulta dos contatos e grupos da sessão.",
        steps: [
            "Contatos: lista sincronizada do WhatsApp, com busca e paginação.",
            "Grupos: lista, busca e criação de novos grupos.",
        ],
    },
    {
        id: "etiquetas",
        title: "7. Etiquetas",
        href: "/dashboard/labels",
        intro: "Organize as conversas com etiquetas coloridas.",
        steps: [
            "Clique em Nova etiqueta, escolha nome e cor.",
            "Abra a etiqueta e use Atribuir para vincular conversas a ela.",
            "Ao conectar um WhatsApp Business, o painel tenta importar as etiquetas que já existem no aplicativo.",
        ],
    },
    {
        id: "bot",
        title: "8. Configurações do Bot",
        href: "/dashboard/bot-settings",
        intro: "Comportamento do bot e proteções da conta.",
        steps: [
            "Defina nome, prefixo de comandos e quem pode usar o bot (todos, só o dono ou listas).",
            "Em Automação e presença: mensagem de boas-vindas, sempre online e leitura automática.",
            "Em Proteção anti-banimento: ative o atraso automático entre mensagens.",
            "Cada bloco tem o seu botão de salvar.",
        ],
    },
    {
        id: "extras",
        title: "9. Figurinhas, mídia e perfil",
        href: "/dashboard/sticker",
        intro: "Recursos de apoio.",
        steps: [
            "Criador de figurinhas: envie uma imagem, defina pacote e autor e mande para um número.",
            "Gerenciador de mídia: lista os arquivos baixados; selecione e exclua para liberar espaço.",
            "Perfil do bot: altera nome, recado e foto do WhatsApp conectado.",
        ],
    },
    {
        id: "integracoes",
        title: "10. Webhooks e API",
        href: "/dashboard/webhooks",
        intro: "Para ligar o painel a outras ferramentas, como o n8n.",
        steps: [
            "Gere a Chave de API e envie no cabeçalho X-API-Key das requisições.",
            "Cadastre um webhook com a URL de destino e escolha os eventos (mensagem recebida, enviada, conexão...).",
            "Consulte a Documentação da API para ver todos os endpoints.",
        ],
    },
    {
        id: "admin",
        title: "11. Administração",
        href: "/dashboard/users",
        intro: "Disponível para Super Admin.",
        steps: [
            "Usuários: crie contas e defina funções.",
            "Acesso às sessões: compartilhe uma sessão com outro usuário.",
            "Notificações: envie avisos aos usuários.",
            "Monitor do sistema: CPU, memória e disco.",
            "Configurações: nome do app, fuso horário e cadastro público.",
        ],
    },
];

const roteiro = [
    "Conecte o número do salão em Sessões / QR.",
    "Crie etiquetas úteis (Cliente VIP, Retorno, Novo contato).",
    "Configure de 3 a 5 respostas automáticas.",
    "Monte a lista de números e faça um disparo de teste com 2 ou 3 pessoas.",
    "Agende lembretes de retorno no Agendador.",
];

export default function GuiaPage() {
    return (
        <div className="max-w-4xl space-y-12 pb-16">
            <header className="space-y-3">
                <p className="kicker">Ajuda</p>
                <h1 className="text-4xl font-bold">Guia de uso</h1>
                <span className="gold-bar" />
                <p className="text-muted-foreground max-w-2xl">
                    Um passo a passo de cada área do painel. Use o índice para ir direto ao que precisa.
                </p>
            </header>

            <nav className="border border-border p-5">
                <p className="kicker mb-3">Índice</p>
                <ul className="grid gap-x-8 gap-y-1.5 sm:grid-cols-2 text-sm">
                    {sections.map((s) => (
                        <li key={s.id}>
                            <a href={`#${s.id}`} className="hover:underline underline-offset-4">
                                {s.title}
                            </a>
                        </li>
                    ))}
                    <li>
                        <a href="#roteiro" className="hover:underline underline-offset-4">
                            Roteiro sugerido para o salão
                        </a>
                    </li>
                </ul>
            </nav>

            {sections.map((s) => (
                <section key={s.id} id={s.id} className="scroll-mt-24 border-t border-border pt-8 space-y-4">
                    <div className="flex flex-wrap items-baseline justify-between gap-3">
                        <h2 className="text-2xl font-bold">{s.title}</h2>
                        {s.href && (
                            <Link href={s.href} className="kicker underline underline-offset-4 hover:text-foreground">
                                Abrir esta tela →
                            </Link>
                        )}
                    </div>
                    <p className="text-muted-foreground">{s.intro}</p>
                    <ol className="space-y-3">
                        {s.steps.map((step, i) => (
                            <li key={i} className="flex gap-4 text-sm leading-relaxed">
                                <span className="w-6 shrink-0 tabular-nums text-muted-foreground">
                                    {String(i + 1).padStart(2, "0")}
                                </span>
                                <span>{step}</span>
                            </li>
                        ))}
                    </ol>
                    {s.tip && (
                        <p className="border-l-2 border-brand pl-4 text-sm text-muted-foreground">
                            <span className="kicker mr-2">Dica</span>
                            {s.tip}
                        </p>
                    )}
                </section>
            ))}

            <section id="roteiro" className="scroll-mt-24 border-t border-border pt-8 space-y-4">
                <h2 className="text-2xl font-bold">Roteiro sugerido para o salão</h2>
                <ol className="space-y-3">
                    {roteiro.map((step, i) => (
                        <li key={i} className="flex gap-4 text-sm leading-relaxed">
                            <span className="w-6 shrink-0 tabular-nums text-muted-foreground">
                                {String(i + 1).padStart(2, "0")}
                            </span>
                            <span>{step}</span>
                        </li>
                    ))}
                </ol>
            </section>
        </div>
    );
}
