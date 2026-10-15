export interface AutoReply {
    id: string;
    keyword: string;
    matchType: string;
    response: string;
    isMedia: boolean;
    mediaUrl: string | null;
    mediaType: string | null;
    triggerType: string;
    createdAt: Date;
}

export interface RuleFormValues {
    keyword: string;
    response: string;
    matchType: string;
    triggerType: string;
    mediaUrl: string;
    mediaType: string;
}

export const EMPTY_RULE_FORM: RuleFormValues = {
    keyword: "",
    response: "",
    matchType: "EXACT",
    triggerType: "ALL",
    mediaUrl: "",
    mediaType: "image",
};

/** Palavra-chave e (resposta ou URL de mídia) são obrigatórias. */
export const ruleFormValid = (f: RuleFormValues) => !!f.keyword.trim() && (!!f.response.trim() || !!f.mediaUrl.trim());

/** Corpo enviado às ações de criar/atualizar. */
export const toRuleInput = (f: RuleFormValues) => ({
    keyword: f.keyword.trim(),
    response: f.response.trim(),
    matchType: f.matchType,
    triggerType: f.triggerType,
    isMedia: !!f.mediaUrl.trim(),
    mediaUrl: f.mediaUrl.trim() || null,
    mediaType: f.mediaType || null,
});
