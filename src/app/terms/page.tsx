import type { Metadata } from "next";
import { LegalLayout } from "@/components/legal-layout";

export const metadata: Metadata = {
    title: { absolute: "Termos de Uso | Sai aê CRM" },
    description: "Regras de uso, planos, cobrança e responsabilidades do Sai aê CRM.",
    alternates: { canonical: "/terms" },
    robots: { index: true, follow: true },
};

export default function TermsPage() {
    return (
        <LegalLayout title="Termos de Uso" updated="6 de outubro de 2026">
            <section>
                <h2>1. O serviço</h2>
                <p>
                    O Sai aê CRM é uma ferramenta web para conectar o seu número de WhatsApp e enviar, agendar e responder mensagens,
                    organizar contatos com etiquetas e gerar textos com inteligência artificial. Ao criar uma conta ou assinar, você concorda com estes termos.
                </p>
            </section>

            <section>
                <h2>2. Seu número e sua responsabilidade</h2>
                <ul>
                    <li>O Sai aê CRM <strong>não é um produto do WhatsApp nem da Meta</strong> e não usa a API oficial. A conexão funciona como o WhatsApp Web.</li>
                    <li>O WhatsApp pode restringir ou bloquear números por conta própria. Você usa o serviço <strong>por sua conta e risco</strong> e não garantimos que um número nunca será bloqueado.</li>
                    <li>Você é responsável pelo conteúdo que envia e pelas listas de contatos que usa.</li>
                </ul>
            </section>

            <section>
                <h2>3. Uso aceitável</h2>
                <p>É proibido usar o serviço para:</p>
                <ul>
                    <li>enviar mensagens para quem não pediu ou não consentiu em recebê-las (spam), inclusive com listas compradas;</li>
                    <li>golpes, conteúdo ilegal, ofensivo ou que viole direitos de terceiros;</li>
                    <li>tentar burlar limites do plano, o intervalo entre envios ou os mecanismos de proteção;</li>
                    <li>revender ou compartilhar sua conta sem autorização.</li>
                </ul>
                <p className="mt-3">Podemos suspender ou encerrar contas que descumpram estas regras, sem reembolso.</p>
            </section>

            <section>
                <h2>4. Planos, limites e cobrança</h2>
                <ul>
                    <li>As assinaturas são mensais e renovadas automaticamente, com cobrança por cartão pela Stripe.</li>
                    <li>Cada plano tem limites de números de WhatsApp, disparos e textos com IA por mês, informados na página de planos.</li>
                    <li>Ao atingir um limite, os envios correspondentes ficam bloqueados até o mês seguinte ou até a troca de plano.</li>
                    <li>Se o pagamento falhar, a conta pode ser suspensa. Os dados são mantidos para você regularizar.</li>
                    <li>Você pode cancelar a qualquer momento. O acesso continua até o fim do período já pago.</li>
                </ul>
            </section>

            <section>
                <h2>5. Teste grátis</h2>
                <p>O teste grátis tem duração e limites reduzidos. Ao fim dele, é preciso escolher um plano para continuar enviando mensagens.</p>
            </section>

            <section>
                <h2>6. Dados</h2>
                <p>
                    O tratamento de dados está descrito na <a className="underline underline-offset-4 font-semibold" href="/privacy">Política de Privacidade</a>.
                    Você é responsável por ter base legal para enviar mensagens aos seus contatos.
                </p>
            </section>

            <section>
                <h2>7. Disponibilidade e responsabilidade</h2>
                <p>
                    Trabalhamos para manter o serviço disponível, mas ele é oferecido no estado em que se encontra, podendo ter interrupções.
                    Na extensão permitida pela lei, não respondemos por lucros cessantes, bloqueio de números ou perdas decorrentes de uso indevido.
                    Nossa responsabilidade se limita ao valor pago nos últimos 3 meses.
                </p>
            </section>

            <section>
                <h2>8. Mudanças e foro</h2>
                <p>
                    Podemos atualizar estes termos e avisaremos quando a mudança for relevante. Fica eleito o foro da comarca de Brasília/DF
                    para resolver questões deste contrato, ressalvados os direitos do consumidor.
                </p>
            </section>
        </LegalLayout>
    );
}
