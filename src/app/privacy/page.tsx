import type { Metadata } from "next";
import { LegalLayout } from "@/components/legal-layout";

export const metadata: Metadata = {
    title: { absolute: "Política de Privacidade | Sai aê CRM" },
    description: "Como o Sai aê CRM coleta, usa e protege os dados dos seus clientes, conforme a LGPD.",
    alternates: { canonical: "/privacy" },
    robots: { index: true, follow: true },
};

const WHATSAPP = "https://wa.me/5561999531848?text=Oi%21%20Tenho%20uma%20d%C3%BAvida%20sobre%20privacidade%20no%20Sai%20a%C3%AA%20CRM.";

export default function PrivacyPage() {
    return (
        <LegalLayout title="Política de Privacidade" updated="6 de outubro de 2026">
            <section>
                <h2>1. Quem somos</h2>
                <p>
                    O Sai aê CRM é um serviço de atendimento e envio de mensagens pelo WhatsApp, oferecido pelo Sai aê.
                    Para falar sobre privacidade ou exercer seus direitos, <a className="underline underline-offset-4 font-semibold" href={WHATSAPP}>fale com a gente pelo WhatsApp</a>.
                </p>
            </section>

            <section>
                <h2>2. Dois papéis diferentes</h2>
                <ul>
                    <li><strong>Seus dados de conta</strong> (nome, e-mail, plano e pagamentos): somos os controladores.</li>
                    <li><strong>Os dados dos seus clientes</strong> (contatos, conversas e etiquetas): você, assinante, decide o que fazer com eles. Nós somos operadores e tratamos esses dados apenas para prestar o serviço.</li>
                </ul>
            </section>

            <section>
                <h2>3. Quais dados tratamos</h2>
                <ul>
                    <li>Conta: nome, e-mail, senha (guardada de forma criptografada) e plano contratado.</li>
                    <li>Conteúdo do serviço: contatos, nomes, números de telefone, mensagens, mídias e etiquetas sincronizados do número de WhatsApp que você conecta.</li>
                    <li>Uso: quantidade de disparos e de textos com IA no mês, e registros técnicos para segurança e suporte.</li>
                    <li>Pagamento: processado pela Stripe. Não armazenamos número de cartão.</li>
                    <li>Site e anúncios: se você chegar por um anúncio, podemos usar cookies e a tag do Google para medir resultados.</li>
                </ul>
            </section>

            <section>
                <h2>4. Para que usamos</h2>
                <ul>
                    <li>Prestar o serviço contratado: conectar o WhatsApp, enviar, agendar e responder mensagens.</li>
                    <li>Cobrar, aplicar os limites do plano e dar suporte.</li>
                    <li>Proteger a plataforma contra abuso, fraude e envio de spam.</li>
                    <li>Medir e melhorar nossos anúncios e o produto.</li>
                </ul>
                <p className="mt-3">Não vendemos dados e não os usamos para outras campanhas nossas.</p>
            </section>

            <section>
                <h2>5. Com quem compartilhamos</h2>
                <ul>
                    <li><strong>Hospedagem e banco de dados:</strong> Railway.</li>
                    <li><strong>Pagamentos:</strong> Stripe.</li>
                    <li><strong>Textos com IA:</strong> Google (Gemini). Apenas o que você escreve no campo da IA é enviado, sem a lista de contatos.</li>
                    <li><strong>Medição de anúncios:</strong> Google Ads.</li>
                    <li>Autoridades, quando a lei exigir.</li>
                </ul>
            </section>

            <section>
                <h2>6. Por quanto tempo guardamos</h2>
                <p>
                    Enquanto sua assinatura estiver ativa. Depois do cancelamento, mantemos os dados por até 30 dias para você poder voltar
                    e então os apagamos, salvo o que a lei exigir guardar (por exemplo, registros de pagamento).
                </p>
            </section>

            <section>
                <h2>7. Seus direitos (LGPD)</h2>
                <p>
                    Você pode pedir acesso, correção, portabilidade, anonimização ou exclusão dos seus dados, e saber com quem compartilhamos,
                    conforme o art. 18 da Lei 13.709/2018. Se for cliente final de um dos nossos assinantes, o pedido também pode ser feito diretamente ao estabelecimento.
                </p>
            </section>

            <section>
                <h2>8. Segurança</h2>
                <p>
                    Usamos conexão criptografada (HTTPS), senhas criptografadas, acesso restrito e cópias de segurança do banco.
                    Nenhum sistema é 100% imune, e avisaremos você caso ocorra um incidente relevante.
                </p>
            </section>

            <section>
                <h2>9. Mudanças</h2>
                <p>Podemos atualizar esta política. A data de atualização fica no topo da página.</p>
            </section>
        </LegalLayout>
    );
}
