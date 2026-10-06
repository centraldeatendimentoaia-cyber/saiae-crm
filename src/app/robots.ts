import { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://crm.saiae.com.br";

    return {
        rules: {
            userAgent: "*",
            allow: ["/", "/privacy", "/terms"],
            disallow: ["/dashboard/", "/api/", "/auth/", "/swagger", "/docs"],
        },
        sitemap: `${baseUrl}/sitemap.xml`,
    };
}
