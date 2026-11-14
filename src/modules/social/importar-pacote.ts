import { createHash, randomUUID } from "crypto";
import { prisma } from "@/lib/prisma";
import { quotaMidiaBytes } from "@/lib/media-retention";
import { mediaStorage } from "@/lib/media-storage";
import { ensurePublicTokens } from "./posts";
import { parseContent } from "./validate";

/** Contrato agencia-crm/1 (docs/gestao-tecnica/contrato-importacao-agencia-crm.md). Importa SEMPRE como DRAFT. */
export const SOURCE = "agencia";
export const CONTRATO = "agencia-crm/1";
export const MAX_PECAS = 60;
export const MAX_ARQUIVOS = 300;
/** Teto de bytes de mídia por lote (a rota também recusa pelo content-length antes de ler o corpo). */
export const MAX_LOTE_BYTES = 60 * 1024 * 1024;
const MAX_BYTES = 5 * 1024 * 1024;
const MIMES = new Set(["image/jpeg", "image/png", "image/webp"]);
const EDITAVEIS = ["DRAFT", "PENDING"];
const SLUG = /^[a-z0-9-]+$/;
const SEMANA = /^\d{4}-S\d{2}$/;
const SHA = /^[0-9a-f]{64}$/;

export type Codigo =
    | "status_nao_aprovado" | "lint_com_erro" | "conta_nao_encontrada" | "formato_nao_suportado" | "midia_invalida"
    | "legenda_longa" | "quota_midia" | "lote_grande" | "versao_antiga" | "conflito_publicado" | "hash_invalido" | "item_invalido";

export interface ArquivoRecebido { type: string; size: number; arrayBuffer(): Promise<ArrayBuffer> }

export interface ItemResposta {
    externalKey: string;
    resultado: "criado" | "atualizado" | "inalterado" | "rejeitado";
    postId?: string; groupId?: string | null; mediaIds?: string[]; estado?: string; urlPainel?: string; avisos?: string[];
    erro?: { codigo: Codigo; mensagem: string };
}

export interface RespostaImportacao {
    status: boolean; modo: "validar" | "importar"; lote: string;
    resumo: Record<"criado" | "atualizado" | "inalterado" | "rejeitado", number>;
    itens: ItemResposta[]; message?: string; codigo?: Codigo;
}

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Rec) : {});
const str = (v: unknown) => (typeof v === "string" ? v : "");

/** JSON canônico: chaves ordenadas, sem espaços (igual a json.dumps(sort_keys=True, separators=(",",":"), ensure_ascii=False)). */
export function canonico(v: unknown): string {
    if (Array.isArray(v)) return `[${v.map(canonico).join(",")}]`;
    if (v && typeof v === "object") {
        const o = v as Rec;
        return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonico(o[k])}`).join(",")}}`;
    }
    return JSON.stringify(v ?? null);
}

/** Hash do conteúdo (contrato 3.4). Mídias na ordem dos slides. */
export function hashConteudo(p: Rec): string {
    const midias = (Array.isArray(p.midias) ? p.midias : []).map((m) => str(rec(m).sha256));
    const o = {
        slug: str(p.slug), formato: str(p.formato), legenda: str(p.legenda), hashtags: str(p.hashtags),
        data_planejada: str(p.data_planejada), hora_planejada: str(p.hora_planejada), midias,
    };
    return createHash("sha256").update(canonico(o)).digest("hex");
}

/** Data + hora de Brasília (UTC-3, sem horário de verão desde 2019) → instante UTC. */
export function planejadoEm(data: string, hora: string): Date | null {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return null;
    const d = new Date(`${data}T${/^([01]\d|2[0-3]):[0-5]\d$/.test(hora) ? hora : "12:00"}:00-03:00`);
    return Number.isNaN(d.getTime()) ? null : d;
}

const urlPainel = (estado: string) => `/dashboard/redes-sociais/${estado === "DRAFT" ? "rascunhos" : estado === "PENDING" ? "calendario" : "historico"}`;

/** Motivo pelo qual o post não pode sair de rascunho (achado 8), ou null. Posts sem vínculo (manuais) nunca são bloqueados. */
export async function bloqueioEditorial(userId: string, postId: string): Promise<string | null> {
    const link = await prisma.externalPostLink.findFirst({ where: { userId, postId }, select: { editorial: true } });
    return link && link.editorial !== "aprovado" ? link.editorial : null;
}

class ErroItem extends Error {
    constructor(public codigo: Codigo, mensagem: string) { super(mensagem); }
}

interface Ctx {
    userId: string; cliente: string; semana: string; modo: "validar" | "importar";
    arquivos: Map<string, ArquivoRecebido>; contas: Rec; contasOk: Map<string, string>;
}

/** Revoga a aprovação de um vínculo existente: o rascunho deixa de poder ser agendado e um agendado volta a rascunho. */
async function revogar(userId: string, key: string, editorial: string, modo: Ctx["modo"]) {
    const link = await prisma.externalPostLink.findUnique({ where: { userId_source_externalKey: { userId, source: SOURCE, externalKey: key } } });
    if (!link || modo === "validar") return;
    await prisma.externalPostLink.update({ where: { id: link.id }, data: { editorial } });
    await prisma.scheduledPost.updateMany({ where: { id: link.postId, userId, status: "PENDING" }, data: { status: "DRAFT", publishAt: null } });
}

/** Lê e confere os arquivos de mídia de uma peça (mime, tamanho, sha256). Nada é gravado aqui. */
async function lerMidias(p: Rec, ctx: Ctx): Promise<{ nome: string; mime: string; data: Buffer }[]> {
    const lista = Array.isArray(p.midias) ? p.midias : [];
    const saida: { nome: string; mime: string; data: Buffer }[] = [];
    for (const raw of lista) {
        const m = rec(raw);
        const nome = str(m.nome), mime = str(m.mime), sha = str(m.sha256);
        if (!nome || !MIMES.has(mime) || !SHA.test(sha)) throw new ErroItem("midia_invalida", `Mídia inválida (${nome || "sem nome"}): nome, mime ou sha256 incorretos.`);
        const arq = ctx.arquivos.get(str(m.ref) || nome);
        if (!arq) throw new ErroItem("midia_invalida", `Arquivo da mídia ausente: ${nome}.`);
        if (arq.size > MAX_BYTES) throw new ErroItem("midia_invalida", `A mídia ${nome} passa de 5 MB.`);
        if (arq.type !== mime) throw new ErroItem("midia_invalida", `O tipo do arquivo ${nome} não confere com o manifesto.`);
        const data = Buffer.from(await arq.arrayBuffer());
        if (createHash("sha256").update(data).digest("hex") !== sha) throw new ErroItem("midia_invalida", `O sha256 de ${nome} não confere com o arquivo enviado.`);
        saida.push({ nome, mime, data });
    }
    return saida;
}

async function conferirQuota(userId: string, novos: number) {
    const quota = quotaMidiaBytes();
    if (quota <= 0) return;
    const usado = (await prisma.mediaFile.aggregate({ where: { userId }, _sum: { size: true } }))._sum.size ?? 0;
    if (usado + novos > quota) throw new ErroItem("quota_midia", "Limite de armazenamento de imagens atingido.");
}

async function gravarMidias(userId: string, midias: { nome: string; mime: string; data: Buffer }[]): Promise<string[]> {
    const ids: string[] = [];
    try {
        for (const m of midias) ids.push((await mediaStorage.save({ userId, name: m.nome, mime: m.mime, data: m.data })).id);
        if (!(await ensurePublicTokens(userId, ids))) throw new Error("mídia não encontrada após o envio");
    } catch (e) {
        await mediaStorage.remove(ids);
        throw e;
    }
    return ids;
}

/** Remove mídias que a importação criou e que nenhum outro post do usuário usa (nunca apaga mídia compartilhada). */
async function removerMidiasDaImportacao(userId: string, ids: string[], exceto: string) {
    if (!ids.length) return;
    const outros = await prisma.scheduledPost.findMany({ where: { userId, id: { not: exceto } }, select: { mediaIds: true } });
    const usadas = new Set(outros.flatMap((o) => (Array.isArray(o.mediaIds) ? (o.mediaIds as string[]) : [])));
    await mediaStorage.remove(ids.filter((id) => !usadas.has(id)));
}

const idsDoMeta = (meta: unknown): string[] => { const v = rec(meta).mediaIds; return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []; };

async function processarItem(raw: unknown, ctx: Ctx, reentrada = false): Promise<ItemResposta> {
    const p = rec(raw);
    const slug = str(p.slug);
    const externalKey = `${ctx.cliente}:${ctx.semana}:${slug}`;
    const rej = (codigo: Codigo, mensagem: string): ItemResposta => ({ externalKey, resultado: "rejeitado", erro: { codigo, mensagem } });
    try {
        if (!SLUG.test(slug)) return rej("item_invalido", "slug ausente ou inválido.");
        const { userId } = ctx;

        // 1) reprovado/bloqueado nunca entra; se já existe vínculo, ele é travado (bloqueio editorial)
        const status = str(p.status_editorial);
        if (status !== "aprovado") {
            await revogar(userId, externalKey, status || "pendente_aprovacao", ctx.modo);
            return rej("status_nao_aprovado", `status_editorial "${status || "ausente"}" não é aprovado.`);
        }
        const lint = rec(p.lint);
        if (lint.erros !== 0) {
            await revogar(userId, externalKey, "bloqueado_lint", ctx.modo);
            return rej("lint_com_erro", "lint.erros precisa ser 0.");
        }

        const versao = p.versao;
        if (!Number.isInteger(versao) || (versao as number) < 1) return rej("item_invalido", "versao inválida.");
        if (!SHA.test(str(p.hash))) return rej("hash_invalido", "hash ausente ou fora do formato sha256.");
        if (p.formato === "reel") return rej("formato_nao_suportado", "Reel (vídeo) ainda não é suportado pelo CRM.");
        if (p.formato !== "carrossel" && p.formato !== "stories") return rej("formato_nao_suportado", `formato "${str(p.formato)}" desconhecido.`);
        if (hashConteudo(p) !== p.hash) return rej("hash_invalido", "O hash não confere com o conteúdo da peça.");

        const avisos: string[] = [];
        const type = p.formato === "stories" ? "STORY" : "FEED";
        const hashtags = str(p.hashtags).trim();
        const legenda = [str(p.legenda).trim(), hashtags].filter(Boolean).join("\n\n");
        if (type === "STORY" && legenda) avisos.push("Story não publica legenda: ela foi descartada.");
        const arqs = Array.isArray(p.midias) ? p.midias : [];
        // valida tipo/qtde de imagens/legenda com a mesma regra do CRM (ids fictícios; as reais só existem depois do envio)
        const conteudo = parseContent({ type, caption: legenda, mediaIds: arqs.map((_, i) => `m${i}`) }, ["instagram"]);
        if ("error" in conteudo) return rej(legenda.length > 2200 ? "legenda_longa" : "midia_invalida", conteudo.error);

        const contaId = str(p.formato === "stories" ? ctx.contas.stories : ctx.contas.carrossel) || str(ctx.contas.padrao);
        if (!ctx.contasOk.has(contaId)) return rej("conta_nao_encontrada", "Conta social do formato não definida em contas.");

        const plannedAt = planejadoEm(str(p.data_planejada), str(p.hora_planejada));
        if (!plannedAt) avisos.push("data_planejada ausente ou inválida: a peça fica sem data planejada.");
        else if (plannedAt.getTime() < Date.now()) avisos.push("A data planejada já passou.");
        if (str(p.hora_planejada) && !/^([01]\d|2[0-3]):[0-5]\d$/.test(str(p.hora_planejada))) avisos.push("hora_planejada inválida: usado 12:00.");

        const where = { userId_source_externalKey: { userId, source: SOURCE, externalKey } };
        let link = await prisma.externalPostLink.findUnique({ where });
        const meta = { cliente: ctx.cliente, semana: ctx.semana, formato: p.formato, aprovado_por: str(p.aprovado_por) || null, aprovado_em: str(p.aprovado_em) || null };

        const postAnt = link ? await prisma.scheduledPost.findFirst({ where: { id: link.postId, userId } }) : null;
        if (link && !postAnt) { // o humano apagou o rascunho: o vínculo ficou órfão, recria a peça do zero
            avisos.push("A postagem anterior foi apagada no CRM; a peça foi recriada como rascunho.");
            if (ctx.modo === "importar") {
                await prisma.externalPostLink.deleteMany({ where: { id: link.id, userId } });
                await removerMidiasDaImportacao(userId, idsDoMeta(link.meta), "");
            }
            link = null;
        }

        if (link && postAnt) {
            const mesmo = link.contentHash === p.hash;
            if (mesmo && link.editorial === "aprovado") {
                return { externalKey, resultado: "inalterado", postId: link.postId, groupId: postAnt.groupId ?? null, mediaIds: (postAnt.mediaIds as string[]) ?? [], estado: postAnt.status, urlPainel: urlPainel(postAnt.status), avisos };
            }
            if (!mesmo && (versao as number) <= link.version) return rej("versao_antiga", `versao ${versao as number} não é maior que a registrada (${link.version}).`);
            if (!postAnt || !EDITAVEIS.includes(postAnt.status)) return rej("conflito_publicado", "A postagem já foi enviada ou está sendo publicada e não pode mudar.");

            if (mesmo) { // mesmo conteúdo reaprovado pela agência: só destrava o vínculo
                if (ctx.modo === "importar") await prisma.externalPostLink.update({ where: { id: link.id }, data: { editorial: "aprovado" } });
                return { externalKey, resultado: "atualizado", postId: postAnt.id, groupId: postAnt.groupId, mediaIds: postAnt.mediaIds as string[], estado: postAnt.status, urlPainel: urlPainel(postAnt.status), avisos };
            }

            const midias = await lerMidias(p, ctx);
            await conferirQuota(userId, midias.reduce((s, m) => s + m.data.length, 0));
            if (ctx.modo === "validar") return { externalKey, resultado: "atualizado", postId: postAnt.id, estado: "DRAFT", urlPainel: urlPainel("DRAFT"), avisos };

            const novos = await gravarMidias(userId, midias);
            const importadasAntes = idsDoMeta(link.meta);
            avisos.push(`Edição manual e agendamento anteriores foram substituídos pela versão ${versao as number}; o rascunho voltou a DRAFT.`);
            // volta a DRAFT: conteúdo mudou, o agendamento anterior deixa de valer e um humano reagenda.
            // Post e vínculo mudam na MESMA transação: se um falhar, nada fica pela metade (achado 7).
            try {
                await prisma.$transaction(async (tx) => {
                    // atualização condicional (achado 8): só vale se versão/hash/estado editorial ainda forem os que foram lidos e validados acima
                    const v = await tx.externalPostLink.updateMany({
                        where: { id: link.id, version: link.version, contentHash: link.contentHash, editorial: link.editorial },
                        data: { version: versao as number, contentHash: p.hash as string, editorial: "aprovado", plannedAt, meta: { ...meta, mediaIds: novos } },
                    });
                    if (v.count !== 1) throw new ErroItem("versao_antiga", "Outra importação alterou esta peça ao mesmo tempo; reenvie o manifesto.");
                    const r = await tx.scheduledPost.updateMany({
                        where: { id: postAnt.id, userId, status: { in: EDITAVEIS } },
                        data: { type, caption: type === "STORY" ? null : legenda || null, mediaIds: novos, status: "DRAFT", publishAt: null },
                    });
                    if (r.count !== 1) throw new ErroItem("conflito_publicado", "A postagem mudou durante a importação.");
                });
            } catch (e) { // rollback: as mídias novas não são referenciadas por nenhum post
                await mediaStorage.remove(novos);
                throw e;
            }
            // só depois do commit as mídias antigas podem sair
            await removerMidiasDaImportacao(userId, importadasAntes, postAnt.id);
            return { externalKey, resultado: "atualizado", postId: postAnt.id, groupId: postAnt.groupId, mediaIds: novos, estado: "DRAFT", urlPainel: urlPainel("DRAFT"), avisos };
        }

        const midias = await lerMidias(p, ctx);
        await conferirQuota(userId, midias.reduce((s, m) => s + m.data.length, 0));
        if (ctx.modo === "validar") return { externalKey, resultado: "criado", estado: "DRAFT", urlPainel: urlPainel("DRAFT"), avisos };

        const mediaIds = await gravarMidias(userId, midias);
        const groupId = randomUUID();
        const post = await prisma.scheduledPost.create({
            data: { userId, accountId: contaId, type, caption: type === "STORY" ? null : legenda || null, mediaIds, publishAt: null, groupId, status: "DRAFT" },
        });
        try {
            await prisma.externalPostLink.create({
                data: { userId, source: SOURCE, externalKey, version: versao as number, contentHash: p.hash as string, editorial: "aprovado", postId: post.id, plannedAt, meta: { ...meta, mediaIds } },
            });
        } catch (e) { // corrida com outra importação da mesma chave: desfaz para não deixar post órfão
            await prisma.scheduledPost.deleteMany({ where: { id: post.id, userId } });
            await mediaStorage.remove(mediaIds);
            if (rec(e).code !== "P2002") throw e;
            const vencedor = await prisma.externalPostLink.findUnique({ where });
            const postVencedor = vencedor ? await prisma.scheduledPost.findFirst({ where: { id: vencedor.postId, userId } }) : null;
            if (!vencedor || !postVencedor) throw e;
            // só é "inalterado" se o vencedor tem a MESMA versão e o MESMO hash (achado 8)
            if (vencedor.version !== versao || vencedor.contentHash !== p.hash) {
                if (vencedor.version >= (versao as number)) return rej("versao_antiga", `Outra importação gravou a versão ${vencedor.version} ao mesmo tempo; esta (${versao as number}) não é maior.`);
                if (reentrada) throw e;
                return processarItem(raw, ctx, true); // o vencedor é mais antigo: agora o vínculo existe e a rota de atualização cuida do resto
            }
            return { externalKey, resultado: "inalterado", postId: postVencedor.id, groupId: postVencedor.groupId ?? null, mediaIds: postVencedor.mediaIds as string[], estado: postVencedor.status, urlPainel: urlPainel(postVencedor.status), avisos };
        }
        return { externalKey, resultado: "criado", postId: post.id, groupId, mediaIds, estado: "DRAFT", urlPainel: urlPainel("DRAFT"), avisos };
    } catch (e) {
        if (e instanceof ErroItem) return rej(e.codigo, e.message);
        console.error("Importação de peça falhou", externalKey, e);
        return rej("item_invalido", "Falha interna ao importar a peça.");
    }
}

/**
 * Importa um lote. Recusa o lote inteiro (sem gravar nada) se o contrato, o cliente, a semana ou as contas estiverem errados;
 * depois cada peça é independente: a que falha é rejeitada e as outras seguem.
 */
export async function importarPacote(userId: string, manifesto: unknown, arquivos: Map<string, ArquivoRecebido>): Promise<RespostaImportacao & { http: number }> {
    const m = rec(manifesto);
    const modo = m.modo === "importar" ? "importar" : "validar";
    const lote = randomUUID();
    const vazio = { criado: 0, atualizado: 0, inalterado: 0, rejeitado: 0 };
    const falha = (http: number, message: string, codigo?: Codigo) => ({ http, status: false, modo, lote, resumo: vazio, itens: [], message, codigo } as RespostaImportacao & { http: number });

    if (m.contrato !== CONTRATO) return falha(400, `contrato deve ser "${CONTRATO}".`);
    if (!SLUG.test(str(m.cliente))) return falha(400, "cliente inválido (use [a-z0-9-]).");
    if (!SEMANA.test(str(m.semana))) return falha(400, "semana inválida (use AAAA-SNN).");
    if (!Array.isArray(m.pecas) || m.pecas.length < 1) return falha(400, "pecas deve ser uma lista não vazia.");
    if (m.pecas.length > MAX_PECAS) return falha(400, `No máximo ${MAX_PECAS} peças por chamada.`);

    if (arquivos.size > MAX_ARQUIVOS) return falha(413, `No máximo ${MAX_ARQUIVOS} arquivos por chamada.`, "lote_grande");
    let total = 0;
    for (const a of arquivos.values()) total += a.size;
    if (total > MAX_LOTE_BYTES) return falha(413, `O lote passa de ${MAX_LOTE_BYTES / 1024 / 1024} MB de mídia.`, "lote_grande");

    // conta social: todas as ids citadas precisam ser Instagram do dono da chave (nunca adivinhar)
    const contas = rec(m.contas);
    const ids = [...new Set(["padrao", "carrossel", "stories"].map((k) => str(contas[k])).filter(Boolean))];
    if (!str(contas.padrao)) return falha(400, "contas.padrao é obrigatório.", "conta_nao_encontrada");
    const achadas = await prisma.socialAccount.findMany({ where: { id: { in: ids }, userId, provider: "instagram" }, select: { id: true } });
    if (achadas.length !== ids.length) return falha(404, "Conta social não encontrada para este usuário (ou não é Instagram).", "conta_nao_encontrada");

    const ctx: Ctx = { userId, cliente: str(m.cliente), semana: str(m.semana), modo, arquivos, contas, contasOk: new Map(achadas.map((a) => [a.id, a.id])) };
    const itens: ItemResposta[] = [];
    const vistos = new Set<string>();
    for (const raw of m.pecas) {
        const slug = str(rec(raw).slug);
        if (vistos.has(slug)) { itens.push({ externalKey: `${ctx.cliente}:${ctx.semana}:${slug}`, resultado: "rejeitado", erro: { codigo: "item_invalido", mensagem: "slug repetido no lote." } }); continue; }
        vistos.add(slug);
        itens.push(await processarItem(raw, ctx));
    }
    const resumo = { ...vazio };
    for (const i of itens) resumo[i.resultado]++;
    return { http: 200, status: true, modo, lote, resumo, itens };
}

/** Retorno de estado para a agência (polling): só vínculos do próprio usuário. */
export async function estadoPorChaves(userId: string, filtro: { keys?: string[]; semana?: string; cliente?: string }) {
    const where: Rec = { userId, source: SOURCE };
    if (filtro.keys?.length) where.externalKey = { in: filtro.keys.slice(0, 200) };
    else if (SLUG.test(filtro.cliente ?? "") && SEMANA.test(filtro.semana ?? "")) where.externalKey = { startsWith: `${filtro.cliente}:${filtro.semana}:` };
    else return null;
    const links = await prisma.externalPostLink.findMany({ where: where as never, orderBy: { externalKey: "asc" }, take: 200 });
    const posts = await prisma.scheduledPost.findMany({ where: { id: { in: links.map((l) => l.postId) }, userId } });
    const byId = new Map(posts.map((p) => [p.id, p]));
    return links.map((l) => {
        const p = byId.get(l.postId);
        return {
            externalKey: l.externalKey, versao: l.version, hash: l.contentHash, editorial: l.editorial,
            postId: l.postId, groupId: p?.groupId ?? null, mediaIds: (p?.mediaIds as string[]) ?? [],
            estado: p?.status ?? "REMOVIDO", plannedAt: l.plannedAt, publishAt: p?.publishAt ?? null,
            releaseId: p?.releaseId ?? null, releaseUrl: p?.releaseUrl ?? null, publishedAt: p?.publishedAt ?? null, erro: p?.error ?? null,
            urlPainel: urlPainel(p?.status ?? "DRAFT"),
        };
    });
}
