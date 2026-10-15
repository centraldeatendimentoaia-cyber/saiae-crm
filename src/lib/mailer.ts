import { logger } from "@/lib/logger";
/**
 * Envio de e-mails transacionais pelo Resend (https://resend.com).
 *
 * Variáveis:
 *   RESEND_API_KEY   chave da API do Resend (obrigatória em produção)
 *   EMAIL_FROM       remetente, ex.: Sai aê <nao-responda@saiae.com.br> (o domínio precisa estar verificado no Resend)
 *
 * Sem RESEND_API_KEY (ambiente local), o e-mail não é enviado e o conteúdo vai para o log do servidor.
 */
export interface Mail {
    to: string;
    subject: string;
    html: string;
    text: string;
}

export async function sendMail(mail: Mail): Promise<boolean> {
    const key = process.env.RESEND_API_KEY;
    const from = process.env.EMAIL_FROM || "Sai aê <nao-responda@saiae.com.br>";

    if (!key) {
        logger.warn("Mailer", `RESEND_API_KEY não definida. E-mail NÃO enviado.\nPara: ${mail.to}\nAssunto: ${mail.subject}\n${mail.text}`);
        return false;
    }

    try {
        const res = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
            body: JSON.stringify({ from, to: [mail.to], subject: mail.subject, html: mail.html, text: mail.text }),
            signal: AbortSignal.timeout(15000),
        });
        if (!res.ok) {
            logger.error("Mailer", "Resend recusou o envio:", res.status, (await res.text()).slice(0, 300));
            return false;
        }
        return true;
    } catch (e) {
        logger.error("Mailer", "Falha ao enviar e-mail:", e);
        return false;
    }
}

export function resetPasswordMail(link: string): Pick<Mail, "subject" | "html" | "text"> {
    return {
        subject: "Redefinir sua senha do Sai aê CRM",
        text: `Recebemos um pedido para redefinir a senha da sua conta no Sai aê CRM.\n\nAbra o link abaixo para criar uma nova senha (vale por 1 hora):\n${link}\n\nSe não foi você, ignore este e-mail: nada será alterado.`,
        html: `<!doctype html><html lang="pt-BR"><body style="margin:0;background:#F6F5F2;font-family:Arial,Helvetica,sans-serif;color:#18171C">
<table width="100%" cellpadding="0" cellspacing="0" role="presentation"><tr><td align="center" style="padding:32px 16px">
<table width="480" cellpadding="0" cellspacing="0" role="presentation" style="max-width:480px;background:#fff;border-radius:24px;padding:32px">
<tr><td>
<p style="margin:0 0 4px;font-size:22px;font-weight:800">Redefinir sua senha</p>
<p style="margin:0 0 24px;font-size:15px;line-height:1.5;color:#5E5C66">Recebemos um pedido para criar uma nova senha para a sua conta no <b>Sai aê CRM</b>. O link vale por 1 hora.</p>
<p style="margin:0 0 24px"><a href="${link}" style="display:inline-block;background:#FFC21A;color:#18171C;font-weight:700;font-size:16px;text-decoration:none;padding:14px 24px;border-radius:14px">Criar nova senha</a></p>
<p style="margin:0;font-size:13px;line-height:1.5;color:#8A8893">Se o botão não funcionar, copie e cole este endereço no navegador:<br><span style="word-break:break-all">${link}</span></p>
<p style="margin:20px 0 0;font-size:13px;color:#8A8893">Se não foi você, ignore este e-mail: nada será alterado.</p>
</td></tr></table></td></tr></table></body></html>`,
    };
}

export function welcomeMail(link: string): Pick<Mail, "subject" | "html" | "text"> {
    return {
        subject: "Bem-vindo ao Sai aê CRM! Crie sua senha",
        text: `Seu pagamento foi confirmado e sua conta no Sai aê CRM já está criada.\n\nCrie sua senha pelo link abaixo (vale por 7 dias) e comece a usar:\n${link}\n\nDepois é só entrar com este e-mail e a senha que você criar.`,
        html: `<!doctype html><html lang="pt-BR"><body style="margin:0;background:#F6F5F2;font-family:Arial,Helvetica,sans-serif;color:#18171C">
<table width="100%" cellpadding="0" cellspacing="0" role="presentation"><tr><td align="center" style="padding:32px 16px">
<table width="480" cellpadding="0" cellspacing="0" role="presentation" style="max-width:480px;background:#fff;border-radius:24px;padding:32px">
<tr><td>
<p style="margin:0 0 4px;font-size:22px;font-weight:800">Bem-vindo ao Sai aê CRM!</p>
<p style="margin:0 0 24px;font-size:15px;line-height:1.5;color:#5E5C66">Seu pagamento foi confirmado e sua conta já está criada. Falta só criar a sua senha (o link vale por 7 dias).</p>
<p style="margin:0 0 24px"><a href="${link}" style="display:inline-block;background:#FFC21A;color:#18171C;font-weight:700;font-size:16px;text-decoration:none;padding:14px 24px;border-radius:14px">Criar minha senha</a></p>
<p style="margin:0;font-size:13px;line-height:1.5;color:#8A8893">Se o botão não funcionar, copie e cole este endereço no navegador:<br><span style="word-break:break-all">${link}</span></p>
</td></tr></table></td></tr></table></body></html>`,
    };
}
