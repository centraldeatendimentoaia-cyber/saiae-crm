-- Sai ae Growth OS: migracao ADITIVA (somente CREATE TABLE e FOREIGN KEY entre tabelas novas).
-- Gerada em 2026-11-13 com: prisma migrate diff --from-schema-datamodel <origin/main 48cb963> --to-schema-datamodel <sprint7 + ExternalPostLink do sprint4> --script
-- NAO APLICADA em nenhum banco. Revisar, fazer backup testado e aplicar primeiro em staging.
-- Nenhum DROP, nenhuma alteracao em tabela existente.
-- Rollback funcional: PRESERVAR as tabelas e os models no schema.prisma (reverter so o codigo que os usa, ou desligar AUTOMACOES_ATIVAS/RESULTADOS_ENABLED e gatilhos).
-- Reverter commits remove os models do schema e o Dockerfile roda `prisma db push`, que exige confirmacao de perda de dados e impede o servidor de iniciar.
-- Remover as tabelas (rodape deste arquivo) e uma operacao separada: so com workers parados, dados reconciliados e backup restauravel testado.
-- Tabelas: ScheduledMessageAttempt, AutomationFlow, AutomationFlowVersion, AutomationRun, AutomationStep, AutomationTriggerEvent, ResultEvent, ExternalPostLink.

-- CreateTable
CREATE TABLE `ScheduledMessageAttempt` (
    `id` VARCHAR(191) NOT NULL,
    `scheduledMessageId` VARCHAR(191) NOT NULL,
    `occurrenceAt` DATETIME(3) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'claimed',
    `failureClass` VARCHAR(191) NULL,
    `error` TEXT NULL,
    `claimedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `finishedAt` DATETIME(3) NULL,

    INDEX `ScheduledMessageAttempt_status_claimedAt_idx`(`status`, `claimedAt`),
    UNIQUE INDEX `ScheduledMessageAttempt_scheduledMessageId_occurrenceAt_key`(`scheduledMessageId`, `occurrenceAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AutomationFlow` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `sessionId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'active',
    `draft` JSON NOT NULL,
    `publishedVersionId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `AutomationFlow_userId_status_idx`(`userId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AutomationFlowVersion` (
    `id` VARCHAR(191) NOT NULL,
    `flowId` VARCHAR(191) NOT NULL,
    `version` INTEGER NOT NULL,
    `schemaVersion` INTEGER NOT NULL,
    `definition` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `AutomationFlowVersion_flowId_version_key`(`flowId`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AutomationRun` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `flowId` VARCHAR(191) NOT NULL,
    `flowVersionId` VARCHAR(191) NOT NULL,
    `sessionId` VARCHAR(191) NOT NULL,
    `contactKey` VARCHAR(191) NOT NULL,
    `dedupeKey` VARCHAR(120) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'pending',
    `currentNodeId` VARCHAR(191) NULL,
    `context` JSON NOT NULL,
    `stepCount` INTEGER NOT NULL DEFAULT 0,
    `claimsSemProgresso` INTEGER NOT NULL DEFAULT 0,
    `resumeAt` DATETIME(3) NULL,
    `claimedBy` VARCHAR(191) NULL,
    `claimExpiresAt` DATETIME(3) NULL,
    `deadlineAt` DATETIME(3) NOT NULL,
    `failureClass` VARCHAR(191) NULL,
    `lastError` TEXT NULL,
    `motivoFim` VARCHAR(191) NULL,
    `finishedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `AutomationRun_status_resumeAt_idx`(`status`, `resumeAt`),
    INDEX `AutomationRun_status_claimExpiresAt_idx`(`status`, `claimExpiresAt`),
    INDEX `AutomationRun_userId_flowId_contactKey_status_idx`(`userId`, `flowId`, `contactKey`, `status`),
    INDEX `AutomationRun_sessionId_contactKey_status_idx`(`sessionId`, `contactKey`, `status`),
    UNIQUE INDEX `AutomationRun_flowVersionId_contactKey_dedupeKey_key`(`flowVersionId`, `contactKey`, `dedupeKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AutomationStep` (
    `id` VARCHAR(191) NOT NULL,
    `runId` VARCHAR(191) NOT NULL,
    `seq` INTEGER NOT NULL,
    `nodeId` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL,
    `output` JSON NULL,
    `error` TEXT NULL,
    `failureClass` VARCHAR(191) NULL,
    `startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `finishedAt` DATETIME(3) NULL,

    UNIQUE INDEX `AutomationStep_runId_seq_key`(`runId`, `seq`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AutomationTriggerEvent` (
    `id` VARCHAR(191) NOT NULL,
    `key` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `AutomationTriggerEvent_key_key`(`key`),
    INDEX `AutomationTriggerEvent_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ResultEvent` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `sessionId` VARCHAR(191) NOT NULL,
    `contactKey` VARCHAR(191) NOT NULL,
    `tipo` VARCHAR(191) NOT NULL,
    `origem` VARCHAR(191) NULL,
    `origemDetalhe` VARCHAR(191) NULL,
    `confianca` VARCHAR(191) NOT NULL DEFAULT 'inferido',
    `fonte` VARCHAR(191) NOT NULL,
    `refExterna` VARCHAR(191) NULL,
    `dedupKey` VARCHAR(191) NOT NULL,
    `valorCentavos` INTEGER NULL,
    `ocorridoEm` DATETIME(3) NOT NULL,
    `importacaoId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ResultEvent_userId_sessionId_ocorridoEm_idx`(`userId`, `sessionId`, `ocorridoEm`),
    INDEX `ResultEvent_userId_sessionId_importacaoId_idx`(`userId`, `sessionId`, `importacaoId`),
    UNIQUE INDEX `ResultEvent_userId_sessionId_dedupKey_key`(`userId`, `sessionId`, `dedupKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ExternalPostLink` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `source` VARCHAR(191) NOT NULL,
    `externalKey` VARCHAR(191) NOT NULL,
    `version` INTEGER NOT NULL,
    `contentHash` VARCHAR(191) NOT NULL,
    `editorial` VARCHAR(191) NOT NULL DEFAULT 'aprovado',
    `postId` VARCHAR(191) NOT NULL,
    `plannedAt` DATETIME(3) NULL,
    `meta` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ExternalPostLink_postId_idx`(`postId`),
    INDEX `ExternalPostLink_userId_source_idx`(`userId`, `source`),
    UNIQUE INDEX `ExternalPostLink_userId_source_externalKey_key`(`userId`, `source`, `externalKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `AutomationFlowVersion` ADD CONSTRAINT `AutomationFlowVersion_flowId_fkey` FOREIGN KEY (`flowId`) REFERENCES `AutomationFlow`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AutomationRun` ADD CONSTRAINT `AutomationRun_flowId_fkey` FOREIGN KEY (`flowId`) REFERENCES `AutomationFlow`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AutomationRun` ADD CONSTRAINT `AutomationRun_flowVersionId_fkey` FOREIGN KEY (`flowVersionId`) REFERENCES `AutomationFlowVersion`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AutomationStep` ADD CONSTRAINT `AutomationStep_runId_fkey` FOREIGN KEY (`runId`) REFERENCES `AutomationRun`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;


-- REMOCAO DAS TABELAS (NAO e o rollback funcional; nao executar em rotina):
-- Apaga resultados, execucoes e registros antirreenvio de forma irreversivel. A ordem abaixo respeita as FKs, mas isso NAO a torna segura.
-- Exige: workers parados, dados reconciliados e backup restauravel testado. Antes disso, preserve os models no schema.prisma (ver cabecalho).
-- DROP TABLE `AutomationStep`; DROP TABLE `AutomationRun`; DROP TABLE `AutomationFlowVersion`; DROP TABLE `AutomationFlow`;
-- DROP TABLE `AutomationTriggerEvent`; DROP TABLE `ResultEvent`; DROP TABLE `ExternalPostLink`; DROP TABLE `ScheduledMessageAttempt`;
