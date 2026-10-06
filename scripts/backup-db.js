/**
 * Backup do banco MySQL (mysqldump + gzip) com rotação.
 *
 * Uso:   npm run db:backup
 * Env:   DATABASE_URL        (obrigatória, mysql://user:senha@host:porta/banco)
 *        BACKUP_DIR          pasta de destino (padrão: ./backups)
 *        BACKUP_KEEP         quantos backups manter (padrão: 14)
 *        MYSQLDUMP_PATH      caminho do mysqldump (padrão: "mysqldump" no PATH)
 *
 *        BACKUP_S3_BUCKET    (opcional) envia o arquivo para um bucket S3-compatível
 *        BACKUP_S3_ENDPOINT  endpoint (ex.: https://s3.us-west-004.backblazeb2.com)
 *        BACKUP_S3_REGION    região (padrão: auto)
 *        BACKUP_S3_KEY_ID / BACKUP_S3_SECRET   credenciais do bucket
 *
 * Em produção (Railway), rode este script em um serviço com Cron Schedule e envie o
 * arquivo gerado para um armazenamento externo (S3, Backblaze B2, Google Drive...).
 */
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

// carrega o .env sem depender de bibliotecas
try {
    for (const line of fs.readFileSync(path.resolve(".env"), "utf8").split(String.fromCharCode(10))) {
        const i = line.indexOf("=");
        if (i < 1 || line.trim().startsWith("#")) continue;
        const key = line.slice(0, i).trim();
        const val = line.slice(i + 1).trim().replace(/^"|"$/g, "");
        if (!(key in process.env)) process.env[key] = val;
    }
} catch { /* sem .env: usa variáveis do ambiente */ }

const url = process.env.DATABASE_URL;
if (!url) {
    console.error("DATABASE_URL não definida.");
    process.exit(1);
}

const u = new URL(url);
const db = u.pathname.replace(/^\//, "");
const dir = path.resolve(process.env.BACKUP_DIR || "backups");
const keep = parseInt(process.env.BACKUP_KEEP || "14", 10);
const bin = process.env.MYSQLDUMP_PATH || "mysqldump";

fs.mkdirSync(dir, { recursive: true });

async function uploadToS3(filePath) {
    const bucket = process.env.BACKUP_S3_BUCKET;
    if (!bucket) return;
    const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
    const client = new S3Client({
        region: process.env.BACKUP_S3_REGION || "auto",
        endpoint: process.env.BACKUP_S3_ENDPOINT || undefined,
        forcePathStyle: !!process.env.BACKUP_S3_ENDPOINT,
        credentials: {
            accessKeyId: process.env.BACKUP_S3_KEY_ID,
            secretAccessKey: process.env.BACKUP_S3_SECRET,
        },
    });
    await client.send(new PutObjectCommand({
        Bucket: bucket,
        Key: path.basename(filePath),
        Body: fs.readFileSync(filePath),
    }));
    console.log("Backup enviado para o bucket:", bucket);
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const file = path.join(dir, `${db}-${stamp}.sql.gz`);

const args = [
    `--host=${u.hostname}`,
    `--port=${u.port || 3306}`,
    `--user=${decodeURIComponent(u.username)}`,
    "--single-transaction",
    "--routines",
    "--default-character-set=utf8mb4",
    db,
];
const env = { ...process.env };
if (u.password) env.MYSQL_PWD = decodeURIComponent(u.password);

const dump = spawn(bin, args, { env });
const out = fs.createWriteStream(file);
let stderr = "";

dump.stderr.on("data", (d) => (stderr += d));
dump.stdout.pipe(zlib.createGzip()).pipe(out);

dump.on("error", (e) => {
    console.error(`Não consegui executar "${bin}": ${e.message}`);
    console.error("Defina MYSQLDUMP_PATH com o caminho do mysqldump.");
    fs.rmSync(file, { force: true });
    process.exit(1);
});

out.on("close", () => {
    if (dump.exitCode !== 0 && dump.exitCode !== null) return;
});

dump.on("close", (code) => {
    if (code !== 0) {
        console.error("mysqldump falhou:", stderr.trim());
        fs.rmSync(file, { force: true });
        process.exit(1);
    }
    out.on("finish", () => {
        const size = fs.statSync(file).size;
        if (size < 200) {
            console.error("Backup suspeito (arquivo muito pequeno). Removendo.");
            fs.rmSync(file, { force: true });
            process.exit(1);
        }
        console.log(`Backup criado: ${file} (${(size / 1024 / 1024).toFixed(2)} MB)`);
        uploadToS3(file).catch((e) => {
            console.error("Falha ao enviar o backup para o bucket:", e.message);
            process.exitCode = 1;
        });

        // rotação: mantém só os N mais recentes
        const files = fs.readdirSync(dir)
            .filter((f) => f.startsWith(`${db}-`) && f.endsWith(".sql.gz"))
            .sort()
            .reverse();
        for (const old of files.slice(keep)) {
            fs.rmSync(path.join(dir, old), { force: true });
            console.log("Removido backup antigo:", old);
        }
    });
});
