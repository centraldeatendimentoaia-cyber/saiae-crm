/**
 * Cliente mínimo da Graph API da Meta (Instagram Business + Página do Facebook).
 * Os tokens vão no corpo do POST (nunca na URL) para não aparecerem em logs.
 */
export const GRAPH_VERSION = "v25.0";
const BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

export class GraphError extends Error {
    constructor(message: string, public code?: number, public subcode?: number) {
        super(message);
        this.name = "GraphError";
    }
    /** token expirado/revogado ou permissão removida: precisa reconectar a conta */
    get needsReconnect() {
        return this.code === 190 || this.code === 10 || this.code === 200;
    }
}

type Params = Record<string, string | number | boolean | undefined>;

async function call<T = any>(method: "GET" | "POST", path: string, token: string, params: Params = {}): Promise<T> {
    const body = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined) body.set(k, String(v));
    body.set("access_token", token);

    const url = method === "GET" ? `${BASE}${path}?${body}` : `${BASE}${path}`;
    const res = await fetch(url, method === "GET" ? undefined : { method, body });
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok || json?.error) {
        const e = json?.error || {};
        throw new GraphError(e.error_user_msg || e.message || `Erro ${res.status} da Meta`, e.code, e.error_subcode);
    }
    return json as T;
}

/** Pergunta à Meta se o token ainda vale. needsReconnect = token expirado/revogado ou sem permissão. */
export async function checkToken(externalId: string, token: string): Promise<{ ok: boolean; needsReconnect: boolean; message?: string }> {
    try {
        await call("GET", `/${externalId}`, token, { fields: "id" });
        return { ok: true, needsReconnect: false };
    } catch (e) {
        if (e instanceof GraphError) return { ok: false, needsReconnect: e.needsReconnect, message: e.message };
        throw e;
    }
}

export interface DiscoveredAccount {
    provider: "instagram" | "facebook";
    externalId: string;
    pageId: string;
    name: string;
    username?: string;
    picture?: string;
    accessToken: string; // token da Página
}

const IG_FIELDS = "id,username,name,profile_picture_url";

/** Plano B: quando o campo da Página vem vazio, pergunta direto pelas contas do Instagram ligadas a ela. */
async function instagramViaPage(pageId: string, pageToken: string): Promise<any | undefined> {
    try {
        const r: any = await call("GET", `/${pageId}/instagram_accounts`, pageToken, { fields: IG_FIELDS, limit: 1 });
        return r?.data?.[0];
    } catch {
        return undefined;
    }
}

/** Páginas encontradas que vieram sem Instagram ligado (para avisar o usuário). */
export const pagesWithoutInstagram = (found: DiscoveredAccount[]) =>
    found.filter((a) => a.provider === "facebook" && !found.some((b) => b.provider === "instagram" && b.pageId === a.pageId)).map((a) => a.name);

/** Com um token de usuário, lista as Páginas (e o Instagram Business ligado a cada uma). */
export async function discoverAccounts(userToken: string): Promise<DiscoveredAccount[]> {
    const out: DiscoveredAccount[] = [];
    let path: string | undefined = "/me/accounts";
    let params: Params = {
        fields: `id,name,access_token,picture.type(large){url},instagram_business_account{${IG_FIELDS}},connected_instagram_account{${IG_FIELDS}}`,
        limit: 100,
    };
    // paginação simples por cursor
    for (let i = 0; i < 10 && path; i++) {
        const page: any = await call("GET", path, userToken, params);
        for (const p of page.data || []) {
            out.push({ provider: "facebook", externalId: p.id, pageId: p.id, name: p.name, picture: p.picture?.data?.url, accessToken: p.access_token });
            let ig = p.instagram_business_account || p.connected_instagram_account;
            if (!ig?.id) ig = await instagramViaPage(p.id, p.access_token); // vínculo feito pelo Gerenciador de Negócios
            if (ig?.id) {
                out.push({ provider: "instagram", externalId: ig.id, pageId: p.id, name: ig.name || p.name, username: ig.username, picture: ig.profile_picture_url, accessToken: p.access_token });
            }
        }
        const after = page.paging?.cursors?.after;
        if (page.paging?.next && after) params = { ...params, after };
        else path = undefined;
    }
    return out;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Espera o container do Instagram ficar FINISHED (imagens costumam levar poucos segundos). */
async function waitContainer(id: string, token: string, tries = 20, everyMs = 3000) {
    for (let i = 0; i < tries; i++) {
        const r: any = await call("GET", `/${id}`, token, { fields: "status_code,status" });
        if (r.status_code === "FINISHED") return;
        if (r.status_code === "ERROR" || r.status_code === "EXPIRED") throw new GraphError(`Instagram recusou a mídia (${r.status || r.status_code}).`);
        await sleep(everyMs);
    }
    throw new GraphError("O Instagram demorou demais para processar a mídia.");
}

export interface PublishResult {
    id: string;
    url?: string;
}

/** Instagram: 1 imagem (feed), carrossel (2–10) ou Story (1 imagem). */
export async function publishInstagram(opts: {
    igId: string;
    token: string;
    type: "FEED" | "STORY";
    imageUrls: string[];
    caption?: string;
}): Promise<PublishResult> {
    const { igId, token, type, imageUrls, caption } = opts;
    let creation: string;

    if (type === "STORY") {
        const c: any = await call("POST", `/${igId}/media`, token, { image_url: imageUrls[0], media_type: "STORIES" });
        creation = c.id;
    } else if (imageUrls.length === 1) {
        const c: any = await call("POST", `/${igId}/media`, token, { image_url: imageUrls[0], caption });
        creation = c.id;
    } else {
        const children: string[] = [];
        for (const u of imageUrls) {
            const c: any = await call("POST", `/${igId}/media`, token, { image_url: u, is_carousel_item: true });
            children.push(c.id);
        }
        for (const id of children) await waitContainer(id, token);
        const c: any = await call("POST", `/${igId}/media`, token, { media_type: "CAROUSEL", children: children.join(","), caption });
        creation = c.id;
    }

    await waitContainer(creation, token);
    const pub: any = await call("POST", `/${igId}/media_publish`, token, { creation_id: creation });
    let url: string | undefined;
    try {
        const m: any = await call("GET", `/${pub.id}`, token, { fields: "permalink" });
        url = m.permalink;
    } catch {
        /* o link é só conveniência */
    }
    return { id: pub.id, url };
}

/** Página do Facebook: foto única, várias fotos ou Story (1 foto). */
export async function publishFacebook(opts: {
    pageId: string;
    token: string;
    type: "FEED" | "STORY";
    imageUrls: string[];
    caption?: string;
}): Promise<PublishResult> {
    const { pageId, token, type, imageUrls, caption } = opts;

    if (type === "STORY") {
        const photo: any = await call("POST", `/${pageId}/photos`, token, { url: imageUrls[0], published: false });
        const story: any = await call("POST", `/${pageId}/photo_stories`, token, { photo_id: photo.id });
        return { id: String(story.post_id || story.id || photo.id) };
    }

    if (imageUrls.length === 1) {
        const r: any = await call("POST", `/${pageId}/photos`, token, { url: imageUrls[0], caption });
        const id = String(r.post_id || r.id);
        return { id, url: `https://www.facebook.com/${id}` };
    }

    const photoIds: string[] = [];
    for (const u of imageUrls) {
        const p: any = await call("POST", `/${pageId}/photos`, token, { url: u, published: false });
        photoIds.push(p.id);
    }
    const attached: Params = { message: caption };
    photoIds.forEach((id, i) => (attached[`attached_media[${i}]`] = JSON.stringify({ media_fbid: id })));
    const r: any = await call("POST", `/${pageId}/feed`, token, attached);
    return { id: r.id, url: `https://www.facebook.com/${r.id}` };
}
