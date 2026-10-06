import { readFileSync } from "fs";
import path from "path";

/**
 * Página inicial pública (landing do Sai aê CRM), servida como HTML próprio para
 * ter controle total do SEO e da velocidade (anúncios do Google Ads).
 * Fonte: src/landing/crm.html
 *
 * Google Ads (opcional), por variáveis de ambiente do servidor:
 *   GOOGLE_ADS_ID                 ex.: AW-1234567890
 *   GOOGLE_ADS_CONVERSION_LABEL   ex.: AbCdEfGhIj (rótulo da conversão "clique no WhatsApp")
 */
export const dynamic = "force-dynamic";

function googleTag(): string {
    const id = (process.env.GOOGLE_ADS_ID || "").trim();
    if (!/^AW-\d+$/.test(id)) return "";
    const label = (process.env.GOOGLE_ADS_CONVERSION_LABEL || "").trim().replace(/[^A-Za-z0-9_-]/g, "");
    const conversion = label ? `gtag('event','conversion',{send_to:'${id}/${label}'});` : "";
    return `<script async src="https://www.googletagmanager.com/gtag/js?id=${id}"></script>
<script>
window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}
gtag('js',new Date());gtag('config','${id}');
document.addEventListener('click',function(e){
  var a=e.target.closest&&e.target.closest('a[href^="https://wa.me"],a[href^="https://buy.stripe.com"]');
  if(!a)return;
  gtag('event','generate_lead',{event_category:'whatsapp'});
  ${conversion}
});
</script>`;
}

const WA = "https://wa.me/5561999531848";

/** Se os links da Stripe estiverem configurados, os botões dos planos abrem o pagamento direto. */
function applyStripeLinks(html: string): string {
    const links: Record<string, string | undefined> = {
        Essencial: process.env.STRIPE_LINK_ESSENCIAL,
        Pro: process.env.STRIPE_LINK_PRO,
        Escala: process.env.STRIPE_LINK_ESCALA,
    };
    if (!links.Essencial || !links.Pro || !links.Escala) return html;

    let out = html;
    for (const [plan, url] of Object.entries(links)) {
        const re = new RegExp(`href="${WA}\\?text=[^"]*plano%20${plan}%20[^"]*"`);
        out = out.replace(re, `href="${url}"`);
    }
    out = out.split("Clique no botão do plano que você quer. Ele abre uma conversa no nosso WhatsApp e a gente faz tudo com você por lá.").join("Clique no botão do plano que você quer e pague com cartão em ambiente seguro. Você recebe o acesso por e-mail na hora. Prefere conversar antes? Chame a gente no WhatsApp.");
    return out;
}

export function GET() {
    const file = path.join(process.cwd(), "src", "landing", "crm.html");
    const html = applyStripeLinks(readFileSync(file, "utf8")).replace("<!--GOOGLE_TAG-->", googleTag());
    return new Response(html, {
        headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400",
        },
    });
}
