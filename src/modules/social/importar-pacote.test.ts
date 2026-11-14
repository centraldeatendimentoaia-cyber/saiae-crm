/* eslint-disable @typescript-eslint/no-explicit-any -- banco em memória e respostas JSON de teste */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "crypto";
import { NextRequest } from "next/server";

// Banco em memória: cobre só o que a importação, o PATCH de post e o agendador usam.
type Row = Record<string, any>;
const h = vi.hoisted(() => {
    const t: Record<string, Row[]> = { socialAccount: [], scheduledPost: [], mediaFile: [], externalPostLink: [] };
    let n = 0;
    const ok = (row: Row, w: Row): boolean =>
        Object.entries(w).every(([k, c]) => {
            if (k === "userId_source_externalKey") return row.userId === c.userId && row.source === c.source && row.externalKey === c.externalKey;
            if (c && typeof c === "object" && !(c instanceof Date)) {
                if ("in" in c) return c.in.includes(row[k]);
                if ("not" in c) return row[k] !== c.not;
                if ("startsWith" in c) return String(row[k]).startsWith(c.startsWith);
            }
            return row[k] === c;
        });
    const model = (name: string) => ({
        findMany: async ({ where = {} }: Row = {}) => t[name].filter((r) => ok(r, where)),
        findFirst: async ({ where = {} }: Row = {}) => t[name].find((r) => ok(r, where)) ?? null,
        findUnique: async ({ where }: Row) => t[name].find((r) => ok(r, where)) ?? null,
        create: async ({ data }: Row) => {
            if (name === "externalPostLink" && t[name].some((r) => r.userId === data.userId && r.source === data.source && r.externalKey === data.externalKey)) throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
            const row = { id: `${name}-${++n}`, createdAt: new Date(), ...data };
            if (name === "externalPostLink") row.editorial ??= "aprovado";
            t[name].push(row);
            return row;
        },
        update: async ({ where, data }: Row) => { const r = t[name].find((x) => ok(x, where))!; Object.assign(r, data); return r; },
        updateMany: async ({ where, data }: Row) => { const rs = t[name].filter((r) => ok(r, where)); rs.forEach((r) => Object.assign(r, data)); return { count: rs.length }; },
        deleteMany: async ({ where }: Row) => { const rs = t[name].filter((r) => ok(r, where)); t[name] = t[name].filter((r) => !rs.includes(r)); return { count: rs.length }; },
        aggregate: async ({ where }: Row) => ({ _sum: { size: t[name].filter((r) => ok(r, where)).reduce((s, r) => s + r.size, 0) } }),
    });
    const prisma: Row = { socialAccount: model("socialAccount"), scheduledPost: model("scheduledPost"), mediaFile: model("mediaFile"), externalPostLink: model("externalPostLink") };
    // transação em memória: se o callback lançar, restaura o estado anterior (rollback)
    prisma.$transaction = async (fn: (tx: Row) => Promise<unknown>) => {
        const antes = Object.fromEntries(Object.entries(t).map(([k, rs]) => [k, rs.map((r) => ({ ...r }))]));
        try { return await fn(prisma); } catch (e) { for (const k of Object.keys(t)) t[k] = antes[k]; throw e; }
    };
    const reset = () => { for (const k of Object.keys(t)) t[k] = []; n = 0; };
    // chave de API → usuário
    const chaves: Record<string, string> = { "chave-lavi": "u-lavi", "chave-outro": "u-outro" };
    return { t, prisma, reset, chaves };
});
vi.mock("@/lib/prisma", () => ({ prisma: h.prisma }));
vi.mock("@/lib/api-auth", () => ({
    getAuthenticatedUser: async (req: NextRequest) => {
        const id = h.chaves[req.headers.get("x-api-key") || ""];
        return id ? { id, role: "OWNER" } : null;
    },
    canAccessSession: vi.fn(),
}));

import { POST } from "@/app/api/social/importar-pacote/route";
import { GET as ESTADO } from "@/app/api/social/importar-pacote/estado/route";
import { PATCH } from "@/app/api/social/posts/[id]/route";
import { publishOne } from "./scheduler";
import { hashConteudo, importarPacote, MAX_LOTE_BYTES } from "./importar-pacote";

const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const png = (seed: string) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.from(seed)]);

/** Fixture sintética do cenário piloto LAVI (nenhum dado real). */
function peca(slug: string, extra: Record<string, unknown> = {}, nSlides = 2) {
    const arquivos = Array.from({ length: nSlides }, (_, i) => ({ nome: `${slug}-slide-0${i + 1}.png`, bytes: png(`${slug}-${i}`) }));
    const p: Record<string, any> = {
        slug, versao: 1, formato: "carrossel", status_editorial: "aprovado", lint: { erros: 0, avisos: 0 },
        data_planejada: "2099-11-17", hora_planejada: "12:00", legenda: "Fixture: o que está incluso na esmaltação", hashtags: "#fixture #lavi", cta: "Salve",
        midias: arquivos.map((a) => ({ nome: a.nome, mime: "image/png", sha256: sha(a.bytes) })),
        ...extra,
    };
    p.hash = hashConteudo(p);
    return { p, arquivos };
}

function pedido(pecas: ReturnType<typeof peca>[], opts: { chave?: string; contas?: Record<string, string>; modo?: string; semFiles?: boolean } = {}) {
    const manifesto = { contrato: "agencia-crm/1", cliente: "lavi", semana: "2026-S47", modo: opts.modo ?? "importar", contas: opts.contas ?? { padrao: "ig-lavi" }, pecas: pecas.map((x) => x.p) };
    const form = new FormData();
    form.set("manifesto", JSON.stringify(manifesto));
    if (!opts.semFiles) for (const x of pecas) for (const a of x.arquivos) form.set(a.nome, new File([new Uint8Array(a.bytes)], a.nome, { type: "image/png" }));
    return new NextRequest("http://x/api/social/importar-pacote", { method: "POST", body: form, headers: { "x-api-key": opts.chave ?? "chave-lavi" } });
}
const importar = async (...a: Parameters<typeof pedido>) => { const r = await POST(pedido(...a)); return { http: r.status, ...(await r.json()) }; };
const estado = async (qs: string, chave = "chave-lavi") => (await ESTADO(new NextRequest(`http://x/api/social/importar-pacote/estado?${qs}`, { headers: { "x-api-key": chave } }))).json();
const patch = (id: string, body: object, chave = "chave-lavi") =>
    PATCH(new NextRequest(`http://x/api/social/posts/${id}`, { method: "PATCH", body: JSON.stringify(body), headers: { "x-api-key": chave, "content-type": "application/json" } }), { params: Promise.resolve({ id }) });

const chave = (slug: string) => `lavi:2026-S47:${slug}`;

beforeEach(() => {
    h.reset();
    h.t.socialAccount.push(
        { id: "ig-lavi", userId: "u-lavi", provider: "instagram" },
        { id: "ig-outro", userId: "u-outro", provider: "instagram" },
        { id: "fb-lavi", userId: "u-lavi", provider: "facebook" },
    );
});

describe("importação da agência (piloto LAVI, fixtures sintéticas)", () => {
    it("importa como DRAFT com mídia, conta, horário planejado e devolve ids", async () => {
        const x = peca("carrossel-esmaltacao-gel");
        const r = await importar([x]);
        expect(r.http).toBe(200);
        expect(r.resumo).toEqual({ criado: 1, atualizado: 0, inalterado: 0, rejeitado: 0 });
        const it0 = r.itens[0];
        expect(it0).toMatchObject({ externalKey: chave("carrossel-esmaltacao-gel"), resultado: "criado", estado: "DRAFT" });
        expect(it0.mediaIds).toHaveLength(2);
        expect(it0.urlPainel).toContain("/dashboard/redes-sociais");
        const post = h.t.scheduledPost[0];
        expect(post).toMatchObject({ id: it0.postId, userId: "u-lavi", accountId: "ig-lavi", type: "FEED", status: "DRAFT", publishAt: null });
        expect(post.caption).toBe("Fixture: o que está incluso na esmaltação\n\n#fixture #lavi");
        expect(h.t.mediaFile.every((m) => m.userId === "u-lavi" && m.publicToken)).toBe(true);
        expect(h.t.externalPostLink[0].plannedAt.toISOString()).toBe("2099-11-17T15:00:00.000Z"); // 12:00 Brasília
    });

    it("modo validar não grava nada", async () => {
        const r = await importar([peca("a")], { modo: "validar" });
        expect(r.itens[0].resultado).toBe("criado");
        expect(h.t.scheduledPost).toHaveLength(0);
        expect(h.t.mediaFile).toHaveLength(0);
        expect(h.t.externalPostLink).toHaveLength(0);
    });

    it("reimportar idêntico é idempotente (nada duplica, nem mídia)", async () => {
        const x = peca("a");
        const primeira = await importar([x]);
        const segunda = await importar([x]);
        expect(segunda.itens[0]).toMatchObject({ resultado: "inalterado", postId: primeira.itens[0].postId, mediaIds: primeira.itens[0].mediaIds });
        expect(h.t.scheduledPost).toHaveLength(1);
        expect(h.t.mediaFile).toHaveLength(2);
        expect(h.t.externalPostLink).toHaveLength(1);
    });

    it("nova versão com conteúdo novo atualiza o mesmo post e troca a mídia", async () => {
        const v1 = peca("a");
        const r1 = await importar([v1]);
        const v2 = peca("a", { versao: 2, legenda: "Legenda revisada" }, 3);
        const r2 = await importar([v2]);
        expect(r2.itens[0]).toMatchObject({ resultado: "atualizado", postId: r1.itens[0].postId, estado: "DRAFT" });
        expect(r2.itens[0].mediaIds).toHaveLength(3);
        expect(h.t.scheduledPost).toHaveLength(1);
        expect(h.t.scheduledPost[0].caption).toContain("Legenda revisada");
        expect(h.t.mediaFile).toHaveLength(3); // mídias antigas removidas
        expect(h.t.externalPostLink[0]).toMatchObject({ version: 2, contentHash: v2.p.hash });
    });

    it("versão antiga com conteúdo diferente é recusada", async () => {
        await importar([peca("a", { versao: 2 })]);
        const r = await importar([peca("a", { versao: 2, legenda: "outra" })]);
        expect(r.itens[0]).toMatchObject({ resultado: "rejeitado", erro: { codigo: "versao_antiga" } });
    });

    it("não altera post já publicado (conflito_publicado)", async () => {
        const r1 = await importar([peca("a")]);
        h.t.scheduledPost[0].status = "PUBLISHED";
        const r2 = await importar([peca("a", { versao: 2, legenda: "nova" })]);
        expect(r2.itens[0].erro?.codigo).toBe("conflito_publicado");
        expect(h.t.scheduledPost[0].caption).not.toContain("nova");
        expect(r1.itens[0].postId).toBe(h.t.scheduledPost[0].id);
    });

    it("recusa reprovado, bloqueado e lint com erro, com código claro; os demais itens seguem", async () => {
        const r = await importar([
            peca("ok"),
            peca("reprovado", { status_editorial: "reprovado" }),
            peca("pendente", { status_editorial: "pendente_aprovacao" }),
            peca("bloqueado", { status_editorial: "bloqueado_lint" }),
            peca("lint", { lint: { erros: 2, avisos: 0 } }),
        ]);
        expect(r.resumo).toEqual({ criado: 1, atualizado: 0, inalterado: 0, rejeitado: 4 });
        const cod = Object.fromEntries(r.itens.map((i: any) => [i.externalKey.split(":")[2], i.erro?.codigo]));
        expect(cod).toMatchObject({ reprovado: "status_nao_aprovado", pendente: "status_nao_aprovado", bloqueado: "status_nao_aprovado", lint: "lint_com_erro" });
        expect(h.t.scheduledPost).toHaveLength(1);
    });

    it("mídia faltando, adulterada ou de tipo errado rejeita só a peça e não grava nada dela", async () => {
        const falta = peca("falta");
        const r = await importar([falta], { semFiles: true });
        expect(r.itens[0]).toMatchObject({ resultado: "rejeitado", erro: { codigo: "midia_invalida" } });

        const ruim = peca("ruim");
        ruim.arquivos[0].bytes = png("conteudo-diferente"); // arquivo não bate com o sha256 do manifesto
        const r2 = await importar([ruim]);
        expect(r2.itens[0].erro?.codigo).toBe("midia_invalida");
        expect(h.t.scheduledPost).toHaveLength(0);
        expect(h.t.mediaFile).toHaveLength(0);
    });

    it("hash que não confere com o conteúdo é recusado; reel não é suportado; legenda longa recusada", async () => {
        const adulterada = peca("a");
        adulterada.p.legenda = "mudou depois de calcular o hash";
        const reel = peca("reel", { formato: "reel" });
        const longa = peca("longa", { legenda: "x".repeat(2300) });
        const r = await importar([adulterada, reel, longa]);
        expect(r.itens.map((i: any) => i.erro.codigo)).toEqual(["hash_invalido", "formato_nao_suportado", "legenda_longa"]);
    });

    it("story vira STORY com 1 imagem e avisa que a legenda é descartada", async () => {
        const s = peca("story", { formato: "stories" }, 1);
        const r = await importar([s], { contas: { padrao: "ig-lavi", stories: "ig-lavi" } });
        expect(r.itens[0].resultado).toBe("criado");
        expect(r.itens[0].avisos[0]).toContain("legenda");
        expect(h.t.scheduledPost[0]).toMatchObject({ type: "STORY", caption: null });
        const dois = await importar([peca("story2", { formato: "stories" }, 2)]);
        expect(dois.itens[0].resultado).toBe("rejeitado"); // story aceita exatamente 1 imagem
    });

    it("conta social de outro usuário (ou facebook) recusa o lote inteiro sem gravar", async () => {
        for (const conta of ["ig-outro", "fb-lavi", "inexistente"]) {
            const r = await importar([peca("a")], { contas: { padrao: conta } });
            expect(r.http).toBe(404);
            expect(r.codigo).toBe("conta_nao_encontrada");
        }
        expect(h.t.scheduledPost).toHaveLength(0);
        expect(h.t.mediaFile).toHaveLength(0);
    });

    it("exige autenticação", async () => {
        expect((await POST(pedido([peca("a")], { chave: "invalida" }))).status).toBe(401);
        expect((await ESTADO(new NextRequest("http://x/api/social/importar-pacote/estado?cliente=lavi&semana=2026-S47"))).status).toBe(401);
    });
});

describe("retorno de estado e isolamento por usuário", () => {
    it("devolve ids, estado e erro por chave; chave de outro usuário não vê o vínculo", async () => {
        const r = await importar([peca("a"), peca("b")]);
        const dono = await estado("cliente=lavi&semana=2026-S47");
        expect(dono.itens.map((i: any) => i.externalKey)).toEqual([chave("a"), chave("b")]);
        expect(dono.itens[0]).toMatchObject({ postId: r.itens[0].postId, estado: "DRAFT", editorial: "aprovado", versao: 1 });
        h.t.scheduledPost[0].status = "FAILED";
        h.t.scheduledPost[0].error = "Token expirado";
        expect((await estado(`keys=${chave("a")}`)).itens[0]).toMatchObject({ estado: "FAILED", erro: "Token expirado" });

        const outro = await estado(`keys=${chave("a")},${chave("b")}`, "chave-outro");
        expect(outro.itens).toEqual([]);
        expect((await estado("cliente=lavi&semana=2026-S47", "chave-outro")).itens).toEqual([]);
        expect((await ESTADO(new NextRequest("http://x/x", { headers: { "x-api-key": "chave-lavi" } }))).status).toBe(400);
    });

    it("a mesma chave externa em outro usuário é um vínculo separado (sem colisão)", async () => {
        h.t.socialAccount.push({ id: "ig-outro2", userId: "u-outro", provider: "instagram" });
        await importar([peca("a")]);
        const r = await importar([peca("a")], { chave: "chave-outro", contas: { padrao: "ig-outro" } });
        expect(r.itens[0].resultado).toBe("criado");
        expect(h.t.externalPostLink).toHaveLength(2);
    });
});

describe("bloqueio editorial (achado 8)", () => {
    const futuro = "2099-12-01T15:00:00.000Z";

    it("item importado aprovado pode ser agendado pelo humano (DRAFT → PENDING)", async () => {
        const r = await importar([peca("a")]);
        const res = await patch(r.itens[0].postId, { publishAt: futuro });
        expect(res.status).toBe(200);
        expect(h.t.scheduledPost[0]).toMatchObject({ status: "PENDING" });
    });

    it("item reprovado depois de importado não pode ser agendado e o agendado volta a rascunho", async () => {
        const r = await importar([peca("a")]);
        const id = r.itens[0].postId;
        await patch(id, { publishAt: futuro });
        expect(h.t.scheduledPost[0].status).toBe("PENDING");

        const rep = await importar([peca("a", { versao: 2, status_editorial: "reprovado" })]);
        expect(rep.itens[0].erro.codigo).toBe("status_nao_aprovado");
        expect(h.t.externalPostLink[0].editorial).toBe("reprovado");
        expect(h.t.scheduledPost[0]).toMatchObject({ status: "DRAFT", publishAt: null });

        const res = await patch(id, { publishAt: futuro });
        expect(res.status).toBe(409);
        expect((await res.json()).codigo).toBe("editorial_bloqueado");
        expect(h.t.scheduledPost[0].status).toBe("DRAFT");
    });

    it("lint com erro numa reimportação também trava o vínculo", async () => {
        const r = await importar([peca("a")]);
        await importar([peca("a", { lint: { erros: 1, avisos: 0 } })]);
        expect((await patch(r.itens[0].postId, { publishAt: futuro })).status).toBe(409);
    });

    it("nova versão aprovada destrava o item", async () => {
        const r = await importar([peca("a")]);
        await importar([peca("a", { versao: 2, status_editorial: "reprovado" })]);
        const v3 = await importar([peca("a", { versao: 3, legenda: "corrigida" })]);
        expect(v3.itens[0].resultado).toBe("atualizado");
        expect(h.t.externalPostLink[0].editorial).toBe("aprovado");
        expect((await patch(r.itens[0].postId, { publishAt: futuro })).status).toBe(200);
    });

    it("rede de segurança: o agendador não publica peça bloqueada, mesmo PENDING", async () => {
        const r = await importar([peca("a")]);
        h.t.scheduledPost[0].status = "PENDING";
        h.t.externalPostLink[0].editorial = "reprovado";
        await publishOne(r.itens[0].postId);
        expect(h.t.scheduledPost[0]).toMatchObject({ status: "DRAFT", publishAt: null }); // não virou PUBLISHING e não é relido para sempre
    });

    it("regressão do fluxo manual: post sem vínculo agenda como sempre", async () => {
        h.t.scheduledPost.push({ id: "manual-1", userId: "u-lavi", accountId: "ig-lavi", type: "FEED", caption: "x", mediaIds: ["m"], publishAt: null, status: "DRAFT" });
        const res = await patch("manual-1", { publishAt: futuro });
        expect(res.status).toBe(200);
        expect(h.t.scheduledPost[0]).toMatchObject({ status: "PENDING" });
        expect((await patch("manual-1", { draft: true })).status).toBe(200);
        expect(h.t.scheduledPost[0]).toMatchObject({ status: "DRAFT", publishAt: null });
    });

    it("draft:true em peça bloqueada é permitido e applyToGroup não tira irmãs do rascunho", async () => {
        const r = await importar([peca("a")]);
        const id = r.itens[0].postId;
        h.t.externalPostLink[0].editorial = "reprovado";
        expect((await patch(id, { draft: true })).status).toBe(200);
        expect(h.t.scheduledPost[0]).toMatchObject({ status: "DRAFT", publishAt: null });

        h.t.scheduledPost.push({ id: "irma", userId: "u-lavi", accountId: "ig-lavi", type: "FEED", caption: "x", mediaIds: h.t.scheduledPost[0].mediaIds, publishAt: null, groupId: h.t.scheduledPost[0].groupId, status: "DRAFT" });
        expect((await patch("irma", { caption: "nova legenda", applyToGroup: true })).status).toBe(200);
        expect(h.t.scheduledPost.map((x: any) => x.status)).toEqual(["DRAFT", "DRAFT"]);
        expect((await patch(id, { publishAt: futuro, caption: "y", applyToGroup: true })).status).toBe(409);
    });

    it("a revogação só vale para o dono: reprovar na chave de outro usuário não toca no vínculo", async () => {
        await importar([peca("a")]);
        h.t.socialAccount.push({ id: "ig-outro3", userId: "u-outro", provider: "instagram" });
        await importar([peca("a", { versao: 2, status_editorial: "reprovado" })], { chave: "chave-outro", contas: { padrao: "ig-outro" } });
        expect(h.t.externalPostLink[0].editorial).toBe("aprovado");
    });
});

describe("atomicidade da atualização (achado 7)", () => {
    it("falha ao gravar o vínculo desfaz o post e as mídias novas; o manifesto antigo continua inalterado", async () => {
        const v1 = peca("a");
        const r1 = await importar([v1]);
        const antes = { post: { ...h.t.scheduledPost[0] }, midias: h.t.mediaFile.map((m: any) => m.id) };
        const falha = () => Promise.reject(new Error("falha simulada no vínculo"));
        const u = vi.spyOn(h.prisma.externalPostLink, "update").mockImplementation(falha as any);
        const um = vi.spyOn(h.prisma.externalPostLink, "updateMany").mockImplementation(falha as any);
        const log = vi.spyOn(console, "error").mockImplementation(() => {});
        const r2 = await importar([peca("a", { versao: 2, legenda: "Legenda nova" }, 3)]);
        u.mockRestore(); um.mockRestore(); log.mockRestore();

        expect(r2.itens[0].resultado).toBe("rejeitado");
        expect(h.t.scheduledPost[0]).toMatchObject({ caption: antes.post.caption, mediaIds: antes.post.mediaIds, status: "DRAFT" });
        expect(h.t.mediaFile.map((m: any) => m.id)).toEqual(antes.midias); // mídias novas limpas, antigas intactas
        expect(h.t.externalPostLink[0]).toMatchObject({ version: 1, contentHash: v1.p.hash });
        const r3 = await importar([v1]);
        expect(r3.itens[0]).toMatchObject({ resultado: "inalterado", postId: r1.itens[0].postId });
    });
});

describe("hash canônico", () => {
  // vetor calculado também pelo scripts/gerar_manifesto.py da agência (mesmo algoritmo, mesmo resultado)
  it("é estável e depende da ordem das mídias", () => {
    const base = { slug: "s", formato: "carrossel", legenda: "á", hashtags: "#a", data_planejada: "2099-01-01", hora_planejada: "10:00", midias: [{ sha256: "a" }, { sha256: "b" }] };
    expect(hashConteudo(base)).toBe(hashConteudo({ ...base }));
    expect(hashConteudo(base)).not.toBe(hashConteudo({ ...base, midias: [{ sha256: "b" }, { sha256: "a" }] }));
    expect(hashConteudo(base)).toBe(VETOR_HASH);
  });

  it("vetor com emoji, aspas, quebra de linha, U+2028 e barra invertida bate com o Python", () => {
    expect(hashConteudo(VETOR_ESPECIAL)).toBe(VETOR_ESPECIAL_HASH);
  });
});
const VETOR_HASH = "420b6b7b4f1a097c1775a9846e4653cb95dd33bedcb38194cede09a372375f99";

describe("ajustes pós-revisão", () => {
    it("nova versão não apaga mídia compartilhada nem mídia que o humano pôs no post", async () => {
        const r1 = await importar([peca("a")]);
        const [m1, m2] = r1.itens[0].mediaIds;
        h.t.mediaFile.push({ id: "externa", userId: "u-lavi", size: 1 });
        h.t.scheduledPost.push({ id: "outro-post", userId: "u-lavi", accountId: "ig-lavi", type: "FEED", caption: "x", mediaIds: [m1], publishAt: null, status: "DRAFT" });
        h.t.scheduledPost[0].mediaIds = [m2, "externa"]; // o humano trocou uma imagem
        await importar([peca("a", { versao: 2, legenda: "v2" }, 2)]);
        const ids = h.t.mediaFile.map((m: any) => m.id);
        expect(ids).toContain(m1); // usada por outro post
        expect(ids).toContain("externa"); // nunca foi da importação
        expect(ids).not.toContain(m2); // da importação e sem outro uso
        expect(h.t.externalPostLink[0].meta.mediaIds).toHaveLength(2);
    });

    it("atualização avisa que edição manual e agendamento foram substituídos", async () => {
        await importar([peca("a")]);
        const r = await importar([peca("a", { versao: 2, legenda: "v2" })]);
        expect(r.itens[0].avisos.join(" ")).toMatch(/substituídos pela versão 2/);
    });

    it("peça apagada pelo humano é recriada em vez de devolver inalterado fantasma", async () => {
        const x = peca("a");
        const r1 = await importar([x]);
        h.t.scheduledPost.length = 0;
        const r2 = await importar([x]);
        expect(r2.itens[0]).toMatchObject({ resultado: "criado" });
        expect(r2.itens[0].postId).not.toBe(r1.itens[0].postId);
        expect(r2.itens[0].avisos.join(" ")).toMatch(/apagada/);
        expect(h.t.externalPostLink).toHaveLength(1);
        expect(h.t.externalPostLink[0].postId).toBe(r2.itens[0].postId);
        expect(h.t.scheduledPost).toHaveLength(1);
    });

    it("corrida P2002 de verdade: desfaz o post novo e devolve inalterado do vencedor", async () => {
        const x = peca("a");
        const r1 = await importar([x]);
        vi.spyOn(h.prisma.externalPostLink, "findUnique").mockResolvedValueOnce(null); // a 2ª importação não viu o vínculo
        const r2 = await importar([x]);
        expect(r2.itens[0]).toMatchObject({ resultado: "inalterado", postId: r1.itens[0].postId });
        expect(h.t.scheduledPost).toHaveLength(1);
        expect(h.t.mediaFile).toHaveLength(2);
    });

    it("outro erro de banco no vínculo vira rejeição, não 'inalterado'", async () => {
        vi.spyOn(h.prisma.externalPostLink, "create").mockRejectedValueOnce(new Error("unique"));
        const r = await importar([peca("a")]);
        expect(r.itens[0].resultado).toBe("rejeitado");
        expect(h.t.scheduledPost).toHaveLength(0);
        expect(h.t.mediaFile).toHaveLength(0);
    });

    it("recusa corpo acima de 60 MB (content-length) com 413 antes de ler o formulário", async () => {
        const req = new NextRequest("http://x/api/social/importar-pacote", { method: "POST", body: "{}", headers: { "x-api-key": "chave-lavi", "content-type": "multipart/form-data; boundary=x", "content-length": String(70 * 1024 * 1024) } });
        const res = await POST(req);
        expect(res.status).toBe(413);
        expect((await res.json()).codigo).toBe("lote_grande");
    });

    it("recusa lote com mais bytes ou arquivos que o teto", async () => {
        const arquivo = (size: number) => ({ type: "image/png", size, arrayBuffer: async () => new ArrayBuffer(0) });
        const m = { contrato: "agencia-crm/1", cliente: "lavi", semana: "2026-S47", modo: "validar", contas: { padrao: "ig-lavi" }, pecas: [peca("a").p] };
        const grande = await importarPacote("u-lavi", m, new Map([["f1", arquivo(MAX_LOTE_BYTES)], ["f2", arquivo(1)]]));
        expect(grande).toMatchObject({ http: 413, codigo: "lote_grande" });
        const muitos = await importarPacote("u-lavi", m, new Map(Array.from({ length: 301 }, (_, i) => [`f${i}`, arquivo(1)] as const)));
        expect(muitos).toMatchObject({ http: 413, codigo: "lote_grande" });
    });

    it("avisa data_planejada e hora_planejada inválidas", async () => {
        const r = await importar([peca("a", { data_planejada: "17/11/2099", hora_planejada: "25:99" })]);
        const av = r.itens[0].avisos.join(" ");
        expect(av).toMatch(/data_planejada/);
        expect(av).toMatch(/hora_planejada/);
        expect(h.t.externalPostLink[0].plannedAt).toBeNull();
    });

    it("estado recusa cliente e semana fora do formato", async () => {
        await importar([peca("a")]);
        for (const qs of ["cliente=../x&semana=2026-S47", "cliente=lavi&semana=semana-1", "cliente=LAVI&semana=2026-S47"]) {
            expect((await ESTADO(new NextRequest(`http://x/api/social/importar-pacote/estado?${qs}`, { headers: { "x-api-key": "chave-lavi" } }))).status).toBe(400);
        }
    });
});

// mesmo vetor está em scripts/test_gerar_manifesto.py da agência
const VETOR_ESPECIAL = { slug: "s", formato: "stories", legenda: "Oi 💅 \"aspas\" \\ barra\nlinha fim\ttab", hashtags: "#á #ç", data_planejada: "2099-01-01", hora_planejada: "10:00", midias: [{ sha256: "a" }] };
const VETOR_ESPECIAL_HASH = "2111bcc195151333e9d62f5948092f1c282e54dac8b4cbe1f390f2cfa73bde36";
