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
 *
 * LGPD: a tag do Google só é carregada depois que o visitante aceita os cookies.
 * O aviso só aparece quando o rastreamento está configurado.
 */
export const dynamic = "force-dynamic";

function adsConfig(): { id: string; label: string } | null {
    const id = (process.env.GOOGLE_ADS_ID || "").trim();
    if (!/^AW-\d+$/.test(id)) return null;
    const label = (process.env.GOOGLE_ADS_CONVERSION_LABEL || "").trim().replace(/[^A-Za-z0-9_-]/g, "");
    return { id, label };
}

/** Script do <head>: só carrega a tag do Google se o visitante já aceitou. */
function headScript(cfg: { id: string; label: string }): string {
    const conversion = cfg.label ? `gtag('event','conversion',{send_to:'${cfg.id}/${cfg.label}'});` : "";
    return `<script>
(function(){
  var KEY='saiae_cookies';
  function get(){try{return localStorage.getItem(KEY)}catch(e){return null}}
  function set(v){try{localStorage.setItem(KEY,v)}catch(e){}}
  function load(){
    if(window.__adsLoaded)return;window.__adsLoaded=1;
    var s=document.createElement('script');s.async=true;s.src='https://www.googletagmanager.com/gtag/js?id=${cfg.id}';document.head.appendChild(s);
    window.dataLayer=window.dataLayer||[];window.gtag=function(){dataLayer.push(arguments)};
    gtag('js',new Date());gtag('config','${cfg.id}');
    document.addEventListener('click',function(e){
      var a=e.target.closest&&e.target.closest('a[href^="https://wa.me"],a[href^="https://buy.stripe.com"]');
      if(!a)return;
      gtag('event','generate_lead',{event_category:'whatsapp'});
      ${conversion}
    });
  }
  window.saiaeCookies={
    accept:function(){set('yes');load();},
    decline:function(){set('no');},
    choice:get
  };
  if(get()==='yes')load();
})();
</script>`;
}

/** Aviso de cookies (aparece só se o visitante ainda não escolheu) + link para mudar a escolha. */
const BANNER = `
<style>
#ck{position:fixed;left:12px;right:12px;bottom:12px;z-index:100;max-width:560px;margin-inline:auto;background:#fff;border-radius:20px 20px 20px 6px;box-shadow:0 16px 40px rgba(24,23,28,.22);padding:18px 18px 16px;display:none;font-family:'Figtree',system-ui,sans-serif;color:#18171C}
#ck.on{display:block}
#ck p{margin:0 0 14px;font-size:14.5px;line-height:1.5;color:#45434D}
#ck a{color:#18171C;font-weight:700;text-decoration:underline}
#ck .row{display:flex;gap:10px;flex-wrap:wrap}
#ck button{height:44px;padding:0 18px;border-radius:14px;border:0;font:700 15px 'Figtree',system-ui,sans-serif;cursor:pointer}
#ck .ok{background:#FFC21A;color:#18171C}
#ck .no{background:#fff;color:#18171C;box-shadow:inset 0 0 0 1.5px #D9D7DC}
#ck button:focus-visible{outline:3px solid #FFC21A;outline-offset:2px}
</style>
<div id="ck" role="dialog" aria-label="Aviso de cookies">
  <p>Usamos cookies para medir o resultado dos nossos anúncios. Você escolhe se aceita. Saiba mais na <a href="/privacy">Política de Privacidade</a>.</p>
  <div class="row"><button class="ok" id="ck-ok" type="button">Aceitar</button><button class="no" id="ck-no" type="button">Recusar</button></div>
</div>
<script>
(function(){
  var box=document.getElementById('ck');
  function hide(){box.classList.remove('on')}
  if(!window.saiaeCookies)return;
  if(!saiaeCookies.choice())box.classList.add('on');
  document.getElementById('ck-ok').onclick=function(){saiaeCookies.accept();hide()};
  document.getElementById('ck-no').onclick=function(){saiaeCookies.decline();hide()};
  var open=document.getElementById('ck-open');
  if(open)open.onclick=function(e){e.preventDefault();box.classList.add('on')};
})();
</script>`;

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
    let html = applyStripeLinks(readFileSync(file, "utf8"));

    const ads = adsConfig();
    if (ads) {
        html = html
            .replace("<!--GOOGLE_TAG-->", headScript(ads))
            .replace('<a href="/terms">Termos de uso</a>', '<a href="/terms">Termos de uso</a>\n      <a href="#" id="ck-open">Cookies</a>')
            .replace("</body>", `${BANNER}\n</body>`);
    } else {
        html = html.replace("<!--GOOGLE_TAG-->", "");
    }

    return new Response(html, {
        headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400",
        },
    });
}
