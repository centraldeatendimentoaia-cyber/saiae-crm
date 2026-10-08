/**
 * Backup do banco MySQL (mysqldump + gzip) com rotação e envio opcional para um bucket S3.
 *
 * Uso:   npm run db:backup
 * Env:   DATABASE_URL        (obrigatória, mysql://user:senha@host:porta/banco)
 *        BACKUP_DIR          pasta de destino (padrão: ./backups)
 *        BACKUP_KEEP         quantos backups manter localmente (padrão: 14)
 *        MYSQLDUMP_PATH      caminho do mysqldump (padrão: "mysqldump" no PATH)
 *        BACKUP_S3_BUCKET    (opcional) envia o arquivo para um bucket S3-compatível
 *        BACKUP_S3_ENDPOINT  endpoint (ex.: https://<conta>.r2.cloudflarestorage.com)
 *        BACKUP_S3_REGION    região (padrão: auto)
 *        BACKUP_S3_KEY_ID / BACKUP_S3_SECRET   credenciais do bucket
 *
 * Em produção (Railway) roda como serviço com Cron Schedule, enviando o arquivo
 * para o bucket (a cópia dentro do container some quando ele termina).
 */
const { spawn, spawnSync } = require("child_process");
const { pipeline } = require("stream/promises");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const log = (...a) => console.log("[backup]", ...a);

// carrega o .env (uso local) sem depender de bibliotecas
try {
    for (const line of fs.readFileSync(path.resolve(".env"), "utf8").split(String.fromCharCode(10))) {
        const i = line.indexOf("=");
        if (i < 1 || line.trim().startsWith("#")) continue;
        const key = line.slice(0, i).trim();
        const val = line.slice(i + 1).trim().replace(/^"|"$/g, "");
        if (!(key in process.env)) process.env[key] = val;
    }
} catch { /* sem .env: usa variáveis do ambiente */ }

/**
 * true se o cliente de dump é MariaDB: pelo texto de "--version" (ex.: "mariadb-dump from 11.4.12-MariaDB") ou, se não
 * der para executar, pelo nome do binário. Só o cliente MariaDB 11 exige certificado verificado e precisa de --skip-ssl.
 */
function ehMariaDb(bin, versionOutput) {
    if (typeof versionOutput === "string" && versionOutput.trim()) return /maria/i.test(versionOutput);
    return /maria/i.test(bin);
}

function lerVersao(bin) {
    const r = spawnSync(bin, ["--version"], { encoding: "utf8", timeout: 10000 });
    return r.error ? "" : `${r.stdout || ""}${r.stderr || ""}`;
}

/** Mensagem de ajuda quando o cliente não carrega o plugin de autenticação padrão do MySQL 8. */
function dicaPlugin(stderr) {
    return /caching_sha2_password/i.test(stderr || "") && /could not be loaded|plugin/i.test(stderr || "")
        ? "Faltou o plugin caching_sha2_password no cliente. Na imagem Dockerfile.backup instale mariadb-connector-c e confira que existe /usr/lib/mariadb/plugin/caching_sha2_password.so (veja DEPLOY-RAILWAY.md, seção Backup)."
        : "";
}

async function uploadToS3(filePath) {
    const bucket = process.env.BACKUP_S3_BUCKET;
    if (!bucket) {
        log("BACKUP_S3_BUCKET não definida: o arquivo fica só no disco local.");
        return;
    }
    const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
    const client = new S3Client({
        region: process.env.BACKUP_S3_REGION || "auto",
        endpoint: process.env.BACKUP_S3_ENDPOINT || undefined,
        forcePathStyle: !!process.env.BACKUP_S3_ENDPOINT,
        credentials: {
            accessKeyId: (process.env.BACKUP_S3_KEY_ID || "").trim(),
            secretAccessKey: (process.env.BACKUP_S3_SECRET || "").trim(),
        },
    });
    await client.send(
        new PutObjectCommand({ Bucket: bucket, Key: path.basename(filePath), Body: fs.readFileSync(filePath) })
    );
    log("Backup enviado para o bucket:", bucket, "->", path.basename(filePath));
}

async function main() {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL não definida.");

    const u = new URL(url);
    const db = u.pathname.replace(/^\//, "");
    const dir = path.resolve(process.env.BACKUP_DIR || "backups");
    const keep = parseInt(process.env.BACKUP_KEEP || "14", 10);
    const bin = process.env.MYSQLDUMP_PATH || "mysqldump";

    log(`Iniciando backup de "${db}" em ${u.hostname}:${u.port || 3306} (usando ${bin})`);
    fs.mkdirSync(dir, { recursive: true });

    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const file = path.join(dir, `${db}-${stamp}.sql.gz`);

    // credenciais num arquivo temporário (600): funciona em qualquer cliente MySQL/MariaDB
    // e não aparece na lista de processos nem depende de MYSQL_PWD
    const cnf = path.join(dir, `.my-${process.pid}.cnf`);
    const BS = String.fromCharCode(92);
    const NL = String.fromCharCode(10);
    const q = (v) => '"' + String(v).split(BS).join(BS + BS).split('"').join(BS + '"') + '"';
    const cnfLines = [
        "[client]",
        `host=${u.hostname}`,
        `port=${u.port || 3306}`,
        `user=${q(decodeURIComponent(u.username))}`,
    ];
    if (u.password) cnfLines.push(`password=${q(decodeURIComponent(u.password))}`);
    fs.writeFileSync(cnf, cnfLines.join(NL) + NL, { mode: 0o600 });
    const versao = lerVersao(bin);
    const isMaria = ehMariaDb(bin, versao);
    log(`Cliente de dump: ${versao.trim().split(String.fromCharCode(10))[0] || "(versão não lida)"} -> ${isMaria ? "MariaDB (--skip-ssl)" : "MySQL"}`);
    const args = [
        `--defaults-extra-file=${cnf}`, // precisa ser o primeiro argumento
        "--single-transaction",
        "--routines",
        "--default-character-set=utf8mb4",
        // rede privada do Railway: o cliente MariaDB 11 exigiria certificado verificado
        ...(isMaria ? ["--skip-ssl"] : []),
        db,
    ];
    const env = { ...process.env };

    const dump = spawn(bin, args, { env });
    let stderr = "";
    dump.stderr.on("data", (d) => (stderr += d));

    const exited = new Promise((resolve, reject) => {
        dump.on("error", (e) => reject(new Error(`Não consegui executar "${bin}": ${e.message}`)));
        dump.on("close", (code) => resolve(code));
    });
    const written = pipeline(dump.stdout, zlib.createGzip(), fs.createWriteStream(file));

    const [code] = await Promise.all([exited, written]).catch((e) => {
        fs.rmSync(file, { force: true });
        throw e;
    }).finally(() => fs.rmSync(cnf, { force: true }));

    if (code !== 0) {
        fs.rmSync(file, { force: true });
        const dica = dicaPlugin(stderr);
        throw new Error(`mysqldump terminou com código ${code}: ${stderr.trim() || "(sem mensagem)"}${dica ? `\n[backup] AVISO: ${dica}` : ""}`);
    }

    const size = fs.statSync(file).size;
    if (size < 200) {
        fs.rmSync(file, { force: true });
        throw new Error("Backup suspeito (arquivo muito pequeno). Removido.");
    }
    log(`Backup criado: ${file} (${(size / 1024 / 1024).toFixed(2)} MB)`);

    await uploadToS3(file);

    // rotação local: mantém só os N mais recentes
    const files = fs.readdirSync(dir)
        .filter((f) => f.startsWith(`${db}-`) && f.endsWith(".sql.gz"))
        .sort()
        .reverse();
    for (const old of files.slice(keep)) {
        fs.rmSync(path.join(dir, old), { force: true });
        log("Removido backup antigo:", old);
    }
}

if (require.main === module) {
    main()
        .then(() => {
            log("Concluído.");
            process.exit(0);
        })
        .catch((e) => {
            console.error("[backup] ERRO:", e.message);
            process.exit(1);
        });
}

module.exports = { ehMariaDb, dicaPlugin };
