import { describe, it, expect } from "vitest";
import { cloudConfigFromEnv } from "./config";

describe("cloudConfigFromEnv", () => {
    const base = { META_WA_ACCESS_TOKEN: "tok", META_WA_PHONE_NUMBER_ID: "123" };

    it("sem token ou sem phone_number_id: null (não configurada)", () => {
        expect(cloudConfigFromEnv({})).toBeNull();
        expect(cloudConfigFromEnv({ META_WA_ACCESS_TOKEN: "tok" })).toBeNull();
        expect(cloudConfigFromEnv({ META_WA_PHONE_NUMBER_ID: "123" })).toBeNull();
        expect(cloudConfigFromEnv({ META_WA_ACCESS_TOKEN: "  ", META_WA_PHONE_NUMBER_ID: "123" })).toBeNull();
    });
    it("lê token e phone_number_id, com versão padrão", () => {
        expect(cloudConfigFromEnv(base)).toEqual({ accessToken: "tok", phoneNumberId: "123", apiVersion: "v25.0" });
    });
    it("versão por env, com ou sem o v", () => {
        expect(cloudConfigFromEnv({ ...base, WHATSAPP_GRAPH_API_VERSION: "v26.0" })?.apiVersion).toBe("v26.0");
        expect(cloudConfigFromEnv({ ...base, WHATSAPP_GRAPH_API_VERSION: "26.0" })?.apiVersion).toBe("v26.0");
    });
    it.each(["", "latest", "v", "v25", "../x", "v25.0/evil"])("versão inválida %j cai no padrão", (v) => {
        expect(cloudConfigFromEnv({ ...base, WHATSAPP_GRAPH_API_VERSION: v })?.apiVersion).toBe("v25.0");
    });
    it("remove espaços ao redor dos valores", () => {
        expect(cloudConfigFromEnv({ META_WA_ACCESS_TOKEN: " tok ", META_WA_PHONE_NUMBER_ID: " 123 " })).toMatchObject({ accessToken: "tok", phoneNumberId: "123" });
    });
});
